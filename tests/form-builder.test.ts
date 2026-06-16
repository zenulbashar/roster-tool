import { describe, it, expect } from "vitest";
import {
  createFormSchema,
  formFieldSchema,
  formSaveSchema,
} from "@/lib/validation";

/**
 * Pure validation coverage for the form builder (Phase 1a). Server-side Zod is
 * authoritative regardless of client checks, so these lock the rules the UI
 * mirrors: title/label required, the type set, the single_select options rule
 * (>=1 non-empty; ignored/emptied for other types), and a zero-field draft
 * being valid.
 */
describe("form builder validation", () => {
  describe("createFormSchema", () => {
    it("requires a non-empty title", () => {
      expect(createFormSchema.safeParse({ title: "" }).success).toBe(false);
      expect(createFormSchema.safeParse({ title: "   " }).success).toBe(false);
    });

    it("accepts a trimmed title", () => {
      const parsed = createFormSchema.safeParse({ title: "  Feedback  " });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.title).toBe("Feedback");
    });

    it("rejects an over-long title", () => {
      expect(
        createFormSchema.safeParse({ title: "x".repeat(201) }).success,
      ).toBe(false);
    });
  });

  describe("formSaveSchema", () => {
    it("rejects an empty title", () => {
      const r = formSaveSchema.safeParse({ title: "", fields: [] });
      expect(r.success).toBe(false);
    });

    it("accepts a zero-field draft", () => {
      const r = formSaveSchema.safeParse({
        title: "Mid-build",
        description: "",
        fields: [],
      });
      expect(r.success).toBe(true);
      expect(r.success && r.data.fields).toEqual([]);
    });

    it("rejects an over-long description", () => {
      const r = formSaveSchema.safeParse({
        title: "T",
        description: "x".repeat(2001),
        fields: [],
      });
      expect(r.success).toBe(false);
    });
  });

  describe("formFieldSchema", () => {
    it("rejects an empty label", () => {
      const r = formFieldSchema.safeParse({ label: "", type: "short_text" });
      expect(r.success).toBe(false);
    });

    it("rejects an unknown type", () => {
      const r = formFieldSchema.safeParse({ label: "Q", type: "rainbow" });
      expect(r.success).toBe(false);
    });

    it("defaults required to false and options to []", () => {
      const r = formFieldSchema.safeParse({
        label: "Name",
        type: "short_text",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.required).toBe(false);
        expect(r.data.options).toEqual([]);
      }
    });

    it("rejects single_select with no options", () => {
      const r = formFieldSchema.safeParse({
        label: "Pick one",
        type: "single_select",
        options: [],
      });
      expect(r.success).toBe(false);
    });

    it("rejects single_select whose only option is blank", () => {
      const r = formFieldSchema.safeParse({
        label: "Pick one",
        type: "single_select",
        options: [{ label: "   " }],
      });
      expect(r.success).toBe(false);
    });

    it("accepts single_select with options and preserves option ids", () => {
      const r = formFieldSchema.safeParse({
        label: "Size",
        type: "single_select",
        required: true,
        options: [
          { id: "opt-1", label: "Small" },
          { label: "Large" },
          { label: "" },
        ],
      });
      expect(r.success).toBe(true);
      if (r.success) {
        // Blank option dropped; existing id preserved; new option keeps no id
        // (the repo generates it on insert).
        expect(r.data.options).toEqual([
          { id: "opt-1", label: "Small" },
          { label: "Large" },
        ]);
      }
    });

    it("ignores (empties) options for non-single_select types", () => {
      const r = formFieldSchema.safeParse({
        label: "Notes",
        type: "long_text",
        options: [{ label: "stray" }],
      });
      expect(r.success).toBe(true);
      expect(r.success && r.data.options).toEqual([]);
    });
  });
});
