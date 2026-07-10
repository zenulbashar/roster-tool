import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { decryptSecret } from "@/lib/crypto";
import {
  xeroClient,
  type XeroClient,
  type XeroDraftTimesheetInput,
  type XeroTenant,
  type XeroTimesheetResult,
  type XeroTokenSet,
} from "@/lib/xero/client";
import {
  completeXeroConnection,
  ensureFreshXeroAccessToken,
} from "@/lib/xero/service";
import { XeroReconnectRequired } from "@/lib/xero/errors";

/**
 * Integration coverage of the Xero connection SERVICE against the real DB,
 * driven by a FAKE XeroClient (all network calls wrapped behind the interface).
 * Asserts: connect stores ENCRYPTED tokens as pending_confirmation + resolves
 * the org; an expired token triggers a refresh that persists BOTH rotated
 * tokens; a revoked refresh surfaces reconnect. Plus a boundary test on the
 * REAL client: the timesheet payload it builds is ALWAYS Status DRAFT.
 */

const HOUR = 3_600_000;

class FakeXeroClient implements XeroClient {
  calls = { exchangeCode: 0, getConnections: 0, refresh: 0 };
  refreshShouldRevoke = false;
  tenants: XeroTenant[] = [
    {
      tenantId: "tenant-1",
      tenantType: "ORGANISATION",
      tenantName: "Acme Pty Ltd",
    },
  ];

  buildAuthUrl(state: string): string {
    return `https://login.xero.com/identity/connect/authorize?state=${state}`;
  }
  async exchangeCode(): Promise<XeroTokenSet> {
    this.calls.exchangeCode++;
    return {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiry: new Date(Date.now() + HOUR),
      scope:
        "openid email offline_access payroll.timesheets payroll.employees.read",
      connectedEmail: "book@keeper.test",
    };
  }
  async refreshAccessToken(): Promise<XeroTokenSet> {
    this.calls.refresh++;
    if (this.refreshShouldRevoke) throw new XeroReconnectRequired();
    return {
      accessToken: "access-2",
      refreshToken: "refresh-2", // Xero rotates the refresh token
      expiry: new Date(Date.now() + HOUR),
      scope:
        "openid email offline_access payroll.timesheets payroll.employees.read",
      connectedEmail: "book@keeper.test",
    };
  }
  async getConnections(): Promise<XeroTenant[]> {
    this.calls.getConnections++;
    return this.tenants;
  }
  async createDraftTimesheet(): Promise<XeroTimesheetResult> {
    return { timesheetId: "ts-1", status: "Draft" };
  }
  async getTimesheet(): Promise<XeroTimesheetResult> {
    return { timesheetId: "ts-1", status: "Draft" };
  }
  async deleteTimesheet(): Promise<void> {
    /* no-op fake */
  }
  async listEmployees() {
    return [];
  }
  async listEarningsRates() {
    return [];
  }
  async getEmployeePayTemplateEarnings() {
    return [];
  }
  async getPayrollCalendar() {
    return null;
  }
}

