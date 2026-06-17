import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, staffMembers } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { notifyFormResponse, formResponseTitle } from "@/lib/notifications";
import { processInternalSubmission } from "@/lib/internal-form-submission";
import type { SubmissionField } from "@/lib/form-submission";

/**
 * Integration coverage of Phase 3a new-response owner notifications:
 *  - COALESCING: N responses to one form → ONE updating unread row (count=N);
 *  - reading the row resets coalescing (next response starts fresh);
 *  - the per-event preference gates creation (off ⇒ nothing);
 *  - PRIVACY: count + form title only — identical wording for public,
 *    attributed and anonymous, never a respondent identity;
 *  - best-effort: a thrown upsert is swallowed;
 *  - tenant isolation: only the owning business is notified.
 */
describe("form-response notification flow", () => {
  let businessA = "";
  let businessB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;
  let staffA1 = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Notify Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Notify Café B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
    repoA = createTenantRepo(businessA);
    repoB = createTenantRepo(businessB);
    const [s1] = await db
      .insert(staffMembers)
      .values({ businessId: businessA, name: "Ada", email: "ada@n.test" })
      .returning();
    staffA1 = s1!.id;
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
    await db.$client.end();
  });

  /** Notifications for a given form's coalescing group (newest first). */
  async function groupRows(repo: TenantRepo, formId: string) {
    const rows = await repo.listRecentNotifications(50);
    return rows.filter((r) => r.groupKey === `form_response:${formId}`);
  }

  it("coalesces N responses into ONE unread row with count=N", async () => {
    const form = await repoA.createForm({ title: "Feedback" });

    for (let i = 0; i < 4; i++) {
      await notifyFormResponse(repoA, {
        formId: form.id,
        formTitle: "Feedback",
      });
    }

    const rows = await groupRows(repoA, form.id);
    expect(rows).toHaveLength(1); // one updating item, not four
    const n = rows[0]!;
    expect(n.type).toBe("form_response");
    expect(n.count).toBe(4);
    expect(n.title).toBe(formResponseTitle(4, "Feedback"));
    expect(n.isRead).toBe(false);
    expect(n.body).toBeNull(); // no content
    expect(n.linkPath).toBe(`/app/forms/${form.id}/responses`);
    // The whole bell shows ONE unread item for four responses.
    expect(await repoA.countUnreadNotifications()).toBe(1);
  });

  it("resets coalescing once the row is read — the next response starts fresh", async () => {
    const form = await repoA.createForm({ title: "Survey" });
    await notifyFormResponse(repoA, { formId: form.id, formTitle: "Survey" });
    await notifyFormResponse(repoA, { formId: form.id, formTitle: "Survey" });

    const [unread] = await groupRows(repoA, form.id);
    expect(unread!.count).toBe(2);

    // Reading it (what the bell does on navigate) closes the coalescing window.
    await repoA.markNotificationRead(unread!.id);

    // The next response can't bump the now-read row → a fresh count=1 row.
    await notifyFormResponse(repoA, { formId: form.id, formTitle: "Survey" });
    const rows = await groupRows(repoA, form.id);
    expect(rows).toHaveLength(2); // one read (count 2), one fresh unread (count 1)
    const unreadNow = rows.filter((r) => !r.isRead);
    expect(unreadNow).toHaveLength(1);
    expect(unreadNow[0]!.count).toBe(1);
    expect(unreadNow[0]!.title).toBe(formResponseTitle(1, "Survey"));
  });

  it("respects the per-event preference: off ⇒ no notification", async () => {
    const form = await repoA.createForm({ title: "Muted" });
    await repoA.updateNotificationPrefs({ notifyFormResponse: false });
    try {
      await notifyFormResponse(repoA, { formId: form.id, formTitle: "Muted" });
      expect(await groupRows(repoA, form.id)).toHaveLength(0);
    } finally {
      await repoA.updateNotificationPrefs({ notifyFormResponse: true });
    }
  });

  it("is tenant-scoped: only the owning business is notified", async () => {
    const form = await repoA.createForm({ title: "Scoped" });
    await notifyFormResponse(repoA, { formId: form.id, formTitle: "Scoped" });
    // B sees nothing for A's form group.
    expect(await groupRows(repoB, form.id)).toHaveLength(0);
    expect(await groupRows(repoA, form.id)).toHaveLength(1);
  });

  it("swallows a thrown upsert (best-effort) — never rejects", async () => {
    const throwingRepo = {
      businessId: businessA,
      getBusiness: async () => ({ notifyFormResponse: true }),
      upsertFormResponseNotification: async () => {
        throw new Error("upsert boom");
      },
    } as unknown as TenantRepo;
    await expect(
      notifyFormResponse(throwingRepo, { formId: "f", formTitle: "T" }),
    ).resolves.toBeUndefined();
  });

  it("anonymous and attributed internal responses yield IDENTICAL count-only wording (no identity)", async () => {
    // One attributed form, one anonymous form; submit one response each through
    // the real core with notifyResponse wired to notifyFormResponse.
    async function setup(anonymous: boolean, title: string) {
      const form = await repoA.createForm({ title });
      await repoA.saveForm(form.id, {
        title,
        fields: [
          { label: "Comment", type: "short_text", required: true, options: [] },
        ],
      });
      if (anonymous) await repoA.setFormAllowAnonymous(form.id, true);
      await repoA.setFormInternalEnabled(form.id, true);
      const data = (await repoA.getInternalFormForStaff(form.id))!;
      const fields: SubmissionField[] = data.fields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        required: f.required,
        options: (f.options ?? []).map((o) => ({ id: o.id, label: o.label })),
      }));
      await processInternalSubmission(
        repoA,
        {
          formId: form.id,
          fields,
          rawAnswers: { [fields[0]!.id]: "hi" },
          anonymous,
          staffMemberId: staffA1,
        },
        {
          consumeAnonRateLimit: async () => true,
          notifyResponse: () =>
            notifyFormResponse(repoA, { formId: form.id, formTitle: title }),
        },
      );
      return (await groupRows(repoA, form.id))[0]!;
    }

    const attributed = await setup(false, "Attributed survey");
    const anon = await setup(true, "Anonymous survey");

    // Both are count-only, both carry no body and no respondent column exists.
    expect(attributed.title).toBe(formResponseTitle(1, "Attributed survey"));
    expect(anon.title).toBe(formResponseTitle(1, "Anonymous survey"));
    expect(attributed.body).toBeNull();
    expect(anon.body).toBeNull();
    // Neither title contains the staff member's name.
    expect(attributed.title).not.toContain("Ada");
    expect(anon.title).not.toContain("Ada");
  });
});
