import { describe, it, expect } from "vitest";
import {
  JOBS_ADMIN_USAGE,
  lastErrorMessage,
  parseJobsAdminArgs,
  summarizeFailedJob,
} from "@/lib/jobs/admin";

const ID = "6b1a2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const BIZ = "0f1e2d3c-4b5a-4968-8776-655443322110";

/**
 * OPS-03 — the operator CLI's pure half: argument parsing never throws, every
 * mistake names the fix, and a failed job's summary never prints a token.
 */
describe("jobs-admin argument parsing", () => {
  it("defaults to help and recognises every command", () => {
    expect(parseJobsAdminArgs([])).toEqual({ cmd: "help" });
    expect(parseJobsAdminArgs(["--help"])).toEqual({ cmd: "help" });
    expect(parseJobsAdminArgs(["stats"])).toEqual({ cmd: "stats" });
    expect(parseJobsAdminArgs(["failed"])).toEqual({
      cmd: "failed",
      limit: 20,
    });
    expect(parseJobsAdminArgs(["failed", "--limit", "5"])).toEqual({
      cmd: "failed",
      limit: 5,
    });
    expect(
      parseJobsAdminArgs(["retry", "--queue", "published-roster", "--id", ID]),
    ).toEqual({ cmd: "retry", queue: "published-roster", id: ID });
  });

  it("parses redispatch with its optional flags", () => {
    const now = new Date("2026-09-05T01:00:00Z");
    expect(parseJobsAdminArgs(["redispatch", "--business", BIZ], now)).toEqual({
      cmd: "redispatch",
      businessId: BIZ,
      force: false,
      at: now,
    });
    const at = "2026-09-04T22:30:00Z";
    expect(
      parseJobsAdminArgs(
        ["redispatch", "--business", BIZ, "--force", "--at", at],
        now,
      ),
    ).toEqual({
      cmd: "redispatch",
      businessId: BIZ,
      force: true,
      at: new Date(at),
    });
  });

  it("names the mistake instead of throwing", () => {
    const errors = [
      parseJobsAdminArgs(["nope"]),
      parseJobsAdminArgs(["failed", "--limit", "0"]),
      parseJobsAdminArgs(["failed", "--limit", "abc"]),
      parseJobsAdminArgs(["retry", "--id", ID]),
      parseJobsAdminArgs(["retry", "--queue", "q", "--id", "not-a-uuid"]),
      parseJobsAdminArgs(["retry", "--queue", "--id", ID]),
      parseJobsAdminArgs(["redispatch"]),
      parseJobsAdminArgs(["redispatch", "--business", BIZ, "--at", "soon"]),
    ];
    for (const e of errors) expect(e).toHaveProperty("error");
    expect((errors[0] as { error: string }).error).toContain("Unknown command");
    expect((errors[3] as { error: string }).error).toContain("--queue");
    expect((errors[7] as { error: string }).error).toContain("ISO-8601");
  });

  it("documents every command in the usage text", () => {
    for (const cmd of ["stats", "failed", "retry", "redispatch"]) {
      expect(JOBS_ADMIN_USAGE).toContain(cmd);
    }
    expect(JOBS_ADMIN_USAGE).toContain("docs/operations.md");
  });
});

describe("failed-job summary", () => {
  it("reads pg-boss's error shapes", () => {
    expect(lastErrorMessage({ message: "SMTP refused" })).toBe("SMTP refused");
    expect(lastErrorMessage({ value: { message: "job timed out" } })).toBe(
      "job timed out",
    );
    expect(lastErrorMessage(null)).toBeNull();
    expect(lastErrorMessage({})).toBeNull();
    expect(lastErrorMessage("boom")).toBeNull();
  });

  it("redacts a magic-link token and reports the age since failure", () => {
    const summary = summarizeFailedJob(
      {
        id: ID,
        name: "availability-request",
        data: { requestId: "req-1", token: "secret-magic-link-token" },
        output: { message: "Resend 503" },
        retryCount: 5,
        createdOn: new Date("2026-09-05T00:00:00Z"),
        completedOn: new Date("2026-09-05T00:30:00Z"),
      },
      new Date("2026-09-05T01:00:00Z"),
    );
    expect(summary).toMatchObject({
      id: ID,
      queue: "availability-request",
      lastError: "Resend 503",
      retryCount: 5,
      failedAt: "2026-09-05T00:30:00.000Z",
      ageMinutes: 30,
    });
    expect(JSON.stringify(summary)).not.toContain("secret-magic-link-token");
    expect(JSON.stringify(summary.data)).toContain("req-1");
  });

  it("falls back to the creation time when no completion is recorded", () => {
    const summary = summarizeFailedJob(
      {
        id: ID,
        name: "leave-decision",
        data: { leaveRequestId: "l1" },
        output: null,
        retryCount: 0,
        createdOn: new Date("2026-09-05T00:00:00Z"),
        completedOn: null,
      },
      new Date("2026-09-05T00:05:00Z"),
    );
    expect(summary.failedAt).toBeNull();
    expect(summary.lastError).toBeNull();
    expect(summary.ageMinutes).toBe(5);
  });
});
