/**
 * Request correlation id (OPS-01 item 4) — PURE.
 *
 * Every request gets an `x-request-id`: honoured from upstream when it is
 * already present and well-formed (a load balancer or a sister app forwarding
 * one), otherwise minted here. The proxy stamps it onto the request headers
 * (so server code can read it via `getRequestId()`) and echoes it on the
 * response (so a user or a support agent can quote it). Log lines and error
 * reports carry it, which is what lets one request's lines be joined.
 *
 * The incoming value is validated STRICTLY (charset + length) before it is
 * trusted: an id is only ever a correlation key, but it lands in logs and
 * error reports, so a client must not be able to inject arbitrary text.
 */

export const REQUEST_ID_HEADER = "x-request-id";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

/** A fresh id (UUID v4 — 36 chars, valid under the pattern above). */
export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/** The id to use for this request: the upstream one if usable, else new. */
export function resolveRequestId(incoming: string | null | undefined): string {
  return isValidRequestId(incoming) ? incoming : newRequestId();
}
