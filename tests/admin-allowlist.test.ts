import { describe, it, expect } from "vitest";
import { parseAdminAllowlist, isEmailAllowed } from "@/lib/admin/allowlist";

describe("parseAdminAllowlist", () => {
  it("returns [] for unset/empty input", () => {
    expect(parseAdminAllowlist(undefined)).toEqual([]);
    expect(parseAdminAllowlist(null)).toEqual([]);
    expect(parseAdminAllowlist("")).toEqual([]);
    expect(parseAdminAllowlist("   ")).toEqual([]);
  });

  it("splits on commas and whitespace, trims, lowercases", () => {
    expect(
      parseAdminAllowlist("Priya@Zaleit.com.au, ops@zaleit.com.au"),
    ).toEqual(["priya@zaleit.com.au", "ops@zaleit.com.au"]);
    expect(parseAdminAllowlist("a@x.com\n b@x.com\tc@x.com")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
  });

  it("dedupes case-insensitively", () => {
    expect(parseAdminAllowlist("A@x.com, a@x.com, A@X.COM")).toEqual([
      "a@x.com",
    ]);
  });
});

describe("isEmailAllowed", () => {
  const allow = parseAdminAllowlist("priya@zaleit.com.au, ops@zaleit.com.au");

  it("matches case-insensitively and trims", () => {
    expect(isEmailAllowed("priya@zaleit.com.au", allow)).toBe(true);
    expect(isEmailAllowed("PRIYA@Zaleit.com.au", allow)).toBe(true);
    expect(isEmailAllowed("  ops@zaleit.com.au  ", allow)).toBe(true);
  });

  it("rejects non-members, null/undefined, and against an empty list", () => {
    expect(isEmailAllowed("owner@cafe.com", allow)).toBe(false);
    expect(isEmailAllowed(null, allow)).toBe(false);
    expect(isEmailAllowed(undefined, allow)).toBe(false);
    expect(isEmailAllowed("priya@zaleit.com.au", [])).toBe(false);
  });
});
