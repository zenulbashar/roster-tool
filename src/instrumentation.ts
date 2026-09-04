import type { Instrumentation } from "next";
import { REQUEST_ID_HEADER, isValidRequestId } from "@/lib/request-id";

/**
 * Next.js instrumentation (OPS-01 items 3/4/6).
 *
 * `onRequestError` is called by Next for EVERY unhandled server error — a
 * page render, a server action, a route handler, the proxy — with the error
 * (carrying the `digest` the branded error page shows as its reference code)
 * and the request's path/method/headers. It files ONE report: a structured
 * log line plus best-effort forwarding to the error tracker when a DSN is
 * configured. Only the correlation id is taken from the headers — never
 * cookies, authorization or the body.
 *
 * The hook can run in the edge runtime too, where pino cannot; the reporter
 * is imported lazily inside the Node.js branch so the edge bundle never pulls
 * it in.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/lib/error-reporting");
  const raw = request.headers[REQUEST_ID_HEADER];
  const requestId = Array.isArray(raw) ? raw[0] : raw;
  await reportError({
    error,
    digest: (error as { digest?: string } | null)?.digest ?? null,
    requestId: isValidRequestId(requestId) ? requestId : null,
    path: request.path,
    method: request.method,
    tags: {
      source: "web",
      routeType: context.routeType,
      routePath: context.routePath,
      renderSource: context.renderSource,
    },
  });
};
