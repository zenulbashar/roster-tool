/**
 * Liveness (OPS-01): the web process is up and answering. No dependencies are
 * consulted — use /api/ready for that. Cheap enough for a platform to poll.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, at: new Date().toISOString() });
}
