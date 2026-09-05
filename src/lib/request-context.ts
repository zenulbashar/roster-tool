import { cache } from "react";
import { headers } from "next/headers";
import { logger } from "@/lib/logger";
import { REQUEST_ID_HEADER, isValidRequestId } from "@/lib/request-id";

/**
 * Per-request context for server code (OPS-01 item 4).
 *
 * `getRequestId()` reads the correlation id the proxy stamped onto the
 * request (`x-request-id`), memoised per request with `React.cache`. Outside a
 * request scope — a job, a script, a test — `headers()` throws, and the id is
 * simply null: nothing here may ever break a code path that also runs in the
 * worker.
 *
 * `requestLogger()` is the logger to use inside pages, layouts, route
 * handlers and server actions: a pino child bound to the request id (plus any
 * extra bindings such as `businessId`) so every line from one request can be
 * joined, and joined to the error report the instrumentation hook files for
 * it. The module-level `logger` stays right for code that runs outside a
 * request.
 */
export const getRequestId = cache(async (): Promise<string | null> => {
  try {
    const value = (await headers()).get(REQUEST_ID_HEADER);
    return isValidRequestId(value) ? value : null;
  } catch {
    return null;
  }
});

export async function requestLogger(
  bindings: Record<string, unknown> = {},
): Promise<typeof logger> {
  const requestId = await getRequestId();
  return logger.child(requestId ? { requestId, ...bindings } : bindings);
}
