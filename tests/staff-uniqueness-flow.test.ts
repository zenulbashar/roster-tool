import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { staffMembers } from "@/lib/db/schema";
import { isUniqueViolation, pgErrorCode } from "@/lib/db/errors";
import {
  createTenantRepo,
  StaffExistsInOrgError,
} from "@/lib/tenant/repository";
import { createOrgRepo } from "@/lib/tenant/org-repository";
import { createAdminRepo } from "@/lib/admin/repository";
import { makeOrgWithTwoLocations, type TwoLocationOrg } from "./helpers/org";

/**
 * COR-03 — a person is ONE org-level row. Adding the same email (any case) at
 * a second location of the same org is refused with a pointer to the existing
 * record (the Staff page offers "add them to this location" instead), the
 * database itself rejects a duplicate, another organisation is free to have
 * the same email, and legacy duplicates are DETECTED — never merged.
 */
describe("org-level staff uniqueness (COR-03)", () => {
  let org: TwoLocationOrg;
  let other: TwoLocationOrg;
  let adaId = "";

  beforeAll(async () => {
    org = await makeOrgWithTwoLocations({ prefix: "uniq" });
    other = await makeOrgWithTwoLocations({ prefix: "uniq-other" });
  });

  afterAll(async () => {
    await org.cleanup();
    await other.cleanup();
    await db.$client.end();
  });

  it("the unique index exists on a clean database", async () => {
    const { rows } = await db.execute(
      sql`select indexname from pg_indexes where indexname = 'staff_member_org_email_lower_unique'`,
    );
    expect(rows).toHaveLength(1);
  });

  it("refuses the same person at a second location and points at the existing record", async () => {
    const repoA = createTenantRepo(org.bizA);
    const ada = await repoA.addStaff({ name: "Ada", email: "ada@uniq.test" });
    adaId = ada.id;

    const repoB = createTenantRepo(org.bizB);
    let caught: unknown = null;
    try {
      await repoB.addStaff({ name: "Ada Again", email: "ADA@Uniq.Test" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StaffExistsInOrgError);
    const e = caught as StaffExistsInOrgError;
    expect(e.existing.id).toBe(adaId);
    expect(e.existing.name).toBe("Ada");
    expect(e.existing.homeBusinessId).toBe(org.bizA);
    expect(e.existing.memberHere).toBe(false);

    // Still exactly one Ada in the org.
    const people = await createOrgRepo(org.orgId).listPeople();
    expect(
      people.filter((p) => p.email.toLowerCase() === "ada@uniq.test"),
    ).toHaveLength(1);
  });

  it("reports memberHere when the person is already at THIS location", async () => {
    const repoA = createTenantRepo(org.bizA);
    await expect(
      repoA.addStaff({ name: "Ada", email: "ada@uniq.test" }),
    ).rejects.toMatchObject({ existing: { id: adaId, memberHere: true } });

    // The remedy the Staff page offers: place the existing record here.
    expect(
      (await createOrgRepo(org.orgId).addPersonToLocation(adaId, org.bizB)).ok,
    ).toBe(true);
    await expect(
      createTenantRepo(org.bizB).addStaff({
        name: "Ada",
        email: "ada@uniq.test",
      }),
    ).rejects.toMatchObject({ existing: { id: adaId, memberHere: true } });
  });

  it("finds an org member by email, case-insensitively, and only inside the org", async () => {
    const repoB = createTenantRepo(org.bizB);
    const found = await repoB.findOrgMemberByEmail("  Ada@UNIQ.test ");
    expect(found?.id).toBe(adaId);
    expect(
      await createTenantRepo(other.bizA).findOrgMemberByEmail("ada@uniq.test"),
    ).toBeNull();
  });

  it("another organisation may have the same email (no cross-org constraint)", async () => {
    const theirs = await createTenantRepo(other.bizA).addStaff({
      name: "Other Ada",
      email: "ada@uniq.test",
    });
    expect(theirs.id).not.toBe(adaId);
  });

  it("the database rejects a case-variant duplicate even if the app guard is bypassed", async () => {
    // The ORM wraps the driver error (DrizzleQueryError → cause), so the
    // SQLSTATE is read through the shared classifier, never `err.code`.
    const rawInsert = await db
      .insert(staffMembers)
      .values({
        orgId: org.orgId,
        businessId: org.bizB,
        name: "Raw Ada",
        email: "Ada@uniq.TEST",
      })
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(rawInsert).not.toBeNull();
    expect(pgErrorCode(rawInsert)).toBe("23505");
    expect(isUniqueViolation(rawInsert)).toBe(true);

    // ...and an edit that would collide is refused the same way.
    const repoB = createTenantRepo(org.bizB);
    const bob = await repoB.addStaff({ name: "Bob", email: "bob@uniq.test" });
    const edit = await repoB
      .updateStaff(bob.id, { email: "ADA@uniq.test" })
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(isUniqueViolation(edit)).toBe(true);
    // A non-database error is never mistaken for a unique violation.
    expect(isUniqueViolation(new Error("nope"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });

  it("detects legacy duplicates (rows without org_id) for the owner and counts them for the admin — never merging", async () => {
    // Pre-backfill shape: org_id null, reached through the home business.
    await db.insert(staffMembers).values([
      { businessId: org.bizA, name: "Legacy One", email: "legacy@uniq.test" },
      { businessId: org.bizB, name: "Legacy Two", email: "LEGACY@uniq.test" },
    ]);

    const dupes = await createOrgRepo(org.orgId).listDuplicatePeople();
    expect(dupes).toHaveLength(1);
    expect(dupes[0]!.email).toBe("legacy@uniq.test");
    expect(dupes[0]!.people.map((p) => p.name)).toEqual([
      "Legacy One",
      "Legacy Two",
    ]);
    expect(dupes[0]!.people.map((p) => p.homeBusinessId)).toEqual([
      org.bizA,
      org.bizB,
    ]);

    expect(await createAdminRepo().countDuplicateStaff(org.orgId)).toBe(1);
    expect(await createAdminRepo().countDuplicateStaff(other.orgId)).toBe(0);
    expect(await createOrgRepo(other.orgId).listDuplicatePeople()).toEqual([]);

    // Both rows still exist — detection reports, it never merges.
    const legacyRows = await db
      .select({ id: staffMembers.id })
      .from(staffMembers)
      .where(eq(sql`lower(${staffMembers.email})`, "legacy@uniq.test"));
    expect(legacyRows).toHaveLength(2);
  });
});
