import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import type { FormFieldInput } from "@/lib/validation";

/**
 * Integration coverage of the form builder against the real DB. Proves the two
 * correctness properties of Phase 1a:
 *  - tenant isolation: owner A can't read, save or delete owner B's form, and a
 *    foreign field id threaded into A's save never mutates B's field;
 *  - the transactional saveForm reconciles add + update + delete + reorder in
 *    one call, re-sequences positions 0..n, DB-generates ids for new fields, and
 *    keeps single_select option ids stable across re-saves.
 */
describe("form builder flow", () => {
  let businessA = "";
  let businessB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Forms Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Forms Café B" })
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

  // Helper for building a clean (already-validated-shape) field.
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

  it("creates a draft form forced to the owner's business", async () => {
    const created = await repoA.createForm({ title: "Feedback" });
    expect(created.businessId).toBe(businessA);
    expect(created.status).toBe("draft");
    expect(created.publicSlug).toBeNull();
    expect(created.allowAnonymous).toBe(false);
    expect(created.description).toBeNull();
  });

  it("saves and reloads a zero-field draft", async () => {
    const form = await repoA.createForm({ title: "Empty" });
    const saved = await repoA.saveForm(form.id, {
      title: "Empty (edited)",
      description: "",
      fields: [],
    });
    expect(saved).not.toBeNull();
    const reloaded = await repoA.getFormWithFields(form.id);
    expect(reloaded!.form.title).toBe("Empty (edited)");
    expect(reloaded!.form.description).toBeNull();
    expect(reloaded!.fields).toEqual([]);
  });

  it("reconciles add + update + delete + reorder in one save", async () => {
    const form = await repoA.createForm({ title: "Survey" });

    // Save 1: three fields, including a single_select with two options.
    await repoA.saveForm(form.id, {
      title: "Survey",
      fields: [
        field({ label: "Your name", type: "short_text", required: true }),
        field({
          label: "Size",
          type: "single_select",
          options: [{ label: "Small" }, { label: "Large" }],
        }),
        field({ label: "Comments", type: "long_text" }),
      ],
    });

    const v1 = await repoA.getFormWithFields(form.id);
    expect(v1!.fields.map((f) => f.label)).toEqual([
      "Your name",
      "Size",
      "Comments",
    ]);
    expect(v1!.fields.map((f) => f.position)).toEqual([0, 1, 2]);

    const nameField = v1!.fields[0]!;
    const sizeField = v1!.fields[1]!;
    const commentsField = v1!.fields[2]!;
    const sizeOpts = sizeField.options!;
    expect(sizeOpts.map((o) => o.label)).toEqual(["Small", "Large"]);
    expect(
      sizeOpts.every((o) => typeof o.id === "string" && o.id.length > 0),
    ).toBe(true);

    // Save 2: reorder Comments first; keep Size (existing option ids + a new
    // option with no id); edit Your name's label; delete nothing-but-name? —
    // delete Your name; add a new rating field with a temp id.
    await repoA.saveForm(form.id, {
      title: "Survey v2",
      fields: [
        field({
          id: commentsField.id,
          label: "Comments",
          type: "long_text",
        }),
        field({
          id: sizeField.id,
          label: "T-shirt size",
          type: "single_select",
          options: [
            { id: sizeOpts[0]!.id, label: "Small" },
            { id: sizeOpts[1]!.id, label: "Large" },
            { label: "Medium" }, // new — repo must generate an id
          ],
        }),
        field({ id: "temp-new", label: "Rate us", type: "rating" }),
      ],
    });

    const v2 = await repoA.getFormWithFields(form.id);
    // Your name deleted; reorder + add reflected; contiguous positions.
    expect(v2!.fields.map((f) => f.label)).toEqual([
      "Comments",
      "T-shirt size",
      "Rate us",
    ]);
    expect(v2!.fields.map((f) => f.position)).toEqual([0, 1, 2]);
    expect(v2!.fields.some((f) => f.id === nameField.id)).toBe(false);

    // The new rating field got a DB-generated id (NOT the "temp-new" string).
    const rating = v2!.fields[2]!;
    expect(rating.id).not.toBe("temp-new");
    expect(rating.type).toBe("rating");
    expect(rating.options).toBeNull();

    // Existing option ids preserved; the new option got a fresh id.
    const sizeV2 = v2!.fields[1]!;
    expect(sizeV2.id).toBe(sizeField.id); // same field row updated
    const optsV2 = sizeV2.options!;
    expect(optsV2.map((o) => o.label)).toEqual(["Small", "Large", "Medium"]);
    expect(optsV2[0]!.id).toBe(sizeOpts[0]!.id);
    expect(optsV2[1]!.id).toBe(sizeOpts[1]!.id);
    expect(typeof optsV2[2]!.id).toBe("string");
    expect(optsV2[2]!.id.length).toBeGreaterThan(0);
    expect([sizeOpts[0]!.id, sizeOpts[1]!.id]).not.toContain(optsV2[2]!.id);
  });

  it("lists only the owner's own forms", async () => {
    await repoB.createForm({ title: "B's private form" });
    const aForms = await repoA.listForms();
    const bForms = await repoB.listForms();
    expect(aForms.every((f) => f.title !== "B's private form")).toBe(true);
    expect(bForms.some((f) => f.title === "B's private form")).toBe(true);
  });

  it("blocks cross-tenant read / save / delete by id", async () => {
    const formB = await repoB.createForm({ title: "B only" });
    await repoB.saveForm(formB.id, {
      title: "B only",
      fields: [field({ label: "Secret", type: "short_text" })],
    });

    // A cannot read B's form.
    expect(await repoA.getFormWithFields(formB.id)).toBeNull();

    // A cannot save into B's form.
    expect(
      await repoA.saveForm(formB.id, {
        title: "Hijacked",
        fields: [],
      }),
    ).toBeNull();

    // A cannot delete B's form.
    await repoA.deleteForm(formB.id);
    const stillThere = await repoB.getFormWithFields(formB.id);
    expect(stillThere).not.toBeNull();
    expect(stillThere!.form.title).toBe("B only");
    expect(stillThere!.fields.map((f) => f.label)).toEqual(["Secret"]);
  });

  it("never mutates another form's field via a forged field id", async () => {
    const formB = await repoB.createForm({ title: "B target" });
    await repoB.saveForm(formB.id, {
      title: "B target",
      fields: [field({ label: "B field", type: "short_text" })],
    });
    const bField = (await repoB.getFormWithFields(formB.id))!.fields[0]!;

    // A owns its own form and tries to save a field carrying B's field id.
    const formA = await repoA.createForm({ title: "A attacker" });
    await repoA.saveForm(formA.id, {
      title: "A attacker",
      fields: [field({ id: bField.id, label: "Stolen?", type: "short_text" })],
    });

    // B's field is untouched (same id, same label, still on form B).
    const bAfter = (await repoB.getFormWithFields(formB.id))!.fields;
    expect(bAfter).toHaveLength(1);
    expect(bAfter[0]!.id).toBe(bField.id);
    expect(bAfter[0]!.label).toBe("B field");

    // A's field was inserted with a NEW id, not B's.
    const aFields = (await repoA.getFormWithFields(formA.id))!.fields;
    expect(aFields).toHaveLength(1);
    expect(aFields[0]!.label).toBe("Stolen?");
    expect(aFields[0]!.id).not.toBe(bField.id);
    expect(aFields[0]!.businessId).toBe(businessA);
  });
});
