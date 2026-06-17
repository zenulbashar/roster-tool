import type { TenantRepo } from "@/lib/tenant/repository";
import {
  validatePublicSubmission,
  type SubmissionField,
} from "@/lib/form-submission";

/**
 * The PUBLIC form submission pipeline, factored out of the route so it is
 * directly testable. Enforces the fixed order:
 *
 *   1. Honeypot  → silently DROP (store nothing, report success to the bot)
 *   2. Rate limit → reject WITHOUT storing
 *   3. Turnstile  → verify server-side, reject on failure/absence
 *   4. Validate   → every answer against the form's live fields
 *   5. Store      → business_id forced from the form inside the repo
 *
 * External effects (Turnstile verify, the durable rate limiter) are injected so
 * tests can drive each branch deterministically. The form is already resolved
 * by slug (published) before this runs; the repo re-checks published on store.
 */

export type PublicSubmitOutcome =
  | { status: "ok"; responseId: string }
  // Honeypot tripped: the UI shows the same thank-you so a bot learns nothing.
  | { status: "dropped" }
  | { status: "rejected"; message: string };

export async function processPublicSubmission(
  repo: Pick<TenantRepo, "createPublicResponse">,
  params: {
    formId: string;
    slug: string;
    fields: SubmissionField[];
    rawAnswers: Record<string, unknown>;
    token: string | null;
    honeypot: string | null | undefined;
    ipHash: string;
    source?: string | null;
  },
  io: {
    verifyToken: (token: string | null) => Promise<boolean>;
    consumeRateLimit: (ipHash: string, slug: string) => Promise<boolean>;
    // Best-effort, AFTER-COMMIT owner notification (Phase 3a). Fires ONLY on a
    // genuine new-response success below — never on honeypot/rate-limit/
    // Turnstile/validation/store-null. Wired by the action; itself swallows
    // errors, and we guard again here so it can NEVER fail or roll back the
    // already-committed response (the public path especially must not break).
    notifyResponse: () => Promise<void>;
  },
): Promise<PublicSubmitOutcome> {
  // 1. Honeypot — a populated hidden field means a bot. Drop silently.
  if (params.honeypot && params.honeypot.trim() !== "") {
    return { status: "dropped" };
  }

  // 2. Rate limit per (ip, slug). Reject without storing.
  const allowed = await io.consumeRateLimit(params.ipHash, params.slug);
  if (!allowed) {
    return {
      status: "rejected",
      message: "Too many submissions right now. Please try again in a minute.",
    };
  }

  // 3. Turnstile — verify server-side.
  const human = await io.verifyToken(params.token);
  if (!human) {
    return {
      status: "rejected",
      message: "We couldn't verify you're human. Please try again.",
    };
  }

  // 4. Validate every answer against the form's live fields.
  const validated = validatePublicSubmission(params.fields, params.rawAnswers);
  if (!validated.ok) {
    return { status: "rejected", message: validated.error };
  }

  // 5. Store (repo forces business_id and re-checks the form is still published).
  const responseId = await repo.createPublicResponse(params.formId, {
    channel: "public",
    source: params.source ?? null,
    answers: validated.rows,
  });
  if (!responseId) {
    return {
      status: "rejected",
      message: "This form is no longer accepting responses.",
    };
  }
  // 6. A new response row WAS stored → notify (best-effort, after-commit).
  //    Guarded so a notify failure can never fail/roll back the submit.
  try {
    await io.notifyResponse();
  } catch {
    // Swallowed: the response is already committed; notification is best-effort.
  }
  return { status: "ok", responseId };
}
