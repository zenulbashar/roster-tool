import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorState } from "@/components/ErrorState";
import { NotFoundState } from "@/components/NotFoundState";
import { PageSkeleton } from "@/components/Skeleton";
import RootError from "@/app/error";
import OwnerError from "@/app/app/error";
import AdminError from "@/app/admin/error";
import GlobalError from "@/app/global-error";
import RootNotFound from "@/app/not-found";
import OwnerNotFound from "@/app/app/not-found";
import AdminNotFound from "@/app/admin/not-found";

/**
 * PERF-09 — the branded error / not-found / loading states. The app used to
 * ship with NONE of these files, so a server exception was Next's unbranded
 * page with no reference code and no way back. This pins that every route
 * group has its boundaries, that the reference code (Next's digest — the same
 * value the server logged) is shown, and that recovery affordances exist.
 */
const ROOT = resolve(__dirname, "..");

const BOUNDARY_FILES = [
  "src/app/global-error.tsx",
  "src/app/error.tsx",
  "src/app/not-found.tsx",
  "src/app/app/error.tsx",
  "src/app/app/not-found.tsx",
  "src/app/app/loading.tsx",
  "src/app/admin/error.tsx",
  "src/app/admin/not-found.tsx",
  "src/app/admin/loading.tsx",
  "src/instrumentation.ts",
  "src/proxy.ts",
];

const failure = Object.assign(new Error("Database exploded"), {
  digest: "3141592653",
});

describe("error boundaries exist for every route group", () => {
  it.each(BOUNDARY_FILES)("%s is present", (file) => {
    expect(existsSync(resolve(ROOT, file))).toBe(true);
  });
});

describe("ErrorState", () => {
  it("is a live region showing the reference code, a retry and a way home", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorState, {
        digest: "abc123",
        reset: () => {},
        homeHref: "/app",
        homeLabel: "Back to dashboard",
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("abc123");
    expect(html).toContain("Try again");
    expect(html).toContain('href="/app"');
    expect(html).toContain("Back to dashboard");
    // Never leaks the underlying error message — only the reference code.
    expect(html).not.toContain("Database exploded");
  });

  it("copes with a missing digest and no reset", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorState, { bare: true }),
    );
    expect(html).toContain("not available");
    expect(html).not.toContain("Try again");
    expect(html).toContain('id="main"');
  });
});

describe("route boundaries render the digest and never the error text", () => {
  it.each([
    ["root", RootError, "/"],
    ["owner", OwnerError, "/app"],
    ["admin", AdminError, "/admin/clients"],
  ] as const)("%s error.tsx", (_name, Component, home) => {
    const html = renderToStaticMarkup(
      createElement(Component, { error: failure, reset: () => {} }),
    );
    expect(html).toContain("3141592653");
    expect(html).toContain("Try again");
    expect(html).toContain(`href="${home}"`);
    expect(html).not.toContain("Database exploded");
  });

  it("global-error.tsx renders a self-contained document (no app CSS needed)", () => {
    const html = renderToStaticMarkup(
      createElement(GlobalError, { error: failure, reset: () => {} }),
    );
    expect(html.startsWith("<html")).toBe(true);
    expect(html).toContain("<body");
    expect(html).toContain('role="alert"');
    expect(html).toContain("3141592653");
    expect(html).toContain("Try again");
    expect(html).not.toContain("className=");
    expect(html).not.toContain("Database exploded");
  });
});

describe("not-found + loading states", () => {
  it.each([
    ["root", RootNotFound, "/"],
    ["owner", OwnerNotFound, "/app"],
    ["admin", AdminNotFound, "/admin/clients"],
  ] as const)("%s not-found.tsx offers a way back", (_n, Component, home) => {
    const html = renderToStaticMarkup(createElement(Component));
    expect(html).toContain("<h1");
    expect(html).toContain(`href="${home}"`);
  });

  it("NotFoundState never hints at what exists behind a 404", () => {
    const html = renderToStaticMarkup(createElement(NotFoundState, {}));
    expect(html).not.toMatch(/admin|sign in as/i);
  });

  it("the page skeleton is announced as busy and carries no real content", () => {
    const html = renderToStaticMarkup(createElement(PageSkeleton, {}));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading…");
    expect(html).toContain("rosterShimmer");
  });
});
