import { eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { businesses, staffMembers } from "@/lib/db/schema";
import { hashToken } from "@/lib/tokens";

/**
 * Cross-tenant entry point for a staff member's PRIVATE notices page (/me).
 *
 * Mirrors the kiosk/personal-clock resolvers, but the capability token is
 * PER STAFF MEMBER (`staff_member.notices_token_hash`), so a link resolves to
 * exactly one person — it yields both the businessId AND the staffMemberId.
 * Reached WITHOUT any session: the raw token in the URL (then an httpOnly
 * cookie scoped to /me) identifies WHO; their PIN (checked separately, with
 * the shared per-staff lockout) proves it's them before anything personal is
 * shown. We compare on the stored hash, never the raw token. Inactive staff
 * don't resolve (removing someone closes their link). All further reads go
 * through `createTenantRepo(businessId)` scoped to this staffMemberId.
 */

export type NoticesStaff = {
  businessId: string;
  staffMemberId: string;
  staffName: string;
  businessName: string;
};

/** Resolve the notices staff member from a raw capability token, or null. */
export async function resolveNoticesStaff(
  rawToken: string,
  database: Db = defaultDb,
): Promise<NoticesStaff | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const rows = await database
    .select({
      businessId: staffMembers.businessId,
      staffMemberId: staffMembers.id,
      staffName: staffMembers.name,
      businessName: businesses.name,
      active: staffMembers.active,
    })
    .from(staffMembers)
    .innerJoin(businesses, eq(staffMembers.businessId, businesses.id))
    .where(eq(staffMembers.noticesTokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row || !row.active) return null;
  return {
    businessId: row.businessId,
    staffMemberId: row.staffMemberId,
    staffName: row.staffName,
    businessName: row.businessName,
  };
}
