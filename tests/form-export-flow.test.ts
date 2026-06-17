import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { getFormExport } from "@/lib/form-export";
import type { FormFieldInput } from "@/lib/validation";

/**
 * CSV export against the real DB: the owner-scoped orchestrator produces a CSV
 * of a form's responses, surfaces a since-deleted field as an orphan column,
 * and refuses to export another business's form (the route's 404 path).
 */
describe("form export flow", () => {
  let businessA = "";
  let businessB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Export Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Export Café B" })
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
    const form = await repo.createForm({ title: "Survey!" });
    await repo.saveForm(form.id, {
      title: "Survey!",
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

  async function seed(
    repo: TenantRepo,
    formId: string,
    v: { name: string; size: string; stars: number },
  ) {
    const data = (await repo.getFormWithFields(formId))!;
    const byType = (t: string) => data.fields.find((f) => f.type === t)!;
    await repo.createPublicResponse(formId, {
      channel: "public",
      source: "qr",
      answers: [
        {
          fieldId: byType("short_text").id,
          fieldLabel: "Name",
          fieldType: "short_text",
          valueText: v.name,
          valueNumber: null,
        },
        {
          fieldId: byType("single_select").id,
          fieldLabel: "Size",
          fieldType: "single_select",
          valueText: v.size,
          valueNumber: null,
        },
        {
          fieldId: byType("rating").id,
          fieldLabel: "Stars",
          fieldType: "rating",
          valueText: null,
          valueNumber: v.stars,
        },
      ],
    });
  }

  it("exports a CSV with metadata + field columns and the right values", async () => {
    const formId = await publishedSurvey(repoA);
    await seed(repoA, formId, { name: "Ada", size: "Large", stars: 5 });

    const result = await getFormExport(repoA, formId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.filename).toBe("survey-responses.csv");
    const lines = result.csv.split("\n");
    expect(lines[0]).toBe(
      "Submitted at,Channel,Respondent,Source,Response id,Name,Size,Stars",
    );
    // One data row with the seeded values.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(",public,Public,qr,");
    expect(lines[1]!.endsWith(",Ada,Large,5")).toBe(true);
  });

  it("surfaces a since-deleted field as an orphan column (nothing dropped)", async () => {
    const formId = await publishedSurvey(repoA);
    await seed(repoA, formId, { name: "Bea", size: "Small", stars: 4 });

    // Unpublish, then remove the rating field → its answer's field_id → null.
    await repoA.closeForm(formId);
    const data = (await repoA.getFormWithFields(formId))!;
    await repoA.saveForm(formId, {
      title: "Survey!",
      fields: data.fields
        .filter((f) => f.type !== "rating")
        .map((f) => ({
          id: f.id,
          label: f.label,
          type: f.type,
          required: false,
          options: (f.options ?? []).map((o) => ({ id: o.id, label: o.label })),
        })),
    });

    const result = await getFormExport(repoA, formId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const header = result.csv.split("\n")[0]!;
    expect(header).toContain("Stars (removed)");
    // The deleted-field value (4) survives in the orphan column.
    expect(result.csv.split("\n")[1]!.endsWith(",4")).toBe(true);
  });

  it("refuses to export another business's form (route 404 path)", async () => {
    const formId = await publishedSurvey(repoA);
    await seed(repoA, formId, { name: "Cleo", size: "Large", stars: 3 });

    // B, scoped to its own tenant, cannot resolve or export A's form.
    expect(await getFormExport(repoB, formId)).toEqual({ ok: false });
    // A still exports fine.
    const a = await getFormExport(repoA, formId);
    expect(a.ok).toBe(true);
  });
});
