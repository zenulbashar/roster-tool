import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import {
  REQUEST_ID_HEADER,
  isValidRequestId,
  newRequestId,
  resolveRequestId,
} from "@/lib/request-id";
import { proxy } from "@/proxy";

/**
 * OPS-01 item 4 — request correlation ids. The proxy must give every request
 * an id (honouring a well-formed upstream one), stamp it on the request the
 * app sees, and echo it on the response; and it must never trust an upstream
 * value that could inject text into logs.
 */
describe("request id (pure)", () => {
  it("accepts well-formed ids and rejects everything else", () => {
    expect(isValidRequestId("req-12345678")).toBe(true);
    expect(isValidRequestId(newRequestId())).toBe(true);
    expect(isValidRequestId("syd1::abcd-1712345678901-0123456789ab")).toBe(
      true,
    );
    expect(isValidRequestId("short")).toBe(false);
    expect(isValidRequestId("")).toBe(false);
    expect(isValidRequestId(null)).toBe(false);
    expect(isValidRequestId("has spaces in it")).toBe(false);
    expect(isValidRequestId("newline\ninjection-attempt")).toBe(false);
    expect(isValidRequestId("<script>alert(1)</script>")).toBe(false);
    expect(isValidRequestId("-leading-punctuation")).toBe(false);
    expect(isValidRequestId("x".repeat(129))).toBe(false);
  });

  it("honours a valid upstream id and mints a fresh one otherwise", () => {
    expect(resolveRequestId("upstream-abc-123")).toBe("upstream-abc-123");
    const minted = resolveRequestId("bad value");
    expect(isValidRequestId(minted)).toBe(true);
    expect(minted).not.toBe("bad value");
    expect(resolveRequestId(null)).not.toBe(resolveRequestId(null));
  });
});

describe("proxy", () => {
  it("stamps a fresh id on the request headers and echoes it on the response", () => {
    const req = new NextRequest("http://localhost:3000/app/staff");
    const res = proxy(req);
    const echoed = res.headers.get(REQUEST_ID_HEADER);
    expect(isValidRequestId(echoed)).toBe(true);
    // NextResponse.next({ request }) forwards overridden request headers as
    // x-middleware-request-<name>; the app reads x-request-id from there.
    expect(res.headers.get(`x-middleware-request-${REQUEST_ID_HEADER}`)).toBe(
      echoed,
    );
  });

  it("keeps a well-formed upstream id and replaces a malformed one", () => {
    const good = new NextRequest("http://localhost:3000/app", {
      headers: { [REQUEST_ID_HEADER]: "edge-4f2c9a1b-77" },
    });
    expect(proxy(good).headers.get(REQUEST_ID_HEADER)).toBe("edge-4f2c9a1b-77");

    const bad = new NextRequest("http://localhost:3000/app", {
      headers: { [REQUEST_ID_HEADER]: "not ok" },
    });
    const replaced = proxy(bad).headers.get(REQUEST_ID_HEADER);
    expect(replaced).not.toBe("not ok");
    expect(isValidRequestId(replaced)).toBe(true);
  });
});
