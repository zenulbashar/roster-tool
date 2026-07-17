import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organisations,
  businesses,
  staffMembers,
  xeroConnections,
  googleDriveConnections,
  timesheetEntries,
  rosterPeriods,
  adminActivities,
  platformAdmins,
  users,
} from "@/lib/db/schema";

/**
 * The Zale IT admin data-access layer (M37).
 *
 * This is the SINGLE, EXPLICIT exception to the codebase's per-business tenant
 * scoping: the admin console reads aggregate account data across EVERY
 * organisation. It is reachable only behind `requireAdmin()`. A "client" here is
 * an `organisation` (the account boundary since M29); each client has one or
 * more locations (`business` rows) and an org-wide staff pool. This layer never
 * exposes a tenant's operational rows (rosters, timesheets, pay) — only counts,
 * integration presence and last-active signals — plus the admin audit log.
 */

export type PlanStatus = "active" | "trial" | "paused";

export interface AdminClientRow {
  orgId: string;
  name: string;
  planStatus: PlanStatus;
  siteCount: number;
  staffCount: number;
  hasXero: boolean;
  hasDrive: boolean;
  lastActiveAt: Date | null;
  createdAt: Date;
}

export interface ClientStats {
  total: number;
  active: number;
  trial: number;
  paused: number;
  totalStaff: number;
}

export interface AdminActivityRow {
  id: string;
  adminName: string;
  action: string;
  detail: string | null;
  isWrite: boolean;
  orgId: string | null;
  businessId: string | null;
  venueName: string | null;
  createdAt: Date;
}

export interface ClientLocation {
  id: string;
  name: string;
  hasXero: boolean;
  xeroOrgName: string | null;
  xeroActive: boolean;
  hasDrive: boolean;
  driveEmail: string | null;
  driveNeedsReconnect: boolean;
}

export interface ClientDetail {
  orgId: string;
  name: string;
  planStatus: PlanStatus;
  createdAt: Date;
  staffCount: number;
  lastActiveAt: Date | null;
  locations: ClientLocation[];
  recentActivity: AdminActivityRow[];
}

export interface RecordActivityInput {
  adminUserId: string;
  adminName: string;
  action: string;
  detail?: string | null;
  isWrite?: boolean;
  orgId?: string | null;
  businessId?: string | null;
  venueName?: string | null;
}

/** Latest clock-in / latest roster-period-created per org, folded into one map. */
async function lastActiveByOrg(orgIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (orgIds.length === 0) return out;
  const tsRows = await db
    .select({
      orgId: businesses.orgId,
      last: sql<Date | null>`max(${timesheetEntries.clockInAt})`,
    })
    .from(timesheetEntries)
    .innerJoin(businesses, eq(businesses.id, timesheetEntries.businessId))
    .where(inArray(businesses.orgId, orgIds))
    .groupBy(businesses.orgId);
  const rpRows = await db
    .select({
      orgId: businesses.orgId,
      last: sql<Date | null>`max(${rosterPeriods.createdAt})`,
    })
    .from(rosterPeriods)
    .innerJoin(businesses, eq(businesses.id, rosterPeriods.businessId))
    .where(inArray(businesses.orgId, orgIds))
    .groupBy(businesses.orgId);
  for (const r of [...tsRows, ...rpRows]) {
    if (!r.orgId || !r.last) continue;
    const d = new Date(r.last);
    const cur = out.get(r.orgId);
    if (!cur || d > cur) out.set(r.orgId, d);
  }
  return out;
}