describe("xero connection service", () => {
  let businessId = "";
  let repo: TenantRepo;

  beforeAll(async () => {
    const [b] = await db
      .insert(businesses)
      .values({ name: "Xero Service Café" })
      .returning();
    businessId = b!.id;
    repo = createTenantRepo(businessId);
  });

  afterAll(async () => {
    if (businessId)
      await db.delete(businesses).where(eq(businesses.id, businessId));
    await db.$client.end();
  });

  it("connect stores ENCRYPTED tokens as pending_confirmation + resolves org", async () => {
    const client = new FakeXeroClient();
    const result = await completeXeroConnection({
      repo,
      client,
      code: "auth-code",
      connectedIp: "203.0.113.9",
      connectedUserAgent: "UA",
    });
    expect(result.orgName).toBe("Acme Pty Ltd");
    expect(result.tenantId).toBe("tenant-1");
    expect(result.email).toBe("book@keeper.test");
    expect(client.calls.getConnections).toBe(1);

    const conn = await repo.getXeroConnection();
    expect(conn).not.toBeNull();
    expect(conn!.status).toBe("pending_confirmation"); // NOT active until confirmed
    expect(conn!.orgName).toBe("Acme Pty Ltd");
    expect(conn!.connectedAccountEmail).toBe("book@keeper.test");
    expect(conn!.connectedIp).toBe("203.0.113.9");
    expect(conn!.needsReconnect).toBe(false);
    // Recorded scopes must never carry a pay-run scope.
    expect(conn!.authorisedScopes).not.toMatch(/payrun/i);
    // Ciphertext is not the plaintext, but decrypts back to it.
    expect(conn!.accessTokenEnc).not.toContain("access-1");
    expect(decryptSecret(conn!.accessTokenEnc)).toBe("access-1");
    expect(decryptSecret(conn!.refreshTokenEnc)).toBe("refresh-1");
  });

  it("fresh token is returned without a refresh", async () => {
    const client = new FakeXeroClient();
    const conn = await repo.getXeroConnection();
    const token = await ensureFreshXeroAccessToken({
      repo,
      client,
      connection: conn!,
    });
    expect(token).toBe("access-1");
    expect(client.calls.refresh).toBe(0);
  });

  it("expired token refreshes and persists BOTH rotated tokens", async () => {
    const client = new FakeXeroClient();
    const conn = await repo.getXeroConnection();
    // Force expiry by passing a `now` well past the token expiry.
    const token = await ensureFreshXeroAccessToken({
      repo,
      client,
      connection: conn!,
      now: new Date(Date.now() + 2 * HOUR),
    });
    expect(client.calls.refresh).toBe(1);
    expect(token).toBe("access-2");

    const after = await repo.getXeroConnection();
    expect(decryptSecret(after!.accessTokenEnc)).toBe("access-2");
    expect(decryptSecret(after!.refreshTokenEnc)).toBe("refresh-2"); // rotated
    expect(after!.needsReconnect).toBe(false);
  });

  it("a revoked refresh flags needs_reconnect and throws", async () => {
    const client = new FakeXeroClient();
    client.refreshShouldRevoke = true;
    const conn = await repo.getXeroConnection();
    await expect(
      ensureFreshXeroAccessToken({
        repo,
        client,
        connection: conn!,
        now: new Date(Date.now() + 2 * HOUR),
      }),
    ).rejects.toBeInstanceOf(XeroReconnectRequired);
    const after = await repo.getXeroConnection();
    expect(after!.needsReconnect).toBe(true);
  });
});

