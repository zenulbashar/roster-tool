import { describe, it, expect, vi } from "vitest";
import {
  buildDeadLetterAlert,
  handleDeadLetter,
  inferSourceQueue,
  parseAlertRecipients,
} from "@/lib/jobs/dead-letter";
import type { OutgoingEmail } from "@/lib/email/transport";
import type { ErrorReportInput } from "@/lib/error-reporting";

const sendSpy = () => vi.fn(async (_msg: OutgoingEmail) => {});
const reportSpy = () => vi.fn(async (_input: ErrorReportInput) => {});

/**
 * OPS-02 — a job that exhausts its retries must become VISIBLE: logged,
 * reported, and (when an operator address is configured) emailed, with the
 * payload sanitised so a magic-link token never leaves the process.
 */
describe("dead-letter handling", () => {
  it("infers the source queue from the payload shape", () => {
    expect(inferSourceQueue({ kind: "certReminder", businessId: "b" })).toBe(
      "business-sweep",
    );
    expect(inferSourceQueue({ requestId: "r", token: "t" })).toBe(
      "availability-request/reminder",
    );
    expect(inferSourceQueue({ rosterPeriodId: "p", staffMemberId: "s" })).toBe(
      "published-roster",
    );
    expect(inferSourceQueue({ leaveRequestId: "l" })).toBe("leave-decision");
    expect(inferSourceQueue({ shiftOfferId: "o" })).toBe(
      "shift-offer-decision",
    );
    expect(inferSourceQueue({ sourceQueue: "custom" })).toBe("custom");
    expect(inferSourceQueue(null)).toBe("unknown");
    expect(inferSourceQueue({})).toBe("unknown");
  });

  it("parses operator addresses leniently", () => {
    expect(
      parseAlertRecipients("ops@zale.test, oncall@zale.test\nbad"),
    ).toEqual(["ops@zale.test", "oncall@zale.test"]);
    expect(parseAlertRecipients(undefined)).toEqual([]);
    expect(parseAlertRecipients("")).toEqual([]);
  });

  it("builds an alert that names the source and never carries a token", () => {
    const alert = buildDeadLetterAlert(
      {
        id: "job-1",
        name: "dead-letter",
        data: { requestId: "req-1", token: "supersecrettoken" },
        output: { message: "SMTP connection refused" },
        retryCount: 5,
        createdOn: new Date("2026-09-04T10:00:00Z"),
      },
      new Date("2026-09-04T11:00:00Z"),
    );
    expect(alert.source).toBe("availability-request/reminder");
    expect(alert.subject).toContain("availability-request/reminder");
    expect(alert.text).not.toContain("supersecrettoken");
    expect(alert.html).not.toContain("supersecrettoken");
    expect(alert.text).toContain("[redacted]");
    expect(alert.text).toContain("SMTP connection refused");
    expect(alert.summary).toMatchObject({
      jobId: "job-1",
      retryCount: 5,
      lastError: { message: "SMTP connection refused" },
    });
  });

  it("fails closed without an operator address: reports, logs, sends nothing", async () => {
    const send = sendSpy();
    const report = reportSpy();
    const res = await handleDeadLetter(
      { id: "j", name: "dead-letter", data: { leaveRequestId: "x" } },
      { send, report, alertTo: [] },
    );
    expect(res).toEqual({ alerted: false, source: "leave-decision" });
    expect(send).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![0]).toMatchObject({
      tags: { event: "dead-letter", queue: "leave-decision" },
    });
  });

  it("emails every operator address, and a send failure propagates so the alert itself retries", async () => {
    const send = sendSpy();
    const report = reportSpy();
    const res = await handleDeadLetter(
      { id: "j", name: "dead-letter", data: { shiftOfferId: "x" } },
      { send, report, alertTo: ["a@ops.test", "b@ops.test"] },
    );
    expect(res.alerted).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0]).toMatchObject({
      to: "a@ops.test",
      subject: expect.stringContaining("shift-offer-decision"),
    });

    const failing = vi.fn(async () => {
      throw new Error("mail down");
    });
    await expect(
      handleDeadLetter(
        { id: "j2", name: "dead-letter", data: {} },
        { send: failing, report, alertTo: ["a@ops.test"] },
      ),
    ).rejects.toThrow("mail down");
  });
});