export function createAdminRepo() {
  return {
    /** Every client (organisation), optionally filtered by status/name. */
    async listClients(filter?: {
      status?: PlanStatus;
      search?: string;
    }): Promise<AdminClientRow[]> {
      const conds = [];
      if (filter?.status)
        conds.push(eq(organisations.planStatus, filter.status));
      const search = filter?.search?.trim();
      if (search) conds.push(ilike(organisations.name, `%${search}%`));

      const orgs = await db
        .select({
          id: organisations.id,
          name: organisations.name,
          planStatus: organisations.planStatus,
          createdAt: organisations.createdAt,
        })
        .from(organisations)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(organisations.name);
      if (orgs.length === 0) return [];
      const orgIds = orgs.map((o) => o.id);

      const biz = await db
        .select({ id: businesses.id, orgId: businesses.orgId })
        .from(businesses)
        .where(inArray(businesses.orgId, orgIds));
      const bizIds = biz.map((b) => b.id);
      const bizToOrg = new Map(biz.map((b) => [b.id, b.orgId as string]));
      const siteCounts = new Map<string, number>();
      for (const b of biz) {
        const org = b.orgId as string;
        siteCounts.set(org, (siteCounts.get(org) ?? 0) + 1);
      }

      const staffRows = await db
        .select({ orgId: staffMembers.orgId, n: sql<number>`count(*)::int` })
        .from(staffMembers)
        .where(
          and(
            inArray(staffMembers.orgId, orgIds),
            eq(staffMembers.active, true),
          ),
        )
        .groupBy(staffMembers.orgId);
      const staffByOrg = new Map(
        staffRows.map((r) => [r.orgId as string, r.n]),
      );

      const xeroOrgIds = new Set<string>();
      const driveOrgIds = new Set<string>();
      if (bizIds.length) {
        const xeroRows = await db
          .select({ businessId: xeroConnections.businessId })
          .from(xeroConnections)
          .where(
            and(
              inArray(xeroConnections.businessId, bizIds),
              eq(xeroConnections.status, "active"),
            ),
          );
        for (const r of xeroRows) {
          const org = bizToOrg.get(r.businessId);
          if (org) xeroOrgIds.add(org);
        }
        const driveRows = await db
          .select({ businessId: googleDriveConnections.businessId })
          .from(googleDriveConnections)
          .where(inArray(googleDriveConnections.businessId, bizIds));
        for (const r of driveRows) {
          const org = bizToOrg.get(r.businessId);
          if (org) driveOrgIds.add(org);
        }
      }

      const lastByOrg = await lastActiveByOrg(orgIds);

      return orgs.map((o) => ({
        orgId: o.id,
        name: o.name,
        planStatus: o.planStatus as PlanStatus,
        siteCount: siteCounts.get(o.id) ?? 0,
        staffCount: staffByOrg.get(o.id) ?? 0,
        hasXero: xeroOrgIds.has(o.id),
        hasDrive: driveOrgIds.has(o.id),
        lastActiveAt: lastByOrg.get(o.id) ?? null,
        createdAt: o.createdAt,
      }));
    },

    /** KPI aggregates for the clients overview. */
    async getClientStats(): Promise<ClientStats> {
      const rows = await db
        .select({
          planStatus: organisations.planStatus,
          n: sql<number>`count(*)::int`,
        })
        .from(organisations)
        .groupBy(organisations.planStatus);
      const stats: ClientStats = {
        total: 0,
        active: 0,
        trial: 0,
        paused: 0,
        totalStaff: 0,
      };
      for (const r of rows) {
        stats.total += r.n;
        if (r.planStatus === "active") stats.active = r.n;
        else if (r.planStatus === "trial") stats.trial = r.n;
        else if (r.planStatus === "paused") stats.paused = r.n;
      }
      const [staff] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(staffMembers)
        .where(eq(staffMembers.active, true));
      stats.totalStaff = staff?.n ?? 0;
      return stats;
    },

    /** One client's account summary, or null if the org id is unknown. */
    async getClient(orgId: string): Promise<ClientDetail | null> {
      const [org] = await db
        .select({
          id: organisations.id,
          name: organisations.name,
          planStatus: organisations.planStatus,
          createdAt: organisations.createdAt,
        })
        .from(organisations)
        .where(eq(organisations.id, orgId))
        .limit(1);
      if (!org) return null;

      const locs = await db
        .select({ id: businesses.id, name: businesses.name })
        .from(businesses)
        .where(eq(businesses.orgId, orgId))
        .orderBy(businesses.createdAt);
      const bizIds = locs.map((l) => l.id);

      const xeroByBiz = new Map<string, { orgName: string; active: boolean }>();
      const driveByBiz = new Map<
        string,
        { email: string; needsReconnect: boolean }
      >();
      if (bizIds.length) {
        const xeroRows = await db
          .select({
            businessId: xeroConnections.businessId,
            orgName: xeroConnections.orgName,
            status: xeroConnections.status,
          })
          .from(xeroConnections)
          .where(inArray(xeroConnections.businessId, bizIds));
        for (const r of xeroRows)
          xeroByBiz.set(r.businessId, {
            orgName: r.orgName,
            active: r.status === "active",
          });
        const driveRows = await db
          .select({
            businessId: googleDriveConnections.businessId,
            email: googleDriveConnections.googleAccountEmail,
            needsReconnect: googleDriveConnections.needsReconnect,
          })
          .from(googleDriveConnections)
          .where(inArray(googleDriveConnections.businessId, bizIds));
        for (const r of driveRows)
          driveByBiz.set(r.businessId, {
            email: r.email,
            needsReconnect: r.needsReconnect,
          });
      }

      const [staff] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(staffMembers)
        .where(
          and(eq(staffMembers.orgId, orgId), eq(staffMembers.active, true)),
        );

      const lastByOrg = await lastActiveByOrg([orgId]);
      const recentActivity = await this.listActivity({ orgId, limit: 20 });

      return {
        orgId: org.id,
        name: org.name,
        planStatus: org.planStatus as PlanStatus,
        createdAt: org.createdAt,
        staffCount: staff?.n ?? 0,
        lastActiveAt: lastByOrg.get(orgId) ?? null,
        locations: locs.map((l) => {
          const x = xeroByBiz.get(l.id);
          const d = driveByBiz.get(l.id);
          return {
            id: l.id,
            name: l.name,
            hasXero: Boolean(x),
            xeroOrgName: x?.orgName ?? null,
            xeroActive: x?.active ?? false,
            hasDrive: Boolean(d),
            driveEmail: d?.email ?? null,
            driveNeedsReconnect: d?.needsReconnect ?? false,
          };
        }),
        recentActivity,
      };
    },

    /** The org's first location (used as the impersonation entry point). */
    async firstLocationOfOrg(
      orgId: string,
    ): Promise<{ id: string; name: string } | null> {
      const [row] = await db
        .select({ id: businesses.id, name: businesses.name })
        .from(businesses)
        .where(eq(businesses.orgId, orgId))
        .orderBy(businesses.createdAt)
        .limit(1);
      return row ?? null;
    },

    /** Recent admin activity, newest first. Filter by `orgId` for one client. */
    async listActivity(opts?: {
      limit?: number;
      offset?: number;
      orgId?: string;
    }): Promise<AdminActivityRow[]> {
      const limit = opts?.limit ?? 50;
      const offset = opts?.offset ?? 0;
      const rows = await db
        .select({
          id: adminActivities.id,
          adminName: adminActivities.adminName,
          action: adminActivities.action,
          detail: adminActivities.detail,
          isWrite: adminActivities.isWrite,
          orgId: adminActivities.orgId,
          businessId: adminActivities.businessId,
          venueName: adminActivities.venueName,
          createdAt: adminActivities.createdAt,
        })
        .from(adminActivities)
        .where(opts?.orgId ? eq(adminActivities.orgId, opts.orgId) : undefined)
        .orderBy(desc(adminActivities.createdAt), desc(adminActivities.id))
        .limit(limit)
        .offset(offset);
      return rows;
    },

    /** Total activity rows (for pagination). */
    async countActivity(orgId?: string): Promise<number> {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(adminActivities)
        .where(orgId ? eq(adminActivities.orgId, orgId) : undefined);
      return row?.n ?? 0;
    },

    /** Append one row to the audit log. Never throws on best-effort callers. */
    async recordActivity(input: RecordActivityInput): Promise<void> {
      await db.insert(adminActivities).values({
        adminUserId: input.adminUserId,
        adminName: input.adminName,
        action: input.action,
        detail: input.detail ?? null,
        isWrite: input.isWrite ?? false,
        orgId: input.orgId ?? null,
        businessId: input.businessId ?? null,
        venueName: input.venueName ?? null,
      });
    },
  };
}

export type AdminRepo = ReturnType<typeof createAdminRepo>;

/**
 * Whether a user id is a platform admin. Lives here (not in `context.ts`) so it
 * carries no Auth.js import — `requireOwner` and the impersonation session use
 * it to re-verify an impersonator on every request without pulling in NextAuth.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .limit(1);
  return Boolean(row);
}

/**
 * The display name for an admin (platform_admin.name → user.name → email →
 * "Admin"). Used to snapshot the actor onto an audit row when only the admin's
 * user id is available (e.g. from the impersonation cookie).
 */
export async function getAdminDisplayName(userId: string): Promise<string> {
  const [row] = await db
    .select({
      name: platformAdmins.name,
      userName: users.name,
      email: users.email,
    })
    .from(platformAdmins)
    .innerJoin(users, eq(users.id, platformAdmins.userId))
    .where(eq(platformAdmins.userId, userId))
    .limit(1);
  return row?.name ?? row?.userName ?? row?.email ?? "Admin";
}
