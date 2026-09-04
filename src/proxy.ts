import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/request-id";

/**
 * Request proxy (OPS-01 item 4): give every request a correlation id.
 *
 * The id is honoured from upstream when present and well-formed, otherwise
 * minted; it is stamped onto the REQUEST headers (so `getRequestId()` /
 * `requestLogger()` and the instrumentation hook can read it) and echoed on
 * the RESPONSE (so whoever sees a failure can quote it). Nothing else happens
 * here — auth, tenancy and security headers live where they always did.
 */
export function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  // Everything except static assets — those never reach server code.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
