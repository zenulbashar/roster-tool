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
  return { status: "ok", responseId };
}
