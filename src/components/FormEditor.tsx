"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import {
  FORM_FIELD_TYPES,
  formSaveSchema,
  type FormFieldTypeInput,
} from "@/lib/validation";
import { formFieldTypeLabel } from "@/lib/labels";
import { Banner, Button, Card, Field, TextInput } from "@/components/ui";

/**
 * The client editor for one draft form. Holds the whole form (title +
 * description + ordered fields, each with its own options) in local React state
 * and submits it as ONE JSON payload to a transactional `saveForm` server
 * action — matching the brief's single-save reconcile (insert/update/delete/
 * reorder in one transaction). New fields/options use a client temp key; the
 * server discards it and the DB generates real ids, which a successful save
 * returns so the editor re-seeds with them.
 *
 * Server-side Zod stays authoritative; the shared `formSaveSchema` is reused
 * here only to surface inline feedback.
 */

/** One field as the editor / save action exchange it (no client-only keys). */
export type FormEditorField = {
  id?: string;
  label: string;
  type: FormFieldTypeInput;
  required: boolean;
  options: { id?: string; label: string }[];
};

/** Result of a save, fed back through `useActionState`. */
export type SaveFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "success";
      message: string;
      title: string;
      description: string;
      fields: FormEditorField[];
    };

type EditorOption = { key: string; id?: string; label: string };
type EditorField = {
  key: string;
  id?: string;
  label: string;
  type: FormFieldTypeInput;
  required: boolean;
  options: EditorOption[];
};

const newKey = () => crypto.randomUUID();

/** Seed editor state (with stable keys) from the persisted-shape fields. */
function seed(fields: FormEditorField[]): EditorField[] {
  return fields.map((f) => ({
    key: f.id ?? newKey(),
    id: f.id,
    label: f.label,
    type: f.type,
    required: f.required,
    options: f.options.map((o) => ({
      key: o.id ?? newKey(),
      id: o.id,
      label: o.label,
    })),
  }));
}

const initial: SaveFormState = { status: "idle" };

