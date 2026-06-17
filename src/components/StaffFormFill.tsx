"use client";

import { useActionState } from "react";
import type { FormFieldTypeInput } from "@/lib/validation";
import { Banner, Button, Card } from "@/components/ui";

/**
 * The STAFF (PIN-gated, internal channel) form-fill UI. Adapted from
 * `PublicFormFill` but for the authenticated /me portal:
 *  - NO honeypot and NO Turnstile — the PIN gate is the control.
 *  - NO slug — the form id is in the route; the action re-resolves it.
 * Renders ONLY the safe field shape passed from the server —
 * { label, type, required, options:[{id,label}] } — never raw rows (which carry
 * business_id / internal columns). The respondent is resolved server-side from
 * the /me session, NEVER from this form.
 */

export type StaffField = {
  id: string;
  label: string;
  type: FormFieldTypeInput;
  required: boolean;
  options: { id: string; label: string }[];
};

export type StaffFillState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" }
  | { status: "already_responded" };

const initial: StaffFillState = { status: "idle" };

const inputClass =
  "block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-ink)]";

function FieldInput({ field }: { field: StaffField }) {
  const name = `field_${field.id}`;
  switch (field.type) {
    case "long_text":
      return (
        <textarea
          name={name}
          rows={4}
          required={field.required}
          maxLength={5000}
          className={inputClass}
          aria-label={field.label}
        />
      );
    case "single_select":
      return (
        <div className="space-y-2">
          {field.options.map((o) => (
            <label key={o.id} className="flex items-center gap-2">
              <input
                type="radio"
                name={name}
                value={o.id}
                required={field.required}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      );
    case "yes_no":
      return (
        <div className="flex gap-4">
          {["yes", "no"].map((v) => (
            <label key={v} className="flex items-center gap-2">
              <input
                type="radio"
                name={name}
                value={v}
                required={field.required}
              />
              <span>{v === "yes" ? "Yes" : "No"}</span>
            </label>
          ))}
        </div>
      );
    case "rating":
      return (
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="flex flex-col items-center gap-1">
              <input
                type="radio"
                name={name}
                value={n}
                required={field.required}
              />
              <span className="text-sm">{n}</span>
            </label>
          ))}
        </div>
      );
    default:
      return (
        <input
          type="text"
          name={name}
          required={field.required}
          maxLength={500}
          className={inputClass}
          aria-label={field.label}
        />
      );
  }
}

export function StaffFormFill({
  formId,
  title,
  description,
  anonymous,
  fields,
  action,
}: {
  formId: string;
  title: string;
  description: string | null;
  anonymous: boolean;
  fields: StaffField[];
  action: (prev: StaffFillState, formData: FormData) => Promise<StaffFillState>;
}) {
  const [state, formAction, pending] = useActionState(action, initial);

  if (state.status === "success") {
    return (
      <Card className="text-center">
        <h1 className="text-2xl font-bold">Thank you</h1>
        <p className="mt-2 text-[var(--color-muted)]">
          Your response has been recorded.
        </p>
      </Card>
    );
  }

  if (state.status === "already_responded") {
    return (
      <Card className="text-center">
        <h1 className="text-2xl font-bold">Already responded</h1>
        <p className="mt-2 text-[var(--color-muted)]">
          You&rsquo;ve already filled in this form. Thanks!
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-2xl font-bold">{title}</h1>
      {description ? (
        <p className="mt-1 text-[var(--color-muted)]">{description}</p>
      ) : null}

      <p className="mt-3 text-sm text-[var(--color-muted)]">
        {anonymous
          ? "Your response is anonymous — it isn’t linked to your name."
          : "Your name is recorded with this response."}
      </p>

      {state.status === "error" ? (
        <div className="mt-4">
          <Banner tone="warn">{state.message}</Banner>
        </div>
      ) : null}

      <form action={formAction} className="mt-5 space-y-5">
        <input type="hidden" name="formId" value={formId} />
        {fields.map((field) => (
          <fieldset key={field.id}>
            <legend className="mb-1 block text-sm font-semibold text-[var(--color-ink)]">
              {field.label}
              {field.required ? (
                <span className="ml-1 text-[var(--color-danger)]">*</span>
              ) : null}
            </legend>
            <FieldInput field={field} />
          </fieldset>
        ))}

        <Button type="submit" disabled={pending}>
          {pending ? "Submitting…" : "Submit"}
        </Button>
      </form>
    </Card>
  );
}
