import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo } from "@/lib/tenant/repository";

/**
 * Integration coverage for shift-type (template) colour + edit + delete:
 * a chosen colour is stored and surfaced on the public roster query, deleting a
 * type keeps past shifts (FK set-null), and all writes are tenant-scoped.
 */
describe("shift type colour + edit + delete", () => {
  let businessA = "";
  let businessB = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Template Biz A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Template Biz B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
    await db.$client.end();
  });

  it("stores and edits a chosen colour", async () => {
    const repo = createTenantRepo(businessA);
    const t = await repo.addTemplate({
      label: "Morning",
      startTime: "07:00",
      endTime: "12:00",
      weekdays: [1, 2, 3],
      color: "#7C5CBF",
    });
    expect(t.color).toBe("#7C5CBF");

    const edited = await repo.updateTemplate(t.id, {
      label: "Morning shift",
      color: "#16A34A",
    });
    expect(edited?.label).toBe("Morning shift");
    expect(edited?.color).toBe("#16A34A");

    // Clearing the colour (null) falls back to keyword-derived at display time.
    const cleared = await repo.updateTemplate(t.id, { color: null });
    expect(cleared?.color).toBeNull();
  });

  it("surfaces the type colour on the public roster rows", async () => {
    const repo = createTenantRepo(businessA);
    const t = await repo.addTemplate({
      label: "Close",
      startTime: "17:00",
      endTime: "23:00",
      weekdays: [5, 6],
      color: "#E11D48",
    });
    const period = await repo.createPeriod({
      label: "Wk",
      startDate: "2026-06-01",
      endDate: "2026-06-07",
    });
    await repo.createShifts([
      {
        rosterPeriodId: period.id,
        templateId: t.id,
        date: "2026-06-05",
        label: "Close",
        startTime: "17:00",
        endTime: "23:00",
      },
    ]);
    const rows = await repo.rosterRows(period.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.color).toBe("#E11D48");
  });

  it("deleting a type keeps past shifts (FK set-null)", async () => {
    const repo = createTenantRepo(businessA);
    const t = await repo.addTemplate({
      label: "Arvo",
      startTime: "12:00",
      endTime: "17:00",
      weekdays: [1],
      color: "#D97706",
    });
    const period = await repo.createPeriod({
      label: "Wk2",
      startDate: "2026-06-08",
      endDate: "2026-06-14",
    });
    const [shift] = await repo.createShifts([
      {
        rosterPeriodId: period.id,
        templateId: t.id,
        date: "2026-06-08",
        label: "Arvo",
        startTime: "12:00",
        endTime: "17:00",
      },
    ]);

    const deleted = await repo.deleteTemplate(t.id);
    expect(deleted?.id).toBe(t.id);
    const remaining = await repo.listTemplates();
    expect(remaining.find((x) => x.id === t.id)).toBeUndefined();

    // The shift survives, just unlinked from the deleted type.
    const still = await repo.getShift(shift!.id);
    expect(still?.id).toBe(shift!.id);
    expect(still?.templateId).toBeNull();
  });

  it("cannot edit or delete another tenant's type", async () => {
    const repoA = createTenantRepo(businessA);
    const repoB = createTenantRepo(businessB);
    const t = await repoA.addTemplate({
      label: "Night",
      startTime: "22:00",
      endTime: "23:59",
      weekdays: [7],
      color: "#1E293B",
    });

    expect(await repoB.updateTemplate(t.id, { color: "#76b900" })).toBeNull();
    expect(await repoB.deleteTemplate(t.id)).toBeNull();

    // A's type is untouched.
    const list = await repoA.listTemplates();
    expect(list.find((x) => x.id === t.id)?.color).toBe("#1E293B");
  });
});
