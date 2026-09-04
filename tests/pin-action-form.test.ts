import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PinActionForm } from "@/components/PinActionForm";

/**
 * COR-12 — the shift release / claim / cancel PIN forms on both clock surfaces
 * never posted `staffId`, which the shared PIN core requires alongside `pin`,
 * so every offer-up, claim, cross-location claim and cancel failed with "PIN
 * didn't match" from the day they shipped. Tests only ever exercised the cores
 * with hand-built FormData. This pins the FORM: both fields the core reads
 * must be present, plus the optional PROD-15 choice box.
 */
const noop = async () => ({ status: "idle" as const });

describe("PinActionForm posts what the PIN core reads", () => {
  it("carries the selected staff member and the PIN field", () => {
    const html = renderToStaticMarkup(
      createElement(PinActionForm, {
        action: noop,
        heading: "Offer up this shift?",
        details: "Mon 10/06 · Morning",
        staffId: "staff-123",
        hiddenName: "shiftId",
        hiddenValue: "shift-456",
        submitLabel: "Offer it up",
        backHref: "/kiosk?staff=staff-123&mode=myshifts",
      }),
    );
    expect(html).toContain('name="staffId"');
    expect(html).toContain('value="staff-123"');
    expect(html).toContain('name="pin"');
    expect(html).toContain('name="shiftId"');
    expect(html).toContain('value="shift-456"');
    expect(html).not.toContain('type="checkbox"');
  });

  it("renders the optional choice box, ticked by default when asked", () => {
    const html = renderToStaticMarkup(
      createElement(PinActionForm, {
        action: noop,
        heading: "Offer up this shift?",
        details: "x",
        staffId: "s",
        hiddenName: "shiftId",
        hiddenValue: "sh",
        submitLabel: "Go",
        backHref: "/",
        choice: {
          name: "coverElsewhere",
          label: "Let staff at my other locations cover it",
          hint: "Untick to keep it to this venue only.",
          defaultChecked: true,
        },
      }),
    );
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('name="coverElsewhere"');
    expect(html).toMatch(/<input[^>]*name="coverElsewhere"[^>]*checked/);
    expect(html).toContain("Let staff at my other locations cover it");
    expect(html).toContain("Untick to keep it to this venue only.");
  });
});
