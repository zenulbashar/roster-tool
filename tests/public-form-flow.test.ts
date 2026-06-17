import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { findPublishedFormBySlug } from "@/lib/tenant/public-access";
import { processPublicSubmission } from "@/lib/form-response-submission";
import type { SubmissionField } from "@/lib/form-submission";
import type { FormFieldInput } from "@/lib/validation";

/**
 * Public form collection (Phase 1b) against the real DB: publish/slug, the
 * published-only resolver, and the full submit pipeline — including the abuse
 * gates (honeypot, rate limit, Turnstile) each rejecting WITHOUT storing, and
 * tenant isolation on the owner-side read.
 */
describe("public form flow", () => {
  let businessA = "";
  let businessB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Public Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Public Café B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
    repoA = createTenantRepo(businessA);
    repoB = createTenantRepo(businessB);
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
    await db.$client.end();
  });

  function field(
    f: Partial<FormFieldInput> & { label: string },
  ): FormFieldInput {
    return {
      id: f.id,
      label: f.label,
      type: f.type ?? "short_text",
      required: f.required ?? false,
      options: f.options ?? [],
    };
  }

  const surveyFields = (): FormFieldInput[] => [
    field({ label: "Your name", type: "short_text", required: true }),
    field({
      label: "Size",
      type: "single_select",
      required: true,
      options: [{ label: "Small" }, { label: "Large" }],
    }),
    field({ label: "Stars", type: "rating", required: true }),
  ];

  function toSubmissionField(f: {
    id: string;
    label: string;
    type: SubmissionField["type"];
    required: boolean;
    options: { id: string; label: string }[] | null;
  }): SubmissionField {
    return {
      id: f.id,
      label: f.label,
      type: f.type,
      required: f.required,
      options: (f.options ?? []).map((o) => ({ id: o.id, label: o.label })),
    };
  }

  async function publishedForm(repo: TenantRepo) {
    const form = await repo.createForm({ title: "Feedback" });
    await repo.saveForm(form.id, { title: "Feedback", fields: surveyFields() });
    const published = await repo.publishForm(form.id);
    const data = await repo.getFormWithFields(form.id);
    return {
      formId: form.id,
      slug: published!.slug,
      fields: data!.fields.map(toSubmissionField),
    };
  }

  // Sensible io defaults: human verified, under the rate limit, no-op notify.
  const okIo = {
    verifyToken: async () => true,
    consumeRateLimit: async () => true,
    notifyResponse: async () => {},
  };

  function answersFor(fields: SubmissionField[]) {
    const name = fields.find((f) => f.type === "short_text")!;
    const size = fields.find((f) => f.type === "single_select")!;
    const stars = fields.find((f) => f.type === "rating")!;
    return {
      raw: {
        [name.id]: "Ada",
        [size.id]: size.options[1]!.id, // "Large"
        [stars.id]: "5",
      } as Record<string, unknown>,
      size,
    };
  }

  it("publishes with an unguessable slug, idempotently", async () => {
    const form = await repoA.createForm({ title: "Hours" });
    const first = await repoA.publishForm(form.id);
    expect(first!.slug).toMatch(/^[A-Za-z0-9_-]{12,}$/);
    const again = await repoA.publishForm(form.id);
    expect(again!.slug).toBe(first!.slug); // slug preserved on re-publish
  });

  it("resolves only published forms by slug", async () => {
    const { slug, formId } = await publishedForm(repoA);
    const resolved = await findPublishedFormBySlug(slug);
    expect(resolved).toMatchObject({ businessId: businessA, formId });

    expect(await findPublishedFormBySlug("does-not-exist")).toBeNull();

    // Draft form (never published) → not resolvable.
    const draft = await repoA.createForm({ title: "Draft" });
    expect(draft.publicSlug).toBeNull();

    // Closed form → not resolvable even though it keeps its slug.
    await repoA.closeForm(formId);
    expect(await findPublishedFormBySlug(slug)).toBeNull();
  });

  it("stores a valid submission with business_id from the form and rating in value_number", async () => {
    const { formId, slug, fields } = await publishedForm(repoA);
    const { raw } = answersFor(fields);

    const outcome = await processPublicSubmission(
      repoA,
      {
        formId,
        slug,
        fields,
        rawAnswers: raw,
        token: "t",
        honeypot: "",
        ipHash: "ip1",
      },
      okIo,
    );
    expect(outcome.status).toBe("ok");

    const responses = await repoA.getResponsesForForm(formId);
    expect(responses).toHaveLength(1);
    expect(responses[0]!.businessId).toBe(businessA);
    expect(responses[0]!.channel).toBe("public");

    const answers = responses[0]!.answers;
    expect(answers.every((a) => a.businessId === businessA)).toBe(true);
    const rating = answers.find((a) => a.fieldType === "rating")!;
    expect(rating.valueNumber).toBe(5);
    expect(rating.valueText).toBeNull();
    // single_select stored the chosen LABEL, not the option id.
    const choice = answers.find((a) => a.fieldType === "single_select")!;
    expect(choice.valueText).toBe("Large");
  });

  it("rejects a missing required field and an out-of-range rating without storing", async () => {
    for (const mutate of [
      (raw: Record<string, unknown>, size: SubmissionField) => {
        void size;
        const nameKey = Object.keys(raw).find((k) => raw[k] === "Ada")!;
        delete raw[nameKey];
      },
      (raw: Record<string, unknown>, size: SubmissionField) => {
        void size;
        const starKey = Object.keys(raw).find((k) => raw[k] === "5")!;
        raw[starKey] = "9";
      },
      (raw: Record<string, unknown>, size: SubmissionField) => {
        raw[size.id] = "not-a-real-option-id";
      },
      (raw: Record<string, unknown>) => {
        raw["totally-unknown-field"] = "x";
      },
    ]) {
      const { formId, slug, fields } = await publishedForm(repoA);
      const { raw, size } = answersFor(fields);
      mutate(raw, size);
      const outcome = await processPublicSubmission(
        repoA,
        {
          formId,
          slug,
          fields,
          rawAnswers: raw,
          token: "t",
          honeypot: "",
          ipHash: "ip1",
        },
        okIo,
      );
      expect(outcome.status).toBe("rejected");
      expect(await repoA.getResponsesForForm(formId)).toHaveLength(0);
    }
  });

  it("silently drops a populated honeypot and stores nothing", async () => {
    const { formId, slug, fields } = await publishedForm(repoA);
    const { raw } = answersFor(fields);
    const outcome = await processPublicSubmission(
      repoA,
      {
        formId,
        slug,
        fields,
        rawAnswers: raw,
        token: "t",
        honeypot: "i-am-a-bot",
        ipHash: "ip1",
      },
      okIo,
    );
    expect(outcome.status).toBe("dropped");
    expect(await repoA.getResponsesForForm(formId)).toHaveLength(0);
  });

  it("fires notifyResponse ONCE on a stored response, but NOT on a honeypot drop", async () => {
    const { formId, slug, fields } = await publishedForm(repoA);
    const { raw } = answersFor(fields);
    let calls = 0;
    const io = { ...okIo, notifyResponse: async () => void calls++ };

    // Honeypot drop → stored nothing → must NOT notify.
    await processPublicSubmission(
      repoA,
      {
        formId,
        slug,
        fields,
        rawAnswers: raw,
        token: "t",
        honeypot: "bot",
        ipHash: "ip1",
      },
      io,
    );
    expect(calls).toBe(0);

    // Genuine success → notify exactly once (after the row commits).
    const ok = await processPublicSubmission(
      repoA,
      {
        formId,
        slug,
        fields,
        rawAnswers: raw,
        token: "t",
        honeypot: "",
        ipHash: "ip1",
      },
      io,
    );
    expect(ok.status).toBe("ok");
    expect(calls).toBe(1);
  });

  it("swallows a thrown notifyResponse — the public response is still stored", async () => {
    const { formId, slug, fields } = await publishedForm(repoA);
    const { raw } = answersFor(fields);
    const io = {
      ...okIo,
      notifyResponse: async () => {
        throw new Error("notify boom");
      },
    };
    const outcome = await processPublicSubmission(
      repoA,
      {
        formId,
        slug,
        fields,
        rawAnswers: raw,
        token: "t",
        honeypot: "",
        ipHash: "ip1",
      },
      io,
    );
    expect(outcome.status).toBe("ok");
    expect(await repoA.getResponsesForForm(formId)).toHaveLength(1);
  });

  it("rejects when the rate limit is exceeded, without storing", async () => {
    const { formId, slug, fields } = await publishedForm(repoA);
    const { raw } = answersFor(fields);
    const outcome = await processPublicSubmission(
      repoA,
      {
        formId,
        slug,
        fields,
        rawAnswers: raw,
        token: "t",
        honeypot: "",
        ipHash: "ip1",
      },
      {
        verifyToken: async () => true,
        consumeRateLimit: async () => false,
        notifyResponse: async () => {},
      },
    );
    expect(outcome.status).toBe("rejected");
    expect(await repoA.getResponsesForForm(formId)).toHaveLength(0);
  });

  it("rejects when Turnstile verification fails, without storing", async () => {
    const { formId, slug, fields } = await publishedForm(repoA);
    const { raw } = answersFor(fields);
    const outcome = await processPublicSubmission(
      repoA,
      {
        formId,
        slug,
        fields,
        rawAnswers: raw,
        token: null,
        honeypot: "",
        ipHash: "ip1",
      },
      {
        verifyToken: async () => false,
        consumeRateLimit: async () => true,
        notifyResponse: async () => {},
      },
    );
    expect(outcome.status).toBe("rejected");
    expect(await repoA.getResponsesForForm(formId)).toHaveLength(0);
  });

  it("refuses to store a response once the form is closed", async () => {
    const { formId, slug, fields } = await publishedForm(repoA);
    const { raw } = answersFor(fields);
    await repoA.closeForm(formId);
    const outcome = await processPublicSubmission(
      repoA,
      {
        formId,
        slug,
        fields,
        rawAnswers: raw,
        token: "t",
        honeypot: "",
        ipHash: "ip1",
      },
      okIo,
    );
    expect(outcome.status).toBe("rejected");
    expect(await repoA.getResponsesForForm(formId)).toHaveLength(0);
  });

  it("locks field structure once published (unpublish to edit)", async () => {
    const form = await repoA.createForm({ title: "Locked" });
    await repoA.saveForm(form.id, {
      title: "Locked",
      fields: [field({ label: "Q1", type: "short_text" })],
    });
    await repoA.publishForm(form.id);

    // Adding a field to a published form is rejected.
    const structural = await repoA.saveForm(form.id, {
      title: "Locked",
      fields: [
        field({ label: "Q1", type: "short_text" }),
        field({ label: "Q2", type: "short_text" }),
      ],
    });
    expect(structural).toMatchObject({ ok: false, reason: "locked" });

    // Title-only edit (identical fields) is allowed.
    const data = await repoA.getFormWithFields(form.id);
    const titleOnly = await repoA.saveForm(form.id, {
      title: "Locked (renamed)",
      fields: data!.fields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        required: f.required,
        options: (f.options ?? []).map((o) => ({ id: o.id, label: o.label })),
      })),
    });
    expect(titleOnly.ok).toBe(true);
  });

  it("keeps responses scoped — B's repo cannot read A's responses", async () => {
    const { formId, slug, fields } = await publishedForm(repoA);
    const { raw } = answersFor(fields);
    await processPublicSubmission(
      repoA,
      {
        formId,
        slug,
        fields,
        rawAnswers: raw,
        token: "t",
        honeypot: "",
        ipHash: "ip1",
      },
      okIo,
    );
    expect(await repoA.getResponsesForForm(formId)).toHaveLength(1);
    // Business B, scoped to its own tenant, sees nothing for A's form.
    expect(await repoB.getResponsesForForm(formId)).toHaveLength(0);
  });
});
