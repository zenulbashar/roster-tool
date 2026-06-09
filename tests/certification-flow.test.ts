import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";

/**
 * Integration coverage of certification CRUD against the real DB: tenant
 * isolation on every owner action, the foreign-staff guard, and the reminder
 * cursor resetting when the expiry date changes.
 */
describe("certification CRUD", () => {
  let businessA = "";
  let businessB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;
  let staffA = "";
  let staffB = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Cert Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Cert Café B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
    repoA = createTenantRepo(businessA);
    repoB = createTenantRepo(businessB);
    staffA = (await repoA.addStaff({ name: "Ava", email: "ava@a.test" })).id;
    staffB = (await repoB.addStaff({ name: "Ben", email: "ben@b.test" })).id;
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
    await db.$client.end();
  });

  it("adds a certification and lists it with the staff name", async () => {
    const created = await repoA.addCertification({
      staffMemberId: staffA,
      certType: "rsa",
      referenceNumber: "RSA-123",
      expiryDate: "2026-09-01",
    });
    expect(created).not.toBeNull();
    expect(created!.businessId).toBe(businessA);
    expect(created!.lastReminderStage).toBeNull();

    const list = await repoA.listCertifications();
    expect(
      list.some((c) => c.id === created!.id && c.staffName === "Ava"),
    ).toBe(true);
  });

  it("rejects a foreign staff id on add", async () => {
    expect(
      await repoA.addCertification({
        staffMemberId: staffB,
        certType: "first_aid",
        expiryDate: "2026-09-01",
      }),
    ).toBeNull();
  });

  it("resets the reminder cursor only when the expiry date changes", async () => {
    const cert = await repoA.addCertification({
      staffMemberId: staffA,
      certType: "food_safety",
      expiryDate: "2026-10-01",
    });
    await repoA.updateCertReminderStage(cert!.id, "early");
    expect((await repoA.getCertification(cert!.id))?.lastReminderStage).toBe(
      "early",
    );

    // Editing without touching the expiry keeps the cursor.
    await repoA.updateCertification(cert!.id, {
      certType: "food_safety",
      referenceNumber: "FS-9",
      expiryDate: "2026-10-01",
    });
    expect((await repoA.getCertification(cert!.id))?.lastReminderStage).toBe(
      "early",
    );

    // Changing the expiry re-arms reminders.
    await repoA.updateCertification(cert!.id, {
      certType: "food_safety",
      expiryDate: "2027-10-01",
    });
    expect(
      (await repoA.getCertification(cert!.id))?.lastReminderStage,
    ).toBeNull();
  });

  it("isolates certifications across tenants", async () => {
    const inA = await repoA.addCertification({
      staffMemberId: staffA,
      certType: "wwcc",
      expiryDate: "2026-12-01",
    });

    // B can't read, update, advance or delete A's cert.
    expect(await repoB.getCertification(inA!.id)).toBeNull();
    expect(
      await repoB.updateCertification(inA!.id, {
        certType: "other",
        certLabel: "Hacked",
        expiryDate: "2030-01-01",
      }),
    ).toBeNull();
    expect(await repoB.updateCertReminderStage(inA!.id, "final")).toBeNull();
    await repoB.deleteCertification(inA!.id);
    expect((await repoA.getCertification(inA!.id))?.certType).toBe("wwcc");

    // B's list never shows A's cert.
    expect(
      (await repoB.listCertifications()).some((c) => c.id === inA!.id),
    ).toBe(false);

    await repoA.deleteCertification(inA!.id);
    expect(await repoA.getCertification(inA!.id)).toBeNull();
  });
});
