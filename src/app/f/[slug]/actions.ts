"use server";

import { headers } from "next/headers";
import { findPublishedFormBySlug } from "@/lib/tenant/public-access";
import { createTenantRepo } from "@/lib/tenant/repository";
import { processPublicSubmission } from "@/lib/form-response-submission";
import { notifyFormResponse } from "@/lib/notifications";
import { verifyTurnstile } from "@/lib/turnstile";
import { consumeFormSubmission, hashIp } from "@/lib/rate-limit";
import type { SubmissionField } from "@/lib/form-submission";
import type { PublicFillState } from "@/components/PublicFormFill";

/** Leftmost entry of x-forwarded-for. IP limiting is best-effort (shared/spoofable). */
function clientIp(xff: string | null): string | null {
  if (!xff) return null;
  return xff.split(",")[0]?.trim() || null;
}

/**
 * Handle a PUBLIC form submission. The slug (a hidden field) is the only
 * identifier; the form is re-resolved server-side (404/closed → unavailable),
 * never trusting the client for the business or fields. Order: honeypot →
 * rate-limit → Turnstile → validate → store, all in `processPublicSubmission`.
 * Honeypot drops report success so a bot learns nothing.
 */
export async function submitPublicForm(
  _prev: PublicFillState,
  formData: FormData,
): Promise<PublicFillState> {
  const slug = String(formData.get("slug") ?? "");
  const resolved = await findPublishedFormBySlug(slug);
  if (!resolved) {
    return { status: "error", message: "This form is no longer available." };
  }

  const repo = createTenantRepo(resolved.businessId);
  const data = await repo.getFormWithFields(resolved.formId);
  if (!data) {
    return { status: "error", message: "This form is no longer available." };
  }

  const fields: SubmissionField[] = data.fields.map((f) => ({
    id: f.id,
    label: f.label,
    type: f.type,
    required: f.required,
    options: (f.options ?? []).map((o) => ({ id: o.id, label: o.label })),
  }));

  // Reconstruct answers keyed by field id from the `field_<id>` inputs.
  const rawAnswers: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("field_")) {
      rawAnswers[key.slice("field_".length)] = value;
    }
  }

  const token = formData.get("cf-turnstile-response");
  const honeypot = formData.get("company");
  const source = formData.get("source");
  const ip = clientIp((await headers()).get("x-forwarded-for"));

  const outcome = await processPublicSubmission(
    repo,
    {
      formId: resolved.formId,
      slug,
      fields,
      rawAnswers,
      token: typeof token === "string" ? token : null,
      honeypot: typeof honeypot === "string" ? honeypot : null,
      ipHash: hashIp(ip),
      source: typeof source === "string" && source ? source : null,
    },
    {
      verifyToken: (t) => verifyTurnstile(t, ip),
      consumeRateLimit: (ipHash, s) => consumeFormSubmission(ipHash, s),
      // After-commit, best-effort: coalesced owner bell notification. Count +
      // form title only — never answer content or respondent identity.
      notifyResponse: () =>
        notifyFormResponse(repo, {
          formId: resolved.formId,
          formTitle: data.form.title,
        }),
    },
  );

  // A honeypot drop reports success too — the bot learns nothing.
  if (outcome.status === "ok" || outcome.status === "dropped") {
    return { status: "success" };
  }
  return { status: "error", message: outcome.message };
}
