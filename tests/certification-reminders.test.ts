import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, users } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { handleCertificationReminders } from "@/lib/jobs/handlers";

/** A fixed instant at noon UTC for a given calendar date. */
function at(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}
/** Add `n` calendar days to a YYYY-MM-DD string. */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return dt.toISOString().slice(0, 10);
}

const BASE = "2026-06-09";
const OWNER_EMAILS = [
  "owner-digest@cert.test",
  "owner-stage@cert.test",
  "owner-nouser-skip@cert.test",
];

describe("certification reminder job", () => {
  let bizDigest = "";
  let bizStage = "";
  let bizNoOwner = "";
  let repoDigest: TenantRepo;
  let repoStage: TenantRepo;

  async function addOwner(businessId: string, email: string) {
    await db.insert(users).values({ email, businessId });
  }

  beforeAll(async () => {
    const [d] = await db
      .insert(businesses)
      .values({ name: "Digest Co", timezone: "UTC" })
      .returning();
    const [s] = await db
      .insert(businesses)
      .values({ name: "Stage Co", timezone: "UTC" })
      .returning();
    const [n] = await db
      .insert(businesses)
      .values({ name: "No Owner Co", timezone: "UTC" })
      .returning();
    bizDigest = d!.id;
    bizStage = s!.id;
    bizNoOwner = n!.id;
    repoDigest = createTenantRepo(bizDigest);
    repoStage = createTenantRepo(bizStage);

    await addOwner(bizDigest, OWNER_EMAILS[0]!);
    await addOwner(bizStage, OWNER_EMAILS[1]!);
    // bizNoOwner intentionally has no user → must be skipped.
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.email, OWNER_EMAILS));
    for (const id of [bizDigest, bizStage, bizNoOwner]) {
      if (id) await db.delete(businesses).where(eq(businesses.id, id));
    }
    await db.$client.end();
  });

  /** Emails sent to a specific owner in a run. */
  function sentTo(send: ReturnType<typeof vi.fn>, to: string) {
    return send.mock.calls.map((c) => c[0]).filter((m) => m.to === to);
  }

  it("digests only due certs for active staff, scoped per business, skipping owner-less businesses", async () => {
    const ava = (
      await repoDigest.addStaff({ name: "Ava", email: "ava@digest.test" })
    ).id;
    const zoe = (
      await repoDigest.addStaff({ name: "Zoe", email: "zoe@digest.test" })
    ).id;
    await repoDigest.updateStaff(zoe, { active: false });

    await repoDigest.addCertification({
      staffMemberId: ava,
      certType: "rsa",
      expiryDate: addDays(BASE, 30), // early (lead 30) → due
    });
    await repoDigest.addCertification({
      staffMemberId: ava,
      certType: "first_aid",
      expiryDate: addDays(BASE, 5), // final → due
    });
    await repoDigest.addCertification({
      staffMemberId: ava,
      certType: "food_safety",
      expiryDate: addDays(BASE, -1), // expired → due
    });
    await repoDigest.addCertification({
      staffMemberId: ava,
      certType: "wwcc",
      expiryDate: addDays(BASE, 60), // valid → NOT due
    });
    // Inactive staff cert in the final window → must be skipped.
    await repoDigest.addCertification({
      staffMemberId: zoe,
      certType: "rsg",
      expiryDate: addDays(BASE, 5),
    });

    // A due cert in a business with NO owner user → must be skipped silently.
    const noOwnerRepo = createTenantRepo(bizNoOwner);
    const orphan = (
      await noOwnerRepo.addStaff({ name: "Pat", email: "pat@noowner.test" })
    ).id;
    await noOwnerRepo.addCertification({
      staffMemberId: orphan,
      certType: "rsa",
      expiryDate: addDays(BASE, 5),
    });

    const send = vi.fn().mockResolvedValue(undefined);
    await handleCertificationReminders(at(BASE), { send });

    const mails = sentTo(send, OWNER_EMAILS[0]!);
    expect(mails.length).toBe(1); // one consolidated digest
    const body = mails[0]!.text;
    expect(body).toContain("Ava");
    expect(body).toContain("expires in 30 days");
    expect(body).toContain("expires in 5 days");
    expect(body).toContain("expired 1 day ago");
    expect(body).not.toContain("Zoe"); // inactive staff excluded
    expect(body).not.toContain("expires in 60 days"); // valid excluded
    // Subject reflects 3 items.
    expect(mails[0]!.subject).toContain("3 certifications");

    // Owner-less business never emailed.
    expect(sentTo(send, "pat@noowner.test").length).toBe(0);

    // Same-day re-run is idempotent: no new email to the owner.
    const send2 = vi.fn().mockResolvedValue(undefined);
    await handleCertificationReminders(at(BASE), { send: send2 });
    expect(sentTo(send2, OWNER_EMAILS[0]!).length).toBe(0);
  });

  it("sends each stage at most once as time advances", async () => {
    const sam = (
      await repoStage.addStaff({ name: "Sam", email: "sam@stage.test" })
    ).id;
    const certId = (await repoStage.addCertification({
      staffMemberId: sam,
      certType: "rsa",
      expiryDate: addDays(BASE, 30),
    }))!.id;

    // Day 0: early.
    const s1 = vi.fn().mockResolvedValue(undefined);
    await handleCertificationReminders(at(BASE), { send: s1 });
    expect(sentTo(s1, OWNER_EMAILS[1]!).length).toBe(1);
    expect(sentTo(s1, OWNER_EMAILS[1]!)[0]!.text).toContain(
      "expires in 30 days",
    );
    expect((await repoStage.getCertification(certId))?.lastReminderStage).toBe(
      "early",
    );

    // Same day again: nothing.
    const s1b = vi.fn().mockResolvedValue(undefined);
    await handleCertificationReminders(at(BASE), { send: s1b });
    expect(sentTo(s1b, OWNER_EMAILS[1]!).length).toBe(0);

    // 7 days out: final.
    const s2 = vi.fn().mockResolvedValue(undefined);
    await handleCertificationReminders(at(addDays(BASE, 23)), { send: s2 });
    expect(sentTo(s2, OWNER_EMAILS[1]!).length).toBe(1);
    expect(sentTo(s2, OWNER_EMAILS[1]!)[0]!.text).toContain(
      "expires in 7 days",
    );

    // Expiry day: expired.
    const s3 = vi.fn().mockResolvedValue(undefined);
    await handleCertificationReminders(at(addDays(BASE, 30)), { send: s3 });
    expect(sentTo(s3, OWNER_EMAILS[1]!).length).toBe(1);
    expect(sentTo(s3, OWNER_EMAILS[1]!)[0]!.text).toContain("expires today");

    // After expiry: nothing more.
    const s4 = vi.fn().mockResolvedValue(undefined);
    await handleCertificationReminders(at(addDays(BASE, 40)), { send: s4 });
    expect(sentTo(s4, OWNER_EMAILS[1]!).length).toBe(0);
    expect((await repoStage.getCertification(certId))?.lastReminderStage).toBe(
      "expired",
    );
  });
});
