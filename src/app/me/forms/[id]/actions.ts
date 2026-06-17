"use server";

import { createTenantRepo } from "@/lib/tenant/repository";
import { verifiedNoticesStaff } from "@/lib/notices-session";
import { processInternalSubmission } from "@/lib/internal-form-submission";
import { notifyFormResponse } from "@/lib/notifications";
import { consumeInternalAnonSubmission } from "@/lib/rate-limit";
import type { SubmissionField } from "@/lib/form-submission";
import type { StaffFillState } from "@/components/StaffFormFill";

/**
 * Submit an INTERNAL form from the PIN-gated /me portal.
 *
 * SECURITY:
 *  - The staff member (and their business) is resolved from the /me SESSION via
 *    `verifiedNoticesStaff` (capability cookie + HMAC PIN proof) — NEVER from
 *    the form post. A staff id in the body is ignored.
 *  - `formId` arrives as a hidden field but is NOT trusted for scope: the form
 *    is re-resolved under the SESSION's business and must be internal_enabled
 *    (`getInternalFormForStaff`), so a staff member can't reach a cross-business
 *    or non-shared form by editing it (and they may fill any of their own
 *    business's internal forms anyway).
 *  - `anonymous` is read SERVER-SIDE from the form's allow_anonymous, never the
 *    client — a client can't flip an attributed form to anonymous to dodge
 *    attribution + the one-per-staff guard.
 *  - No Turnstile/honeypot (the PIN gate is the control). Validation reuses the
 *    public validator verbatim.
 */
export async function submitInternalForm(
  _prev: StaffFillState,
  formData: FormData,
): Promise<StaffFillState> {
  const staff = await verifiedNoticesStaff();
  if (!staff) {
    return {
      status: "error",
      message:
        "Your session has expired. Please reopen your link and enter your PIN.",
    };
  }

  const formId = String(formData.get("formId") ?? "");
  const repo = createTenantRepo(staff.businessId);
  const data = await repo.getInternalFormForStaff(formId);
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

  // Reconstruct answers keyed by field id from the `field_<id>` inputs. Any
  // other field (e.g. a forged staff id) is ignored — never read.
  const rawAnswers: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("field_")) {
      rawAnswers[key.slice("field_".length)] = value;
    }
  }

  const outcome = await processInternalSubmission(
    repo,
    {
      formId,
      fields,
      rawAnswers,
      // SERVER-READ anonymity flag — not from the client.
      anonymous: data.form.allowAnonymous,
      // SERVER-RESOLVED respondent — not from the client.
      staffMemberId: staff.staffMemberId,
      source: "internal",
    },
    {
      consumeAnonRateLimit: (id) => consumeInternalAnonSubmission(id),
      // After-commit, best-effort: coalesced owner bell notification. Count +
      // form title only — never answer content or respondent identity (so an
      // anonymous internal response can never imply who submitted).
      notifyResponse: () =>
        notifyFormResponse(repo, { formId, formTitle: data.form.title }),
    },
  );

  if (outcome.status === "ok") return { status: "success" };
  if (outcome.status === "already_responded") {
    return { status: "already_responded" };
  }
  return { status: "error", message: outcome.message };
}
