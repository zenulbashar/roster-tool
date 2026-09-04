import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/email";
import { esc } from "@/lib/email/escape";
import { reportError } from "@/lib/error-reporting";
import { sanitizeRecord } from "@/lib/audit/events";

/**
 * Dead-letter handling (OPS-02 / OPS-01 item 5).
 *
 * Every queue names `dead-letter` as its dead-letter queue, so a job that
 * exhausts its retries is MOVED there by pg-boss (same data, `output` = the
 * last failure) instead of being abandoned silently — which used to mean a
 * roster-publish email could be lost with no signal at all. This handler
 * never re-runs the work; it makes the loss VISIBLE: a structured error log
 * line, a report to the error tracker, and — when `OPS_ALERT_EMAIL` is set —
 * an email to the operators. The original job's payload is sanitised the
 * same way audit arguments are (no tokens, no binary), and only ids travel.
 */

export interface DeadLetteredJob {
  id: string;
  /** The dead-letter queue's own name (pg-boss renames the job). */
  name: string;
  data: unknown;
  /** pg-boss copies the failing job's last output/error here. */
  output?: unknown;
  retryCount?: number;
  createdOn?: Date;
}

/** Best-effort guess at where the job came from, from its payload shape. */
export function inferSourceQueue(data: unknown): string {
  if (!data || typeof data !== "object") return "unknown";
  const d = data as Record<string, unknown>;
  if (typeof d.sourceQueue === "string") return d.sourceQueue;
  if ("kind" in d && "businessId" in d) return "business-sweep";
  if ("requestId" in d && "token" in d) return "availability-request/reminder";
  if ("rosterPeriodId" in d) return "published-roster";
  if ("leaveRequestId" in d) return "leave-decision";
  if ("shiftOfferId" in d) return "shift-offer-decision";
  return "unknown";
}

export function parseAlertRecipients(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
}

export interface DeadLetterAlert {
  subject: string;
  html: string;
  text: string;
  source: string;
  summary: Record<string, unknown>;
}

export function buildDeadLetterAlert(
  job: DeadLetteredJob,
  at: Date,
): DeadLetterAlert {
  const source = inferSourceQueue(job.data);
  const data = sanitizeRecord(job.data);
  const output = sanitizeRecord(job.output ?? null);
  const summary = {
    jobId: job.id,
    source,
    retryCount: job.retryCount ?? null,
    createdOn: job.createdOn?.toISOString() ?? null,
    data,
    lastError: output,
  };
  const subject = `[Roster] Background job failed permanently: ${source}`;
  const text = [
    `A background job on "${source}" exhausted its retries and was moved to the dead-letter queue at ${at.toISOString()}.`,
    "",
    "It will NOT run again by itself. Investigate, fix the cause, then re-run it by hand.",
    "",
    `Job id: ${job.id}`,
    `Payload: ${JSON.stringify(data)}`,
    `Last error: ${JSON.stringify(output)}`,
  ].join("\n");
  const html = [
    `<p>A background job on <strong>${esc(source)}</strong> exhausted its retries and was moved to the dead-letter queue at ${esc(at.toISOString())}.</p>`,
    `<p>It will <strong>not</strong> run again by itself. Investigate, fix the cause, then re-run it by hand.</p>`,
    `<p>Job id: <code>${esc(job.id)}</code></p>`,
    `<pre style="white-space:pre-wrap">${esc(JSON.stringify(data, null, 2))}</pre>`,
    `<p>Last error:</p><pre style="white-space:pre-wrap">${esc(JSON.stringify(output, null, 2))}</pre>`,
  ].join("");
  return { subject, html, text, source, summary };
}

export interface DeadLetterDeps {
  send: typeof sendEmail;
  report: typeof reportError;
  /** Operator addresses; empty = log + report only (fail closed). */
  alertTo: string[];
}

export function defaultDeadLetterDeps(): DeadLetterDeps {
  return {
    send: sendEmail,
    report: reportError,
    alertTo: parseAlertRecipients(env.OPS_ALERT_EMAIL),
  };
}

/**
 * Make one dead-lettered job visible. Never throws for a missing alert
 * address; an email failure IS thrown so pg-boss retries the alert itself.
 */
export async function handleDeadLetter(
  job: DeadLetteredJob,
  deps: DeadLetterDeps = defaultDeadLetterDeps(),
  at: Date = new Date(),
): Promise<{ alerted: boolean; source: string }> {
  const alert = buildDeadLetterAlert(job, at);
  logger.error(alert.summary, "Job moved to the dead-letter queue");
  await deps.report({
    error: new Error(`Dead-lettered job on ${alert.source}`),
    tags: { source: "worker", event: "dead-letter", queue: alert.source },
  });
  if (deps.alertTo.length === 0) {
    logger.warn(
      { source: alert.source },
      "OPS_ALERT_EMAIL is not set — dead-letter alert logged only",
    );
    return { alerted: false, source: alert.source };
  }
  for (const to of deps.alertTo) {
    await deps.send({
      to,
      subject: alert.subject,
      html: alert.html,
      text: alert.text,
    });
  }
  return { alerted: true, source: alert.source };
}
