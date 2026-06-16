import { describe, it, expect } from "vitest";
import {
  validatePublicSubmission,
  type SubmissionField,
  SHORT_TEXT_MAX,
  LONG_TEXT_MAX,
} from "@/lib/form-submission";

const nameField: SubmissionField = {
  id: "f-name",
  label: "Your name",
  type: "short_text",
  required: true,
  options: [],
};
const commentsField: SubmissionField = {
  id: "f-comments",
  label: "Comments",
  type: "long_text",
  required: false,
  options: [],
};
const sizeField: SubmissionField = {
  id: "f-size",
  label: "Size",
  type: "single_select",
  required: true,
  options: [
    { id: "opt-s", label: "Small" },
    { id: "opt-l", label: "Large" },
  ],
};
const ratingField: SubmissionField = {
  id: "f-rating",
  label: "Rating",
  type: "rating",
  required: true,
  options: [],
};
const yesNoField: SubmissionField = {
  id: "f-yn",
  label: "Return?",
  type: "yes_no",
  required: true,
  options: [],
};

const allFields = [
  nameField,
  sizeField,
  ratingField,
  yesNoField,
  commentsField,
];

function validAnswers() {
  return {
    "f-name": "Ada",
    "f-size": "opt-l",
    "f-rating": "4",
    "f-yn": "yes",
  } as Record<string, unknown>;
}

describe("validatePublicSubmission", () => {
  it("accepts a valid submission and maps values by type", () => {
    const r = validatePublicSubmission(allFields, validAnswers());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const byField = Object.fromEntries(r.rows.map((row) => [row.fieldId, row]));
    // Text answer.
    expect(byField["f-name"]).toMatchObject({
      valueText: "Ada",
      valueNumber: null,
      fieldLabel: "Your name",
      fieldType: "short_text",
    });
    // single_select stores the chosen option LABEL, not the id.
    expect(byField["f-size"]).toMatchObject({
      valueText: "Large",
      valueNumber: null,
    });
    // rating lands in valueNumber.
    expect(byField["f-rating"]).toMatchObject({
      valueText: null,
      valueNumber: 4,
    });
    // yes_no normalised.
    expect(byField["f-yn"]).toMatchObject({ valueText: "Yes" });
    // Optional unanswered field produces no row.
    expect(byField["f-comments"]).toBeUndefined();
  });

  it("rejects a missing required field", () => {
    const a = validAnswers();
    delete a["f-name"];
    const r = validatePublicSubmission(allFields, a);
    expect(r.ok).toBe(false);
  });

  it("rejects a single_select value not in the field's options", () => {
    const a = validAnswers();
    a["f-size"] = "opt-does-not-exist";
    const r = validatePublicSubmission(allFields, a);
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown / extra field id", () => {
    const a = validAnswers();
    a["f-evil"] = "anything";
    const r = validatePublicSubmission(allFields, a);
    expect(r.ok).toBe(false);
  });

  it("rejects a rating out of range and a non-integer rating", () => {
    for (const bad of ["0", "6", "3.5", "abc"]) {
      const a = validAnswers();
      a["f-rating"] = bad;
      expect(validatePublicSubmission(allFields, a).ok).toBe(false);
    }
  });

  it("rejects an invalid yes_no value", () => {
    const a = validAnswers();
    a["f-yn"] = "maybe";
    expect(validatePublicSubmission(allFields, a).ok).toBe(false);
  });

  it("enforces text length caps", () => {
    const longShort = validatePublicSubmission([nameField], {
      "f-name": "x".repeat(SHORT_TEXT_MAX + 1),
    });
    expect(longShort.ok).toBe(false);

    const longLong = validatePublicSubmission([commentsField], {
      "f-comments": "x".repeat(LONG_TEXT_MAX + 1),
    });
    expect(longLong.ok).toBe(false);
  });

  it("accepts an optional field left blank and trims text", () => {
    const r = validatePublicSubmission([nameField, commentsField], {
      "f-name": "  Grace  ",
      "f-comments": "   ",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.valueText).toBe("Grace");
  });
});
