import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, formResponses, users } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { handleFormResponseDigests } from "@/lib/jobs/handlers";
import type { FormFieldInput } from "@/lib/validation";

/**
 * The daily form-response email digest (M35) against the real DB: one
 * consolidated email per business with per-form counts, the 24h first-run
 * window, cursor idempotency (advance only after send; immediate re-run is a
 * no-op), the Settings toggle, owner-less skip, tenant isolation — and the
 * PRIVACY rule: the email never carries answer content.
 */
describe("form response digest flow", () => {
  let bizA = "";
  let bizB = "";
  let bizNoOwner = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;
  let feedbackId = "";
  let surveyId = "";

  // Captured AFTER seeding (responses get real now() timestamps from the DB,
  // so the sweep's "now" must sit just after them, on the same real clock).
  let NOW = new Date();

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

  async function makeForm(repo: TenantRepo, title: string) {
    const form = await repo.createForm({ title });
    await repo.saveForm(form.id, {
      title,
      fields: [field({ label: "Comment", type: "short_text" })],
    });
    await repo.publishForm(form.id);
    return form.id;
  }

  async function respond(repo: TenantRepo, formId: string, text: string) {
    const data = (await repo.getFormWithFields(formId))!;
    const comment = data.fields[0]!;
    return repo.createPublicResponse(formId, {
      channel: "public",
      source: null,
      answers: [
        {
          fieldId: comment.id,
          fieldLabel: "Comment",
          fieldType: "short_text",
          valueText: text,
          valueNumber: null,
        },
      ],
    });
  }

  /** Pin a response's submitted_at so window maths are deterministic. */
  async function submittedAt(responseId: string, at: Date) {
    await db
      .update(formResponses)
      .set({ submittedAt: at })
      .where(eq(formResponses.id, responseId));
  }

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Digest Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Digest Café B" })
      .returning();
    const [c] = await db
      .insert(businesses)
      .values({ name: "Digest Café Ownerless" })
      .returning();
    bizA = a!.id;
    bizB = b!.id;
    bizNoOwner = c!.id;
    repoA = createTenantRepo(bizA);
    repoB = createTenantRepo(bizB);

    await db.insert(users).values([
      { email: `owner-a-${crypto.randomUUID()}@digest.test`, businessId: bizA },
      { email: `owner-b-${crypto.randomUUID()}@digest.test`, businessId: bizB },
    ]);

    feedbackId = await makeForm(repoA, "Customer feedback");
    surveyId = await makeForm(repoA, "Staff survey");
    const otherTenantForm = await makeForm(repoB, "B-only form");
    const ownerlessForm = await makeForm(
      createTenantRepo(bizNoOwner),
      "Nobody reads this",
    );

    // A: 2 responses to Feedback, 1 to Survey (inside the 24h window).
    await respond(repoA, feedbackId, "SECRET-ANSWER-ONE");
    await respond(repoA, feedbackId, "SECRET-ANSWER-TWO");
    await respond(repoA, surveyId, "SECRET-ANSWER-THREE");
    // B: 1 response of its own; C (ownerless): 1 response.
    await respond(repoB, otherTenantForm, "B-SECRET");
    await respond(createTenantRepo(bizNoOwner), ownerlessForm, "C-SECRET");

    NOW = new Date(Date.now() + 1000);
  });

  afterAll(async () => {
    for (const id of [bizA, bizB, bizNoOwner]) {
      if (id) await db.delete(businesses).where(eq(businesses.id, id));
    }
    await db.$client.end();
  });

  it("emails one consolidated per-business digest — counts, never content", async () => {
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    const send = vi.fn(
      async (e: { to: string; subject: string; text: string }) => {
        sent.push(e);
      },
    );

    await handleFormResponseDigests(NOW, { send });

    const aEmails = sent.filter((e) => e.to.startsWith("owner-a-"));
    expect(aEmails).toHaveLength(1);
    const a = aEmails[0]!;
    expect(a.subject).toContain("3 new form responses");
    expect(a.text).toContain("Customer feedback — 2 new responses");
    expect(a.text).toContain("Staff survey — 1 new response");
    expect(a.text).toContain(`/app/forms/${feedbackId}/responses`);
    // PRIVACY: never answer content, never a respondent identity.
    expect(a.text).not.toContain("SECRET");
    expect(a.text).not.toContain("B-only form");

    // B got its own digest (isolation); the ownerless business was skipped.
    const bEmails = sent.filter((e) => e.to.startsWith("owner-b-"));
    expect(bEmails).toHaveLength(1);
    expect(bEmails[0]!.text).toContain("B-only form — 1 new response");
    expect(bEmails[0]!.text).not.toContain("Customer feedback");
    expect(sent).toHaveLength(2);
  });

  it("advances the cursor: an immediate re-run sends nothing", async () => {
    const [row] = await db
      .select({ lastAt: businesses.formDigestLastAt })
      .from(businesses)
      .where(eq(businesses.id, bizA));
    expect(row?.lastAt).toEqual(NOW);

    const send = vi.fn(async () => {});
    await handleFormResponseDigests(NOW, { send });
    expect(send).not.toHaveBeenCalled();
  });

  it("a later run picks up only responses after the cursor", async () => {
    const fourId = await respond(repoA, surveyId, "SECRET-FOUR");
    await submittedAt(fourId!, new Date(NOW.getTime() + 30_000));
    const later = new Date(NOW.getTime() + 60_000);

    const sent: Array<{ to: string; text: string; subject: string }> = [];
    await handleFormResponseDigests(later, {
      send: async (e) => {
        sent.push(e);
      },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain("1 new form response");
    expect(sent[0]!.text).toContain("Staff survey — 1 new response");
    expect(sent[0]!.text).not.toContain("Customer feedback");
  });

  it("the Settings toggle turns the digest off", async () => {
    await repoA.updateBusinessSettings({ formDigestEnabled: false });
    const fiveId = await respond(repoA, feedbackId, "SECRET-FIVE");
    await submittedAt(fiveId!, new Date(NOW.getTime() + 90_000));
    const later = new Date(NOW.getTime() + 120_000);

    const sent: Array<{ to: string }> = [];
    await handleFormResponseDigests(later, {
      send: async (e) => {
        sent.push(e);
      },
    });
    expect(sent.filter((e) => e.to.startsWith("owner-a-"))).toHaveLength(0);
    await repoA.updateBusinessSettings({ formDigestEnabled: true });
  });

  it("a never-sent business only looks back 24 hours", async () => {
    // Reset A's cursor to "never sent"; its existing responses are all
    // recent, so pretend the sweep runs 3 days later — nothing in window.
    await db
      .update(businesses)
      .set({ formDigestLastAt: null })
      .where(eq(businesses.id, bizA));
    const daysLater = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000);

    const sent: Array<{ to: string }> = [];
    await handleFormResponseDigests(daysLater, {
      send: async (e) => {
        sent.push(e);
      },
    });
    expect(sent.filter((e) => e.to.startsWith("owner-a-"))).toHaveLength(0);
  });
});
