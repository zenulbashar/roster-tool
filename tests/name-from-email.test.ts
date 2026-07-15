import { describe, it, expect } from "vitest";
import { nameFromEmail } from "@/lib/name-from-email";

describe("nameFromEmail", () => {
  const cases: [string, string][] = [
    ["john.doe@cafe.com", "John Doe"],
    ["mary_jane.smith@x.com", "Mary Jane Smith"],
    ["j.doe+roster@x.com", "J Doe"],
    ["roster123@x.com", "Roster"],
    ["JANE@x.com", "Jane"],
    ["anna-marie@x.com", "Anna Marie"],
    ["bob@x.com", "Bob"],
  ];

  it.each(cases)("derives %j -> %j", (email, expected) => {
    expect(nameFromEmail(email)).toBe(expected);
  });

  it("returns empty string when nothing usable remains", () => {
    expect(nameFromEmail("12345@x.com")).toBe("");
    expect(nameFromEmail("@x.com")).toBe("");
    expect(nameFromEmail("")).toBe("");
  });

  it("handles a raw local part with no @ sign", () => {
    expect(nameFromEmail("john.doe")).toBe("John Doe");
  });
});
