import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `redirectIfAuthenticated` guards the owner sign-in flow: an already-signed-in
 * owner must be redirected to the dashboard (on page load AND form submit)
 * rather than shown the email form or sent a magic link, while an
 * unauthenticated visitor is left alone to use the form.
 */

const auth = vi.fn();
// `redirect` throws in real Next (to halt rendering); mirror that so callers
// stop, and so we can assert the destination.
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("next/navigation", () => ({ redirect }));

// Imported after the mocks are registered.
const { redirectIfAuthenticated } = await import("@/lib/auth/context");

describe("redirectIfAuthenticated", () => {
  beforeEach(() => {
    auth.mockReset();
    redirect.mockClear();
  });

  it("redirects an authenticated owner to /app", async () => {
    auth.mockResolvedValue({ user: { id: "u1", businessId: "b1" } });

    await expect(redirectIfAuthenticated()).rejects.toThrow("REDIRECT:/app");
    expect(redirect).toHaveBeenCalledWith("/app");
  });

  it("does nothing for an unauthenticated visitor (form stays available)", async () => {
    auth.mockResolvedValue(null);

    await expect(redirectIfAuthenticated()).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("does not redirect when the session has no user", async () => {
    auth.mockResolvedValue({ user: undefined });

    await expect(redirectIfAuthenticated()).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });
});
