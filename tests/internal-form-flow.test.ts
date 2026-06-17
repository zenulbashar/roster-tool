import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, staffMembers } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { processInternalSubmission } from "@/lib/internal-form-submission";
import { respondentLabel } from "@/lib/form-report";
import type { SubmissionField } from "@/lib/form-submission";

/**
 * Integration coverage of the INTERNAL (staff) form channel against the real DB.
 * Proves the Phase 2 correctness + security properties:
 *  - respondent_staff_id is whatever the SERVER resolves (the core's
 *    staffMemberId), null on the anonymous path even when an id is supplied;
 *  - one-per-staff is enforced authoritatively (second attributed submit →
 *    already_responded) while anonymous allows many;
 *  - a form must be this business's AND internal_enabled to accept a submit;
 *  - internal responses appear in the owner reads (responses list, summaries);
 *  - a deleted attributed staff reads "Former staff", not "Anonymous";
 *  - fields are locked once internal_enabled.
 */
describe("internal form flow", () => {
  let businessA = "";
  let businessB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;
  let staffA1 = "";
  let staffA2 = "";

  const allowLimiter = {
    consumeAnonRateLimit: async () => true,
    notifyResponse: async () => {},
  };

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Internal Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Internal Café B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
    repoA = createTenantRepo(businessA);
    repoB = createTenantRepo(businessB);

    const [s1] = await db
      .insert(staffMembers)
      .values({ businessId: businessA, name: "Ada", email: "ada@a.test" })
      .returning();
    const [s2] = await db
      .insert(staffMembers)
      .values({ businessId: businessA, name: "Bea", email: "bea@a.test" })
      .returning();
    staffA1 = s1!.id;
    staffA2 = s2!.id;
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
    await db.$client.end();
  });

  /** Create a form with one short_text field; optionally enable staff access. */
  async function makeForm(
    repo: TenantRepo,
    opts: { internal: boolean; anonymous?: boolean } = { internal: true },
  ) {
    const created = await repo.createForm({ title: "Staff survey" });
    await repo.saveForm(created.id, {
      title: "Staff survey",
      fields: [
        { label: "Comment", type: "short_text", required: true, options: [] },
      ],
    });
    if (opts.anonymous) await repo.setFormAllowAnonymous(created.id, true);
    if (opts.internal) await repo.setFormInternalEnabled(created.id, true);
    return created.id;
  }

  async function fieldsOf(repo: TenantRepo, formId: string) {
    const data = (await repo.getInternalFormForStaff(formId))!;
    const fields: SubmissionField[] = data.fields.map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      required: f.required,
      options: (f.options ?? []).map((o) => ({ id: o.id, label: o.label })),
    }));
    return { data, fields, firstFieldId: data.fields[0]!.id };
  }

  it("attributed: stores the server respondent; second submit blocked; view shows the name", async () => {
    const formId = await makeForm(repoA, { internal: true });
    const { fields, firstFieldId } = await fieldsOf(repoA, formId);

    const first = await processInternalSubmission(
      repoA,
      {
        formId,
        fields,
        rawAnswers: { [firstFieldId]: "Hello" },
        anonymous: false,
        staffMemberId: staffA1,
      },
      allowLimiter,
    );
    expect(first.status).toBe("ok");

    // A second attributed submit by the SAME staff is rejected (partial unique).
    const second = await processInternalSubmission(
      repoA,
      {
        formId,
        fields,
        rawAnswers: { [firstFieldId]: "Again" },
        anonymous: false,
        staffMemberId: staffA1,
      },
      allowLimiter,
    );
    expect(second.status).toBe("already_responded");

    // A different staff member CAN respond.
    const other = await processInternalSubmission(
      repoA,
      {
        formId,
        fields,
        rawAnswers: { [firstFieldId]: "Me too" },
        anonymous: false,
        staffMemberId: staffA2,
      },
      allowLimiter,
    );
    expect(other.status).toBe("ok");

    const rows = await repoA.getResponsesForForm(formId);
    expect(rows).toHaveLength(2);
    const labels = rows.map((r) =>
      respondentLabel({
        channel: r.channel,
        allowAnonymous: false,
        respondentName: r.respondentName,
      }),
    );
    expect(labels.sort()).toEqual(["Ada", "Bea"]);
    expect(rows.every((r) => r.channel === "internal")).toBe(true);
    expect(await repoA.hasStaffRespondedToForm(formId, staffA1)).toBe(true);
  });

  it("anonymous: respondent is null even if a staff id is supplied; many allowed; view shows 'Anonymous'", async () => {
    const formId = await makeForm(repoA, { internal: true, anonymous: true });
    const { fields, firstFieldId } = await fieldsOf(repoA, formId);

    // Even though we pass a staffMemberId, the anonymous path must store null.
    for (const text of ["one", "two"]) {
      const out = await processInternalSubmission(
        repoA,
        {
          formId,
          fields,
          rawAnswers: { [firstFieldId]: text },
          anonymous: true,
          staffMemberId: staffA1,
        },
        allowLimiter,
      );
      expect(out.status).toBe("ok"); // anonymous allows repeats
    }

    const rows = await repoA.getResponsesForForm(formId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.respondentStaffId === null)).toBe(true);
    expect(
      rows.every(
        (r) =>
          respondentLabel({
            channel: r.channel,
            allowAnonymous: true,
            respondentName: r.respondentName,
          }) === "Anonymous",
      ),
    ).toBe(true);
    // No attributed record exists for the staff member who submitted.
    expect(await repoA.hasStaffRespondedToForm(formId, staffA1)).toBe(false);
  });

  it("rejects a submit to a non-internal_enabled form", async () => {
    const formId = await makeForm(repoA, { internal: false });
    // The fill resolver refuses it outright.
    expect(await repoA.getInternalFormForStaff(formId)).toBeNull();
    // And the store refuses even if reached directly.
    const out = await repoA.createInternalResponse(formId, {
      respondentStaffId: staffA1,
      source: "internal",
      answers: [],
    });
    expect(out).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects a cross-business form (tenant isolation)", async () => {
    const formId = await makeForm(repoA, { internal: true });
    // B cannot resolve or store against A's form.
    expect(await repoB.getInternalFormForStaff(formId)).toBeNull();
    const out = await repoB.createInternalResponse(formId, {
      respondentStaffId: staffA1,
      source: "internal",
      answers: [],
    });
    expect(out).toEqual({ ok: false, reason: "not_found" });
    // A's internal forms never appear in B's staff list.
    const bList = await repoB.listInternalFormsForStaff(staffA1);
    expect(bList.find((f) => f.id === formId)).toBeUndefined();
  });

  it("includes internal responses in the owner summaries", async () => {
    const repo = repoA;
    const created = await repo.createForm({ title: "Ratings" });
    await repo.saveForm(created.id, {
      title: "Ratings",
      fields: [{ label: "Stars", type: "rating", required: true, options: [] }],
    });
    await repo.setFormInternalEnabled(created.id, true);
    const { fields, firstFieldId } = await fieldsOf(repo, created.id);
    await processInternalSubmission(
      repo,
      {
        formId: created.id,
        fields,
        rawAnswers: { [firstFieldId]: "5" },
        anonymous: false,
        staffMemberId: staffA1,
      },
      allowLimiter,
    );
    const agg = await repo.getResponseSummaryAggregates(created.id);
    const ratingRow = agg.find((r) => r.fieldType === "rating");
    expect(ratingRow?.valueNumber).toBe(5);
    expect(ratingRow?.count).toBe(1);
  });

  it("reads a deleted attributed staff as 'Former staff', not 'Anonymous'", async () => {
    const formId = await makeForm(repoA, { internal: true });
    const { fields, firstFieldId } = await fieldsOf(repoA, formId);
    // A throwaway staff member who will be deleted after responding.
    const [tmp] = await db
      .insert(staffMembers)
      .values({ businessId: businessA, name: "Cleo", email: "cleo@a.test" })
      .returning();
    await processInternalSubmission(
      repoA,
      {
        formId,
        fields,
        rawAnswers: { [firstFieldId]: "Bye" },
        anonymous: false,
        staffMemberId: tmp!.id,
      },
      allowLimiter,
    );
    await db.delete(staffMembers).where(eq(staffMembers.id, tmp!.id));

    const rows = await repoA.getResponsesForForm(formId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.respondentStaffId).toBeNull(); // SET NULL on delete
    // Attributed form → label is "Former staff" (NOT "Anonymous").
    expect(
      respondentLabel({
        channel: rows[0]!.channel,
        allowAnonymous: false,
        respondentName: rows[0]!.respondentName,
      }),
    ).toBe("Former staff");
  });

  it("locks field-structure edits once internal_enabled", async () => {
    const formId = await makeForm(repoA, { internal: true });
    // Adding a field is a structural change → rejected while shared with staff.
    const locked = await repoA.saveForm(formId, {
      title: "Staff survey",
      fields: [
        { label: "Comment", type: "short_text", required: true, options: [] },
        { label: "Extra", type: "short_text", required: false, options: [] },
      ],
    });
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.reason).toBe("locked");

    // Turning staff access off unlocks editing again.
    await repoA.setFormInternalEnabled(formId, false);
    const ok = await repoA.saveForm(formId, {
      title: "Staff survey",
      fields: [
        { label: "Comment", type: "short_text", required: true, options: [] },
        { label: "Extra", type: "short_text", required: false, options: [] },
      ],
    });
    expect(ok.ok).toBe(true);
  });

  it("freezes the anonymity toggle once an internal response exists", async () => {
    const formId = await makeForm(repoA, { internal: true });
    const { fields, firstFieldId } = await fieldsOf(repoA, formId);
    await processInternalSubmission(
      repoA,
      {
        formId,
        fields,
        rawAnswers: { [firstFieldId]: "hi" },
        anonymous: false,
        staffMemberId: staffA1,
      },
      allowLimiter,
    );
    const res = await repoA.setFormAllowAnonymous(formId, true);
    expect(res).toEqual({ ok: false, reason: "locked" });
  });
});
