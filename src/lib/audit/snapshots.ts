import { sanitizeRecord } from "./events";

/**
 * BEFORE snapshots for the records whose history matters most (OPS-04): the
 * decorator reads the current row through the repo's own scoped getter just
 * before the write, keeping only the fields an owner would ask about, so an
 * event answers "from what, to what". Everything not listed here is logged
 * generically (method + sanitised arguments + a bounded view of the result).
 *
 * The readers are the repo's OWN tenant-scoped getters, so a snapshot can
 * never cross a tenant; a getter that returns null (unknown / foreign id)
 * simply yields no snapshot.
 */

export const ENTITY_FIELDS = {
  timesheet_entry: [
    "id",
    "staffMemberId",
    "clockInAt",
    "clockOutAt",
    "breakMinutes",
    "approved",
    "deletedAt",
  ],
  staff_member: [
    "id",
    "name",
    "email",
    "role",
    "active",
    "notifyByDefault",
    "payRateCents",
    "rateType",
    "rateLabel",
  ],
  business: [
    "id",
    "name",
    "timezone",
    "requireClockInPhoto",
    "photoRetentionDays",
    "geofenceRadiusM",
    "latitude",
    "longitude",
    "certReminderLeadDays",
    "staffShiftRemindersEnabled",
    "formDigestEnabled",
    "payRuleThresholdBasis",
    "allowCrossLocationCover",
    "notifyLeaveRequested",
    "notifyShiftOfferActivity",
    "notifyStockNeedsOrder",
    "notifyCertExpiring",
    "notifyAvailabilityReply",
    "notifyFormResponse",
  ],
  shift_offer: [
    "id",
    "shiftId",
    "offeredByStaffId",
    "claimedByStaffId",
    "status",
    "scope",
  ],
  supplier: [
    "id",
    "name",
    "contactName",
    "email",
    "phone",
    "deliveryDays",
    "orderCutoffDaysBefore",
  ],
  shift: ["id", "date", "label", "startTime", "endTime", "requiredStaff"],
  leave_request: [
    "id",
    "staffMemberId",
    "leaveType",
    "startDate",
    "endDate",
    "status",
    "note",
  ],
  staff_certification: [
    "id",
    "staffMemberId",
    "certType",
    "certLabel",
    "referenceNumber",
    "expiryDate",
  ],
  item: ["id", "name", "skuCode", "unit", "supplierId", "isActive"],
  pay_rule: [
    "id",
    "name",
    "priority",
    "isActive",
    "conditionType",
    "conditionConfig",
    "earningsRateId",
    "earningsRateName",
  ],
} as const;

export type AuditEntity = keyof typeof ENTITY_FIELDS;

/** A repo that exposes the scoped getters the snapshots use. */
export interface SnapshotReaders {
  getEntry?(id: string): Promise<unknown>;
  getStaff?(id: string): Promise<unknown>;
  getBusiness?(): Promise<unknown>;
  getOffer?(id: string): Promise<unknown>;
  getSupplier?(id: string): Promise<unknown>;
  getPublishedShift?(id: string): Promise<unknown>;
  getLeaveRequest?(id: string): Promise<unknown>;
  getCertification?(id: string): Promise<unknown>;
  getItem?(id: string): Promise<unknown>;
  getPayRule?(id: string): Promise<unknown>;
}

type Reader = (
  repo: SnapshotReaders,
  args: unknown[],
) => Promise<unknown> | undefined;

const byId =
  (getter: keyof SnapshotReaders): Reader =>
  (repo, args) => {
    const id = args[0];
    const fn = repo[getter] as ((id: string) => Promise<unknown>) | undefined;
    return typeof id === "string" && fn ? fn.call(repo, id) : undefined;
  };

/** Method → the entity it edits + how to read the row beforehand. */
export const METHOD_SNAPSHOTS: Record<
  string,
  { entity: AuditEntity; read: Reader }
> = {
  updateEntry: { entity: "timesheet_entry", read: byId("getEntry") },
  setEntryApproved: { entity: "timesheet_entry", read: byId("getEntry") },
  deleteEntry: { entity: "timesheet_entry", read: byId("getEntry") },
  restoreEntry: { entity: "timesheet_entry", read: () => undefined },
  clockOut: { entity: "timesheet_entry", read: byId("getEntry") },
  updateStaff: { entity: "staff_member", read: byId("getStaff") },
  setStaffPin: { entity: "staff_member", read: () => undefined },
  setStaffNoticesTokenHash: { entity: "staff_member", read: () => undefined },
  deleteStaff: { entity: "staff_member", read: byId("getStaff") },
  updateBusinessSettings: {
    entity: "business",
    read: (repo) => repo.getBusiness?.(),
  },
  updateNotificationPrefs: {
    entity: "business",
    read: (repo) => repo.getBusiness?.(),
  },
  approveOffer: { entity: "shift_offer", read: byId("getOffer") },
  denyOffer: { entity: "shift_offer", read: byId("getOffer") },
  withdrawOffer: { entity: "shift_offer", read: byId("getOffer") },
  updateSupplier: { entity: "supplier", read: byId("getSupplier") },
  deleteSupplier: { entity: "supplier", read: byId("getSupplier") },
  updateShiftRequiredStaff: {
    entity: "shift",
    read: byId("getPublishedShift"),
  },
  decideLeaveRequest: {
    entity: "leave_request",
    read: byId("getLeaveRequest"),
  },
  deleteLeaveRequest: {
    entity: "leave_request",
    read: byId("getLeaveRequest"),
  },
  updateCertification: {
    entity: "staff_certification",
    read: byId("getCertification"),
  },
  deleteCertification: {
    entity: "staff_certification",
    read: byId("getCertification"),
  },
  updateItem: { entity: "item", read: byId("getItem") },
  setItemActive: { entity: "item", read: byId("getItem") },
  deleteItem: { entity: "item", read: byId("getItem") },
  updatePayRule: { entity: "pay_rule", read: byId("getPayRule") },
  setPayRuleActive: { entity: "pay_rule", read: byId("getPayRule") },
  movePayRule: { entity: "pay_rule", read: byId("getPayRule") },
  deletePayRule: { entity: "pay_rule", read: byId("getPayRule") },
};

/** Keep only the allow-listed fields of a row (sanitised). */
export function pickEntityFields(
  entity: AuditEntity,
  row: unknown,
): Record<string, unknown> | null {
  if (!row || typeof row !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const f of ENTITY_FIELDS[entity]) {
    if (f in (row as Record<string, unknown>)) {
      out[f] = (row as Record<string, unknown>)[f];
    }
  }
  return sanitizeRecord(out) as Record<string, unknown>;
}

/**
 * The AFTER view of a result: an entity row narrowed to its fields, an
 * unknown object narrowed to its scalar fields, an array to a count.
 */
export function summarizeResult(
  entity: AuditEntity | null,
  result: unknown,
): unknown {
  if (result === null || result === undefined) return null;
  if (Array.isArray(result)) return { count: result.length };
  if (typeof result !== "object") return sanitizeRecord(result);
  if (entity) return pickEntityFields(entity, result);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
      out[k] = v;
    } else if (v instanceof Date) {
      out[k] = v;
    }
  }
  return sanitizeRecord(out);
}
