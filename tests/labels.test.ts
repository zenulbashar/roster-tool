import { describe, it, expect } from "vitest";
import { rosterActionLabel, rosterBuildVerb } from "@/lib/labels";

describe("rosterActionLabel", () => {
  it("invites building while not yet published", () => {
    for (const status of ["draft", "collecting", "building"]) {
      expect(rosterActionLabel(status)).toBe("Build the roster");
    }
  });

  it("switches to edit wording once published", () => {
    expect(rosterActionLabel("published")).toBe("Edit roster");
  });
});

describe("rosterBuildVerb", () => {
  it("is 'Build' until published, then 'Edit'", () => {
    expect(rosterBuildVerb("building")).toBe("Build");
    expect(rosterBuildVerb("collecting")).toBe("Build");
    expect(rosterBuildVerb("published")).toBe("Edit");
  });
});