describe("xero client DRAFT-timesheet boundary (real client, Payroll 2.0)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("always POSTs status Draft to the 2.0 endpoint with ISO per-day scalar lines + Idempotency-Key", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        captured = { url, init };
        return new Response(
          JSON.stringify({
            timesheet: { timesheetID: "ts-99", status: "Draft" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const input: XeroDraftTimesheetInput = {
      payrollCalendarId: "cal-1",
      employeeId: "emp-1",
      startDate: "2026-07-06",
      endDate: "2026-07-12",
      earningsRateId: "rate-1",
      lines: [
        { date: "2026-07-06", numberOfUnits: 8 },
        { date: "2026-07-07", numberOfUnits: 7.5 },
      ],
    };
    const result = await xeroClient.createDraftTimesheet(
      "access-token",
      "tenant-1",
      input,
      "idem-key-abc",
    );
    expect(result.timesheetId).toBe("ts-99");
    expect(result.status).toBe("Draft");

    expect(captured).not.toBeNull();
    const { url, init } = captured!;
    expect(url).toBe("https://api.xero.com/payroll.xro/2.0/Timesheets");
    const headers = init.headers as Record<string, string>;
    expect(headers["Xero-Tenant-Id"]).toBe("tenant-1");
    expect(headers["Idempotency-Key"]).toBe("idem-key-abc");
    expect(headers["Authorization"]).toBe("Bearer access-token");

    const body = JSON.parse(init.body as string);
    expect(body.status).toBe("Draft"); // <-- the boundary
    expect(body.payrollCalendarID).toBe("cal-1");
    expect(body.employeeID).toBe("emp-1");
    // ISO dates, NOT MS-JSON /Date()/.
    expect(body.startDate).toBe("2026-07-06");
    expect(body.endDate).toBe("2026-07-12");
    // One line PER DAY, scalar numberOfUnits, single ordinary earnings rate.
    expect(body.timesheetLines).toHaveLength(2);
    expect(body.timesheetLines[0]).toEqual({
      date: "2026-07-06",
      earningsRateID: "rate-1",
      numberOfUnits: 8,
    });
    expect(body.timesheetLines[1].numberOfUnits).toBe(7.5);
    // The payload has no way to express any other status.
    expect(JSON.stringify(body)).not.toMatch(/Approved|Completed|Requested/);
  });

  it("a line-level earningsRateId (an owner pay rule) overrides the default, per line", async () => {
    let captured: { init: RequestInit } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        captured = { init };
        return new Response(
          JSON.stringify({
            timesheet: { timesheetID: "ts-100", status: "Draft" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    await xeroClient.createDraftTimesheet(
      "access-token",
      "tenant-1",
      {
        payrollCalendarId: "cal-1",
        employeeId: "emp-1",
        startDate: "2026-07-06",
        endDate: "2026-07-12",
        earningsRateId: "rate-ordinary",
        lines: [
          // Same day split across two of the OWNER's pay items by their rules.
          { date: "2026-07-11", numberOfUnits: 6 },
          { date: "2026-07-11", numberOfUnits: 2, earningsRateId: "rate-sat" },
        ],
      },
      "idem-key-def",
    );

    const body = JSON.parse(captured!.init.body as string);
    expect(body.status).toBe("Draft"); // the boundary is untouched by rules
    expect(body.timesheetLines).toEqual([
      { date: "2026-07-11", earningsRateID: "rate-ordinary", numberOfUnits: 6 },
      { date: "2026-07-11", earningsRateID: "rate-sat", numberOfUnits: 2 },
    ]);
  });

  it("deleteTimesheet issues a real DELETE and treats 404 as already-gone", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method });
        return new Response(null, { status: 404 }); // already gone → success
      }),
    );
    await expect(
      xeroClient.deleteTimesheet("access-token", "tenant-1", "ts-1"),
    ).resolves.toBeUndefined();
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe(
      "https://api.xero.com/payroll.xro/2.0/Timesheets/ts-1",
    );
  });

  it("BOUNDARY: the client object exposes NO pay-run, approve, revert, or employee-write method", () => {
    // These must not merely be off — they must NOT EXIST on the surface. If
    // anyone adds one, this fails. Mirrors the pay-run guard for the 2.0
    // Approve/RevertToDraft lifecycle a human must perform inside Xero.
    const surface = xeroClient as unknown as Record<string, unknown>;
    for (const forbidden of [
      "approveTimesheet",
      "approve",
      "revertTimesheet",
      "revertTimesheetToDraft",
      "postPayRun",
      "createPayRun",
      "updatePayRun",
      "createEmployee",
      "updateEmployee",
      "updateEmployeeBankAccount",
      "updateTaxDeclaration",
    ]) {
      expect(surface[forbidden]).toBeUndefined();
    }
    // What it DOES expose: connection plumbing + draft create/get/delete only.
    expect(typeof xeroClient.createDraftTimesheet).toBe("function");
    expect(typeof xeroClient.getTimesheet).toBe("function");
    expect(typeof xeroClient.deleteTimesheet).toBe("function");
    expect(Object.keys(xeroClient)).toEqual([
      "buildAuthUrl",
      "exchangeCode",
      "refreshAccessToken",
      "getConnections",
      "createDraftTimesheet",
      "getTimesheet",
      "deleteTimesheet",
      // read-only mapping helpers (payroll.employees.read / payroll.settings.read)
      "listEmployees",
      "listEarningsRates",
      "getEmployeePayTemplateEarnings",
      "getPayrollCalendar",
    ]);
  });
});
