import type { FormFieldTypeInput } from "@/lib/validation";

/**
 * Server-side validation of a PUBLIC form submission against the form's live
 * field definitions. This is the security core of the public route: field ids
 * and values from an anonymous client are NEVER trusted — every answer is
 * checked against the actual fields, and unknown field ids are rejected.
 *
 * Pure + unit-tested. The route resolves the form, loads its fields, then calls
 * this; on success it hands the returned rows straight to the repo.
 */

/** A form field as the validator needs it (no business_id / internal columns). */
export type SubmissionField = {
  id: string;
  label: string;
  type: FormFieldTypeInput;
  required: boolean;
  options: { id: string; label: string }[];
};

/**
 * One validated answer ready to store. Carries the field IDENTITY SNAPSHOT
 * (label + type) alongside the value so the stored answer is self-describing and
 * survives later field edits/deletion. Exactly one of valueText/valueNumber is
 * set (rating -> number, everything else -> text).
 */
export type AnswerRow = {
  fieldId: string;
  fieldLabel: string;
  fieldType: FormFieldTypeInput;
  valueText: string | null;
  valueNumber: number | null;
};

// Length caps to bound stored text (a public, anonymous surface).
export const SHORT_TEXT_MAX = 500;
export const LONG_TEXT_MAX = 5000;

function textAnswer(field: SubmissionField, value: string): AnswerRow {
  return {
    fieldId: field.id,
    fieldLabel: field.label,
    fieldType: field.type,
    valueText: value,
    valueNumber: null,
  };
}

function numberAnswer(field: SubmissionField, value: number): AnswerRow {
  return {
    fieldId: field.id,
    fieldLabel: field.label,
    fieldType: field.type,
    valueText: null,
    valueNumber: value,
  };
}

export type SubmissionResult =
  | { ok: true; rows: AnswerRow[] }
  | { ok: false; error: string };

export function validatePublicSubmission(
  fields: SubmissionField[],
  rawAnswers: Record<string, unknown>,
): SubmissionResult {
  const knownIds = new Set(fields.map((f) => f.id));

  // Reject unknown/extra field ids outright — the client must not invent fields.
  for (const key of Object.keys(rawAnswers)) {
    if (!knownIds.has(key)) {
      return {
        ok: false,
        error: "This form has changed. Please reload and try again.",
      };
    }
  }

  const rows: AnswerRow[] = [];
  for (const field of fields) {
    const raw = rawAnswers[field.id];
    const provided =
      raw !== undefined && raw !== null && String(raw).trim() !== "";

    if (!provided) {
      if (field.required) {
        return { ok: false, error: `"${field.label}" is required.` };
      }
      continue; // optional + blank → no answer row
    }

    switch (field.type) {
      case "short_text":
      case "long_text": {
        const text = String(raw).trim();
        const max =
          field.type === "short_text" ? SHORT_TEXT_MAX : LONG_TEXT_MAX;
        if (text.length > max) {
          return { ok: false, error: `"${field.label}" is too long.` };
        }
        rows.push(textAnswer(field, text));
        break;
      }
      case "yes_no": {
        const v = String(raw).trim().toLowerCase();
        if (v !== "yes" && v !== "no") {
          return { ok: false, error: `"${field.label}" must be Yes or No.` };
        }
        rows.push(textAnswer(field, v === "yes" ? "Yes" : "No"));
        break;
      }
      case "single_select": {
        // The submitted value is an option ID; it MUST be one of THIS field's
        // stored option ids. We then store the chosen option's LABEL (a
        // point-in-time, human-readable snapshot).
        const optionId = String(raw);
        const option = field.options.find((o) => o.id === optionId);
        if (!option) {
          return {
            ok: false,
            error: `"${field.label}" has an invalid choice.`,
          };
        }
        rows.push(textAnswer(field, option.label));
        break;
      }
      case "rating": {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > 5) {
          return {
            ok: false,
            error: `"${field.label}" must be a rating from 1 to 5.`,
          };
        }
        rows.push(numberAnswer(field, n));
        break;
      }
      default:
        return { ok: false, error: "Unsupported field type." };
    }
  }

  return { ok: true, rows };
}
