import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import {
  buildFormSummary,
  type LiveField,
  type RatingSummary,
  type TallySummary,
} from "@/lib/form-report";
import type { FormFieldInput } from "@/lib/validation";

/**
 * Owner responses view (Phase 1c) against the real DB: summary aggregation,
 * snapshot integrity for a deleted field, deterministic pagination, the delete
 * guard, and tenant isolation on every owner-side read.
 */
describe("form report flow", () => {
  let businessA = "";
  let businessB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Report Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Report Café B" })
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

  async function publishedSurvey(repo: TenantRepo) {
    const form = await repo.createForm({ title: "Survey" });
    await repo.saveForm(form.id, {
      title: "Survey",
      fields: [
        field({ label: "Name", type: "short_text" }),
        field({
          label: "Size",
          type: "single_select",
          options: [{ label: "Small" }, { label: "Large" }],
        }),
        field({ label: "Stars", type: "rating" }),
      ],
    });
    await repo.publishForm(form.id);
    return form.id;
  }

  async function liveFieldsOf(repo: TenantRepo, formId: string) {
    const data = (await repo.getFormWithFields(formId))!;
    const fields: LiveField[] = data.fields.map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      position: f.position,
    }));
    const byType = (t: string) => data.fields.find((f) => f.type === t)!;
    return { fields, byType };
  }

  async function seed(
    repo: TenantRepo,
    formId: string,
    v: { name: string; size: string; stars: number },
  ) {
    const { byType } = await liveFieldsOf(repo, formId);
    const name = byType("short_text");
    const size = byType("single_select");
    const stars = byType("rating");
    await repo.createPublicResponse(formId, {
      channel: "public",
      source: null,
      answers: [
        {
          fieldId: name.id,
          fieldLabel: "Name",
          fieldType: "short_text",
          valueText: v.name,
          valueNumber: null,
        },
        {
          fieldId: size.id,
          fieldLabel: "Size",
          fieldType: "single_select",
          valueText: v.size,
          valueNumber: null,
        },
        {
          fieldId: stars.id,
          fieldLabel: "Stars",
          fieldType: "rating",
          valueText: null,
          valueNumber: v.stars,
        },
      ],
    });
  }

  it("aggregates rating average + distribution, select tally, recent text", async () => {
    const formId = await publishedSurvey(repoA);
    await seed(repoA, formId, { name: "Ada", size: "Large", stars: 5 });
    await seed(repoA, formId, { name: "Bea", size: "Large", stars: 3 });
    await seed(repoA, formId, { name: "Cleo", size: "Small", stars: 5 });

    const { fields } = await liveFieldsOf(repoA, formId);
    const [agg, text] = await Promise.all([
      repoA.getResponseSummaryAggregates(formId),
      repoA.getRecentTextAnswers(formId, 5),
    ]);
    const summary = buildFormSummary(fields, agg, text);

    const stars = summary.find((s) => s.label === "Stars") as RatingSummary;
    expect(stars.count).toBe(3);
    expect(stars.average).toBe(4.33);
    expect(stars.distribution.find((d) => d.value === 5)!.count).toBe(2);
    expect(stars.distribution.find((d) => d.value === 3)!.count).toBe(1);

    const size = summary.find((s) => s.label === "Size") as TallySummary;
    expect(size.tally).toEqual([
      { value: "Large", count: 2 },
      { value: "Small", count: 1 },
    ]);

    const name = summary.find((s) => s.label === "Name")!;
    expect(name.kind).toBe("text");
    if (name.kind === "text") {
      expect(name.recent.sort()).toEqual(["Ada", "Bea", "Cleo"]);
    }

    expect(await repoA.countResponses(formId)).toBe(3);
  });

  it("keeps answers to a since-deleted field via the snapshot (field_id null)", async () => {
    const formId = await publishedSurvey(repoA);
    await seed(repoA, formId, { name: "Dee", size: "Small", stars: 4 });

    // Unpublish (fields are locked while published), then remove the rating
    // field — its answer's field_id becomes null (ON DELETE SET NULL).
    await repoA.closeForm(formId);
    const { fields } = await liveFieldsOf(repoA, formId);
    await repoA.saveForm(formId, {
      title: "Survey",
      fields: fields
        .filter((f) => f.type !== "rating")
        .map((f) => ({
          id: f.id,
          label: f.label,
          type: f.type,
          required: false,
          options: [],
        })),
    });

    // The response's rating answer survives, self-described, field_id null.
    const responses = await repoA.getResponsesForForm(formId);
    const ratingAnswer = responses[0]!.answers.find(
      (a) => a.fieldType === "rating",
    )!;
    expect(ratingAnswer.fieldId).toBeNull();
    expect(ratingAnswer.fieldLabel).toBe("Stars");
    expect(ratingAnswer.valueNumber).toBe(4);

    // And it shows in the summary as a deleted group.
    const liveNow = (await liveFieldsOf(repoA, formId)).fields;
    const [agg, text] = await Promise.all([
      repoA.getResponseSummaryAggregates(formId),
      repoA.getRecentTextAnswers(formId, 5),
    ]);
    const summary = buildFormSummary(liveNow, agg, text);
    const orphan = summary.find((s) => s.label === "Stars") as RatingSummary;
    expect(orphan).toBeDefined();
    expect(orphan.deleted).toBe(true);
    expect(orphan.count).toBe(1);
  });

  it("paginates deterministically with no overlap or gaps", async () => {
    const formId = await publishedSurvey(repoA);
    for (let i = 0; i < 5; i++) {
      await seed(repoA, formId, { name: `P${i}`, size: "Small", stars: 1 });
    }
    expect(await repoA.countResponses(formId)).toBe(5);

    const seen = new Set<string>();
    for (let page = 0; page < 3; page++) {
      const rows = await repoA.getResponsesForForm(formId, {
        limit: 2,
        offset: page * 2,
      });
      for (const r of rows) {
        expect(seen.has(r.id)).toBe(false); // no overlap across pages
        seen.add(r.id);
      }
    }
    expect(seen.size).toBe(5); // every response seen exactly once
  });

  it("guards delete: blocks a form with responses unless confirmed", async () => {
    const formId = await publishedSurvey(repoA);
    await seed(repoA, formId, { name: "Eve", size: "Large", stars: 2 });

    // Without confirmation → refused, nothing deleted.
    const blocked = await repoA.deleteForm(formId);
    expect(blocked).toEqual({ ok: false, reason: "has_responses", count: 1 });
    expect(await repoA.getFormWithFields(formId)).not.toBeNull();
    expect(await repoA.countResponses(formId)).toBe(1);

    // With confirmation → deleted, responses gone (cascade).
    const ok = await repoA.deleteForm(formId, { confirmed: true });
    expect(ok).toEqual({ ok: true });
    expect(await repoA.getFormWithFields(formId)).toBeNull();
  });

  it("deletes an empty form without confirmation", async () => {
    const empty = await repoA.createForm({ title: "Empty" });
    const ok = await repoA.deleteForm(empty.id);
    expect(ok).toEqual({ ok: true });
    expect(await repoA.getFormWithFields(empty.id)).toBeNull();
  });

  it("keeps responses scoped: B cannot read or delete A's form/responses", async () => {
    const formId = await publishedSurvey(repoA);
    await seed(repoA, formId, { name: "Faye", size: "Small", stars: 5 });

    expect(await repoB.getResponsesForForm(formId)).toEqual([]);
    expect(await repoB.countResponses(formId)).toBe(0);
    expect(await repoB.getResponseSummaryAggregates(formId)).toEqual([]);

    const del = await repoB.deleteForm(formId, { confirmed: true });
    expect(del).toEqual({ ok: false, reason: "not_found" });
    // A's form + response untouched.
    expect(await repoA.countResponses(formId)).toBe(1);
  });
});
