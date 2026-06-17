import type { TenantRepo } from "@/lib/tenant/repository";
import {
  validatePublicSubmission,
  type SubmissionField,
} from "@/lib/form-submission";

/**
 * The INTERNAL (staff / PIN-gated) form submission pipeline, factored out of the
 * /me action so it is directly testable. Mirrors the public core
 * (`processPublicSubmission`) but the PIN gate IS the control, so there is NO
 * honeypot and NO Turnstile here. Order:
 *
 *   1. (anonymous only) per-FORM rate limit → reject WITHOUT storing
 *   2. Validate   → every answer against the form's live fields, REUSING the
 *                   exact public validator (unknown field ids, single_select
 *                   option-id membership, rating 1–5, required, length caps)
 *   3. Store      → channel='internal'; respondent + business forced in the repo
 *
 * SECURITY — respondent identity:
 *  - `respondentStaffId` is whatever the CALLER resolved from the /me session.
 *    The action passes the PIN-authenticated staff id (attributed) or null
 *    (anonymous). It is NEVER taken from request input.
 *  - `anonymous` is read SERVER-SIDE from the form's `allow_anonymous` by the
 *    action and passed in here; a client cannot set it. When anonymous we pass
 *    a null respondent to the repo (true anonymity — nothing linking the
 *    response to a person is written).
 *  - The repo re-checks the form is this business's AND internal_enabled before
 *    writing, and enforces one-per-staff authoritatively via a partial-unique
 *    ON CONFLICT (→ `already_responded`).
 *
 * The rate limiter is injected so tests drive it deterministically; it is only
 * consulted on the anonymous path and is keyed on the form id alone (never a
 * staff identifier — see `consumeInternalAnonSubmission`).
 */

export type InternalSubmitOutcome =
  | { status: "ok"; responseId: string }
  | { status: "already_responded" }
  | { status: "rejected"; message: string };

export async function processInternalSubmission(
  repo: Pick<TenantRepo, "createInternalResponse">,
  params: {
    formId: string;
    fields: SubmissionField[];
    rawAnswers: Record<string, unknown>;
    /** Read server-side from the form's allow_anonymous — NOT from the client. */
    anonymous: boolean;
    /** The PIN-authenticated staff id, resolved from the /me session. */
    staffMemberId: string;
    source?: string | null;
  },
  io: {
    /** Per-FORM anon flood guard (no staff identifier in the key). */
    consumeAnonRateLimit: (formId: string) => Promise<boolean>;
    // Best-effort, AFTER-COMMIT owner notification (Phase 3a). Fires ONLY when a
    // NEW response row was stored (`ok`) — NEVER on a blocked duplicate
    // (`already_responded`, which stores nothing), nor on rate-limit/validation/
    // not_found. Wired by the action; guarded here so it can't fail the submit.
    notifyResponse: () => Promise<void>;
  },
): Promise<InternalSubmitOutcome> {
  // 1. Anonymous flood guard (the attributed path is bounded by the partial
  //    unique, so it needs no limiter).
  if (params.anonymous) {
    const allowed = await io.consumeAnonRateLimit(params.formId);
    if (!allowed) {
      return {
        status: "rejected",
        message:
          "Too many submissions right now. Please try again in a minute.",
      };
    }
  }

  // 2. Validate every answer against the form's live fields (shared validator).
  const validated = validatePublicSubmission(params.fields, params.rawAnswers);
  if (!validated.ok) {
    return { status: "rejected", message: validated.error };
  }

  // 3. Store. Anonymous → null respondent (true anonymity); attributed → the
  //    session staff id. The repo forces business_id and re-checks
  //    internal_enabled.
  const result = await repo.createInternalResponse(params.formId, {
    respondentStaffId: params.anonymous ? null : params.staffMemberId,
    source: params.source ?? null,
    answers: validated.rows,
  });

  if (result.ok) {
    // A new response row WAS stored → notify (best-effort, after-commit).
    // Guarded so a notify failure can never fail/roll back the submit.
    try {
      await io.notifyResponse();
    } catch {
      // Swallowed: the response is already committed.
    }
    return { status: "ok", responseId: result.responseId };
  }
  // Blocked duplicate: NO new row stored → MUST NOT notify or bump the count.
  if (result.reason === "already_responded") {
    return { status: "already_responded" };
  }
  return {
    status: "rejected",
    message: "This form is no longer available.",
  };
}
