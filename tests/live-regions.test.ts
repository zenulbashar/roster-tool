import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Banner, Toast } from "@/components/ui";
import { KioskSuccess } from "@/components/KioskForm";

/**
 * UX-03 / WCAG 4.1.3 Status Messages: every action result is a live region,
 * so a screen-reader user hears "Clocked in", "That PIN didn't match" or
 * "Couldn't save" without moving focus. Errors are ASSERTIVE (`alert`), the
 * rest POLITE (`status`).
 */
describe("result banners are live regions", () => {
  it("Banner: error is role=alert, every other tone role=status", () => {
    const html = (tone: "info" | "success" | "warn" | "error") =>
      renderToStaticMarkup(
        createElement(Banner, { tone, children: "Message" }),
      );
    expect(html("error")).toContain('role="alert"');
    for (const tone of ["info", "success", "warn"] as const) {
      expect(html(tone)).toContain('role="status"');
      expect(html(tone)).not.toContain('role="alert"');
    }
  });

  it("Banner defaults to a polite status region", () => {
    expect(
      renderToStaticMarkup(createElement(Banner, { children: "Saved" })),
    ).toContain('role="status"');
  });

  it("the toast and the kiosk success panel are status regions", () => {
    expect(
      renderToStaticMarkup(createElement(Toast, { children: "Done" })),
    ).toContain('role="status"');
    const kiosk = renderToStaticMarkup(
      createElement(KioskSuccess, {
        message: "Clocked in at 9:02 am",
        backHref: "/kiosk",
      }),
    );
    expect(kiosk).toContain('role="status"');
    expect(kiosk).toContain("Clocked in at 9:02 am");
  });
});

/**
 * Regression guard: a failed action's message must use the `error` tone (an
 * alert), never `warn` (a polite status that a screen reader may not surface
 * in time). The surfaces below render the result of a submit.
 */
describe("failed-action messages use the alert tone", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".tsx")) out.push(p);
    }
    return out;
  }

  it("no result banner is rendered with tone=warn", () => {
    const offenders: string[] = [];
    const resultExpr =
      /<Banner tone="warn">\{(sp\.\w*[eE]rror\w*|loadError|error|errorMessage|geoError|state\.message)\}/;
    for (const file of walk(join(process.cwd(), "src"))) {
      const text = readFileSync(file, "utf8");
      if (resultExpr.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("the kiosk and phone clock-in success screens are status regions", () => {
    for (const rel of [
      "src/components/KioskClockForm.tsx",
      "src/components/PersonalClockForm.tsx",
    ]) {
      const text = readFileSync(join(process.cwd(), rel), "utf8");
      // The render branch (not the camera-release effect that also checks it).
      const success = text.indexOf('if (state.status === "success") {');
      expect(success, rel).toBeGreaterThan(0);
      // The first element rendered for the success state carries the role.
      const tail = text.slice(success, success + 400);
      expect(tail, rel).toContain('role="status"');
    }
  });
});