export function FormEditor({
  action,
  initialTitle,
  initialDescription,
  initialFields,
  listHref,
  locked = false,
}: {
  action: (prev: SaveFormState, formData: FormData) => Promise<SaveFormState>;
  initialTitle: string;
  initialDescription: string;
  initialFields: FormEditorField[];
  listHref: string;
  // When the form is published its field structure is frozen (the server also
  // enforces this). Title/description stay editable; field controls disable.
  locked?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [fields, setFields] = useState<EditorField[]>(() =>
    seed(initialFields),
  );

  // After a successful save the server returns the persisted fields (with real
  // ids); re-seed so subsequent saves update those rows instead of re-inserting.
  useEffect(() => {
    if (state.status === "success") {
      setTitle(state.title);
      setDescription(state.description);
      setFields(seed(state.fields));
    }
  }, [state]);

  function patchField(key: string, patch: Partial<EditorField>) {
    setFields((prev) =>
      prev.map((f) => (f.key === key ? { ...f, ...patch } : f)),
    );
  }

  function addField() {
    setFields((prev) => [
      ...prev,
      {
        key: newKey(),
        label: "",
        type: "short_text",
        required: false,
        options: [],
      },
    ]);
  }

  function deleteField(key: string) {
    setFields((prev) => prev.filter((f) => f.key !== key));
  }

  function moveField(index: number, dir: -1 | 1) {
    setFields((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function changeType(key: string, type: FormFieldTypeInput) {
    setFields((prev) =>
      prev.map((f) => {
        if (f.key !== key) return f;
        // Switching to a choice field: seed one empty option so the editor
        // shows the options UI (the save rule needs >=1 non-empty).
        const options =
          type === "single_select" && f.options.length === 0
            ? [{ key: newKey(), label: "" }]
            : f.options;
        return { ...f, type, options };
      }),
    );
  }

  function addOption(key: string) {
    setFields((prev) =>
      prev.map((f) =>
        f.key === key
          ? { ...f, options: [...f.options, { key: newKey(), label: "" }] }
          : f,
      ),
    );
  }

  function patchOption(fieldKey: string, optKey: string, label: string) {
    setFields((prev) =>
      prev.map((f) =>
        f.key === fieldKey
          ? {
              ...f,
              options: f.options.map((o) =>
                o.key === optKey ? { ...o, label } : o,
              ),
            }
          : f,
      ),
    );
  }

  function deleteOption(fieldKey: string, optKey: string) {
    setFields((prev) =>
      prev.map((f) =>
        f.key === fieldKey
          ? { ...f, options: f.options.filter((o) => o.key !== optKey) }
          : f,
      ),
    );
  }

  // The exact payload the server action validates + saves.
  const payload = {
    title,
    description,
    fields: fields.map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      required: f.required,
      options:
        f.type === "single_select"
          ? f.options.map((o) => ({ id: o.id, label: o.label }))
          : [],
    })),
  };

  // Shared-schema inline feedback (server remains authoritative).
  const validation = formSaveSchema.safeParse(payload);
  const issues = validation.success ? [] : validation.error.issues;
  const titleIssue = issues.find((i) => i.path[0] === "title")?.message;
  const fieldIssue = (index: number) =>
    issues.find((i) => i.path[0] === "fields" && i.path[1] === index)?.message;

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      {state.status === "error" ? (
        <Banner tone="warn">{state.message}</Banner>
      ) : null}
      {state.status === "success" ? (
        <Banner tone="success">{state.message}</Banner>
      ) : null}

      <Card className="space-y-3">
        <Field label="Form title" hint={titleIssue}>
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="e.g. Staff feedback"
            aria-label="Form title"
          />
        </Field>
        <Field label="Description (optional)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="What is this form for?"
            aria-label="Form description"
            className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-ink)]"
          />
        </Field>
      </Card>

      <section aria-label="Fields" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Fields ({fields.length})</h2>
          {locked ? null : (
            <Button type="button" variant="secondary" onClick={addField}>
              Add field
            </Button>
          )}
        </div>

        {locked ? (
          <Banner tone="info">
            This form is published, so its fields are locked. Unpublish it (in
            Sharing above) to add, remove, reorder or edit fields.
          </Banner>
        ) : null}

        {fields.length === 0 ? (
          <p className="text-[var(--color-muted)]">
            No fields yet. Add your first field — you can save a form with no
            fields and come back to it.
          </p>
        ) : (
          <ul className="space-y-3">
            {fields.map((f, index) => {
              const issue = fieldIssue(index);
              return (
                <li key={f.key}>
                  <Card className="space-y-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <Field label={`Field ${index + 1} label`}>
                          <TextInput
                            value={f.label}
                            onChange={(e) =>
                              patchField(f.key, { label: e.target.value })
                            }
                            maxLength={100}
                            placeholder="e.g. Your name"
                            aria-label={`Field ${index + 1} label`}
                            disabled={locked}
                          />
                        </Field>
                      </div>
                      {locked ? null : (
                        <div className="flex flex-col gap-1 pt-7">
                          <button
                            type="button"
                            onClick={() => moveField(index, -1)}
                            disabled={index === 0}
                            aria-label={`Move field ${index + 1} up`}
                            className="rounded-md border border-[var(--color-line)] px-2 py-1 text-sm disabled:opacity-40"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveField(index, 1)}
                            disabled={index === fields.length - 1}
                            aria-label={`Move field ${index + 1} down`}
                            className="rounded-md border border-[var(--color-line)] px-2 py-1 text-sm disabled:opacity-40"
                          >
                            ↓
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Type">
                        <select
                          value={f.type}
                          onChange={(e) =>
                            changeType(
                              f.key,
                              e.target.value as FormFieldTypeInput,
                            )
                          }
                          aria-label={`Field ${index + 1} type`}
                          disabled={locked}
                          className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3 text-base disabled:opacity-60"
                        >
                          {FORM_FIELD_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {formFieldTypeLabel(t)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <label className="flex items-center gap-2 pt-7">
                        <input
                          type="checkbox"
                          checked={f.required}
                          onChange={(e) =>
                            patchField(f.key, { required: e.target.checked })
                          }
                          disabled={locked}
                        />
                        <span className="text-sm font-semibold">Required</span>
                      </label>
                    </div>

                    {f.type === "single_select" ? (
                      <fieldset className="space-y-2">
                        <legend className="text-sm font-semibold">
                          Options
                        </legend>
                        {f.options.map((o) => (
                          <div key={o.key} className="flex items-center gap-2">
                            <TextInput
                              value={o.label}
                              onChange={(e) =>
                                patchOption(f.key, o.key, e.target.value)
                              }
                              maxLength={100}
                              placeholder="Option label"
                              aria-label="Option label"
                              disabled={locked}
                            />
                            {locked ? null : (
                              <button
                                type="button"
                                onClick={() => deleteOption(f.key, o.key)}
                                aria-label="Remove option"
                                className="rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                        {locked ? null : (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => addOption(f.key)}
                          >
                            Add option
                          </Button>
                        )}
                      </fieldset>
                    ) : null}

                    {f.type === "rating" ? (
                      <p className="text-sm text-[var(--color-muted)]">
                        A fixed 1–5 rating scale.
                      </p>
                    ) : null}
                    {f.type === "yes_no" ? (
                      <p className="text-sm text-[var(--color-muted)]">
                        A fixed Yes / No choice.
                      </p>
                    ) : null}

                    {issue ? (
                      <p className="text-sm text-[var(--color-warn)]">
                        {issue}
                      </p>
                    ) : null}

                    {locked ? null : (
                      <button
                        type="button"
                        onClick={() => deleteField(f.key)}
                        className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                      >
                        Delete field
                      </button>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save form"}
        </Button>
        <Link
          href={listHref}
          className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
        >
          Back to forms
        </Link>
      </div>
    </form>
  );
}
