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
    return { timesheetId: "ts-1", status: "DRAFT" };
  }
  async getTimesheet(): Promise<XeroTimesheetResult> {
    return { timesheetId: "ts-1", status: "DRAFT" };
  }
  async updateDraftTimesheet(): Promise<XeroTimesheetResult> {
    return { timesheetId: "ts-1", status: "DRAFT" };
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

describe("xero client DRAFT-timesheet boundary (real client, stubbed fetch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("always POSTs Status DRAFT with a per-day NumberOfUnits array + Idempotency-Key", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        captured = { url, init };
        return new Response(
          JSON.stringify({
            Timesheets: [{ TimesheetID: "ts-99", Status: "DRAFT" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const input: XeroDraftTimesheetInput = {
      employeeId: "emp-1",
      startDate: "2026-07-06",
      endDate: "2026-07-12",
      earningsRateId: "rate-1",
      numberOfUnits: [8, 8, 8, 8, 8, 0, 0],
    };
    const result = await xeroClient.createDraftTimesheet(
      "access-token",
      "tenant-1",
      input,
      "idem-key-abc",
    );
    expect(result.timesheetId).toBe("ts-99");

    expect(captured).not.toBeNull();
    const { url, init } = captured!;
    expect(url).toBe("https://api.xero.com/payroll.xro/1.0/Timesheets");
    const headers = init.headers as Record<string, string>;
    expect(headers["Xero-Tenant-Id"]).toBe("tenant-1");
    expect(headers["Idempotency-Key"]).toBe("idem-key-abc");
    expect(headers["Authorization"]).toBe("Bearer access-token");

    const body = JSON.parse(init.body as string);
    const ts = body.Timesheets[0];
    expect(ts.Status).toBe("DRAFT"); // <-- the boundary
    expect(ts.EmployeeID).toBe("emp-1");
    expect(ts.StartDate).toMatch(/^\/Date\(\d+\)\/$/);
    expect(ts.EndDate).toMatch(/^\/Date\(\d+\)\/$/);
    expect(ts.TimesheetLines[0].EarningsRateID).toBe("rate-1");
    expect(ts.TimesheetLines[0].NumberOfUnits).toEqual([8, 8, 8, 8, 8, 0, 0]);
    // The payload has no way to express any other status.
    expect(JSON.stringify(body)).not.toMatch(/POSTED|APPROVED|PROCESSED/);
  });
});
