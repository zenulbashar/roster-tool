import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organisations,
  businesses,
  staffLocations,
  staffLoans,
} from "@/lib/db/schema";
import { createTenantRepo } from "@/lib/tenant/repository";
import { createOrgRepo } from "@/lib/tenant/org-repository";
import { handleStaffLoanExpiry } from "@/lib/jobs/handlers";

/**
 * M29 Phase 4: date-ranged staff loans. Creating a loan makes the person
 * rosterable at the target (a loan-tagged membership); ending it (owner or the
 * expiry job) removes ONLY the loan-created membership — never a permanent one.
 * Plus cross-org + lend-to-home guards.
 */
describe("staff loan flow (Phase 4)", () => {
  let org = "";
  let bizA = "";
  let bizB = "";
  let orgX = "";
  let bizX = "";
  let ada = "";
  let orgRepo: ReturnType<typeof createOrgRepo>;

  const membership = (businessId: string, staffId: string) =>
    db
      .select({ active: staffLocations.active, loanId: staffLocations.loanId })
      .from(staffLocations)
      .where(
        and(
          eq(staffLocations.businessId, businessId),
          eq(staffLocations.staffMemberId, staffId),
        ),
      )
      .then((r) => r[0] ?? null);

  beforeAll(async () => {
    const [o] = await db
      .insert(organisations)
      .values({ name: "Loan Org" })
      .returning();
    org = o!.id;
    const [a] = await db
      .insert(businesses)
      .values({ name: "Home", orgId: org })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Away", orgId: org })
      .returning();
    bizA = a!.id;
    bizB = b!.id;
    orgRepo = createOrgRepo(org);

    const [ox] = await db
      .insert(organisations)
      .values({ name: "Rival" })
      .returning();
    orgX = ox!.id;
    const [bx] = await db
      .insert(businesses)
      .values({ name: "Rival Cafe", orgId: orgX })
      .returning();
    bizX = bx!.id;

    ada = (
      await createTenantRepo(bizA).addStaff({ name: "Ada", email: "a@h.test" })
    ).id;
  });

  afterAll(async () => {
    for (const id of [org, orgX]) {
      if (id) await db.delete(organisations).where(eq(organisations.id, id));
    }
    await db.$client.end();
  });

  it("guards lend-to-home and cross-org", async () => {
    // Can't lend someone to the location they already call home.
    expect(
      (
        await orgRepo.createLoan({
          staffMemberId: ada,
          toBusinessId: bizA,
          startDate: "2026-06-10",
          endDate: "2026-06-14",
        })
      ).reason,
    ).toBe("home");
    // Can't lend to another org's location, and another org can't borrow Ada.
    expect(
      (
        await orgRepo.createLoan({
          staffMemberId: ada,
          toBusinessId: bizX,
          startDate: "2026-06-10",
          endDate: "2026-06-14",
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await createOrgRepo(orgX).createLoan({
          staffMemberId: ada,
          toBusinessId: bizX,
          startDate: "2026-06-10",
          endDate: "2026-06-14",
        })
      ).ok,
    ).toBe(false);
  });

  it("makes the person rosterable at the target, tagged with the loan", async () => {
    const res = await orgRepo.createLoan({
      staffMemberId: ada,
      toBusinessId: bizB,
      startDate: "2026-06-10",
      endDate: "2026-06-14",
      note: "covering leave",
    });
    expect(res.ok).toBe(true);

    // Ada now resolves at Away (rosterable there).
    expect((await createTenantRepo(bizB).getStaff(ada))?.id).toBe(ada);
    const m = await membership(bizB, ada);
    expect(m?.active).toBe(true);
    expect(m?.loanId).toBeTruthy(); // loan-created

    const loans = await orgRepo.listLoans();
    const loan = loans.find((l) => l.staffMemberId === ada);
    expect(loan?.toName).toBe("Away");
    expect(loan?.staffName).toBe("Ada");
    expect(loan?.note).toBe("covering leave");
  });

  it("ends a loan and removes only the loan-created membership", async () => {
    const [loan] = await orgRepo.listLoans();
    const res = await orgRepo.endLoan(loan!.id);
    expect(res.ok).toBe(true);

    // Membership deactivated → no longer rosterable at Away.
    expect((await membership(bizB, ada))?.active).toBe(false);
    expect(await createTenantRepo(bizB).getStaff(ada)).toBeNull();
    // Loan dropped from the live list.
    expect((await orgRepo.listLoans()).length).toBe(0);
  });

  it("never removes a permanent membership when a loan ends", async () => {
    // Make Ada a PERMANENT member of Away (no loan), then lend her there too.
    await orgRepo.addPersonToLocation(ada, bizB);
    expect((await membership(bizB, ada))?.loanId).toBeNull();

    const res = await orgRepo.createLoan({
      staffMemberId: ada,
      toBusinessId: bizB,
      startDate: "2026-06-10",
      endDate: "2026-06-14",
    });
    expect(res.ok).toBe(true);
    // The pre-existing active membership was left untouched (still permanent).
    expect((await membership(bizB, ada))?.loanId).toBeNull();

    // Ending the loan must NOT deactivate the permanent membership.
    const [loan] = await orgRepo.listLoans();
    await orgRepo.endLoan(loan!.id);
    expect((await membership(bizB, ada))?.active).toBe(true);

    // Clean up the permanent membership for the expiry test below.
    await orgRepo.removePersonFromLocation(ada, bizB);
  });

  it("auto-expires loans past their end date via the daily job", async () => {
    const res = await orgRepo.createLoan({
      staffMemberId: ada,
      toBusinessId: bizB,
      startDate: "2026-06-10",
      endDate: "2026-06-14",
    });
    expect(res.ok).toBe(true);
    expect((await membership(bizB, ada))?.active).toBe(true);

    // Run the sweep with "now" well past the loan's end date.
    await handleStaffLoanExpiry(new Date("2027-01-01T00:00:00Z"));

    // The loan is inactive and the loan-created membership is gone.
    expect((await orgRepo.listLoans()).length).toBe(0);
    expect((await membership(bizB, ada))?.active).toBe(false);
    const [row] = await db
      .select({ active: staffLoans.active })
      .from(staffLoans)
      .where(eq(staffLoans.staffMemberId, ada))
      .orderBy(staffLoans.createdAt);
    expect(row?.active).toBe(false);
  });
});
