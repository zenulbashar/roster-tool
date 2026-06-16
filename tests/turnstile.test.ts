import { describe, it, expect, vi, beforeEach } from "vitest";

// Control the secret via a mocked env, and silence the logger. `vi.hoisted` so
// the value exists when the hoisted `vi.mock` factory runs.
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { TURNSTILE_SECRET_KEY: "test-secret" as string | undefined },
}));
vi.mock("@/lib/env", () => ({ env: mockEnv }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { verifyTurnstile } from "@/lib/turnstile";

function mockFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("verifyTurnstile", () => {
  beforeEach(() => {
    mockEnv.TURNSTILE_SECRET_KEY = "test-secret";
    vi.unstubAllGlobals();
  });

  it("returns true when siteverify reports success", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      ),
    );
    expect(await verifyTurnstile("good-token")).toBe(true);
  });

  it("returns false when siteverify reports failure", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: false }), { status: 200 }),
      ),
    );
    expect(await verifyTurnstile("bad-token")).toBe(false);
  });

  it("returns false for an absent token without calling siteverify", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await verifyTurnstile(null)).toBe(false);
    expect(await verifyTurnstile("")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed when the secret is missing (no siteverify call)", async () => {
    mockEnv.TURNSTILE_SECRET_KEY = undefined;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await verifyTurnstile("any-token")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns false on an HTTP error from siteverify", async () => {
    mockFetch(() => Promise.resolve(new Response("nope", { status: 500 })));
    expect(await verifyTurnstile("good-token")).toBe(false);
  });

  it("returns false when the request throws", async () => {
    mockFetch(() => Promise.reject(new Error("network down")));
    expect(await verifyTurnstile("good-token")).toBe(false);
  });
});
