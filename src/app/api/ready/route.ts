import { readinessChecks } from "@/lib/health";

/**
 * Readiness (OPS-01): the database answers AND a background worker has
 * checked in within the staleness window AND the job queue is draining (no
 * due job waiting over an hour). Answers 503 with the failing checks named,
 * so an uptime monitor on this URL is the alert that catches a dead, wedged
 * or stalled worker — the product's most likely silent outage (every email
 * flows through it). Exposes no tenant data.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const checks = await readinessChecks();
  const ok = checks.database && checks.worker && checks.queue;
  return Response.json(
    { ok, checks, at: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
