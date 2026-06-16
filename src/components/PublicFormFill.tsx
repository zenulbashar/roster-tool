"use client";

import { useActionState } from "react";
import type { FormFieldTypeInput } from "@/lib/validation";
import { Banner, Button, Card } from "@/components/ui";
import { TurnstileWidget } from "@/components/TurnstileWidget";

/**
 * The PUBLIC (unauthenticated) form-fill UI. Renders only the safe field shape
 * passed from the server — { label, type, required, options:[{id,label}] } —
 * never raw rows (which carry business_id / public_slug). Submits to a server
 * action that verifies Turnstile, rate-limits, validates and stores. Includes a
 * honeypot field a real person never fills. On success it shows a thank-you and
 * echoes nothing back.
 */

export type PublicField = {
  id: string;
  label: string;
  type: FormFieldTypeInput;
  required: boolean;
  options: { id: string; label: string }[];
};

export type PublicFillState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

const initial: PublicFillState = { status: "idle" };

const inputClass =
  "block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-ink)]";

function FieldInput({ field }: { field: PublicField }) {
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

export function PublicFormFill({
  slug,
  title,
  description,
  fields,
  action,
  turnstileSiteKey,
  source,
}: {
  slug: string;
  title: string;
  description: string | null;
  fields: PublicField[];
  action: (
    prev: PublicFillState,
    formData: FormData,
  ) => Promise<PublicFillState>;
  turnstileSiteKey: string | null;
  source: string | null;
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

  return (
    <Card>
      <h1 className="text-2xl font-bold">{title}</h1>
      {description ? (
        <p className="mt-1 text-[var(--color-muted)]">{description}</p>
      ) : null}

      {state.status === "error" ? (
        <div className="mt-4">
          <Banner tone="warn">{state.message}</Banner>
        </div>
      ) : null}

      <form action={formAction} className="mt-5 space-y-5">
        <input type="hidden" name="slug" value={slug} />
        {source ? <input type="hidden" name="source" value={source} /> : null}

        {/* Honeypot: hidden from people, tempting to bots. A populated value is
            silently dropped server-side. Not display:none (some bots skip it). */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-9999px",
            width: "1px",
            height: "1px",
            overflow: "hidden",
          }}
        >
          <label>
            Company
            <input
              type="text"
              name="company"
              tabIndex={-1}
              autoComplete="off"
            />
          </label>
        </div>

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

        {turnstileSiteKey ? (
          <TurnstileWidget siteKey={turnstileSiteKey} />
        ) : (
          <Banner tone="warn">
            This form can&rsquo;t accept responses right now.
          </Banner>
        )}

        <Button type="submit" disabled={pending || !turnstileSiteKey}>
          {pending ? "Submitting…" : "Submit"}
        </Button>
      </form>
    </Card>
  );
}
