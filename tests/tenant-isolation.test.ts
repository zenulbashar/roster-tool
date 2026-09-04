import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  availabilityRequests,
  availabilityResponses,
  businesses,
  clockPhotos,
  formFields,
  formResponseAnswers,
  formResponses,
  forms,
  googleDriveConnections,
  items,
  leaveRequests,
  notifications,
  payRules,
  publishedRosters,
  rosterAssignments,
  rosterPeriods,
  shiftOffers,
  shiftTemplates,
  shifts,
  staffCertifications,
  staffDocuments,
  staffLocations,
  staffMembers,
  staffNotifications,
  stockCheckEntries,
  suppliers,
  timesheetEntries,
  users,
  xeroConnectInvites,
  xeroConnections,
  xeroEmployeeMaps,
  xeroTimesheetPushes,
} from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { createOrgRepo } from "@/lib/tenant/org-repository";
import {
  resolveActiveLocation,
  resolveOrgForUser,
} from "@/lib/tenant/org-access";
import { hashPin } from "@/lib/pin";
import { makeOrgWithTwoLocations, type TwoLocationOrg } from "./helpers/org";

/**
 * TENANT ISOLATION, ENFORCED BY CI (TEST-03).
 *
 * Two tenants, A and B, each a real organisation with two locations built the
 * way the app builds them. Tenant B gets a full object graph (staff, roster,
 * timesheets, leave, certs, stock, forms, Drive, Xero, pay rules). Then EVERY
 * mutating method on A's tenant repo is called with B's ids, and B's rows are
 * snapshotted before and after: they must be byte-identical. A method that
 * scopes correctly no-ops; a method that doesn't shows up here by name.
 *
 * The table below MUST name every mutating repo method (a completeness test
 * compares it against the repo's own method list), so adding an unscoped
 * method fails the suite by default rather than relying on review.
 *
 * Then the M29 org invariants: N1 (the org comes from `org_membership`, never
 * the legacy pointer), N2 (the active-location cookie is honoured only for a
 * location in the owner's org), N3 (cross-location writes verify BOTH the
 * person and the location belong to the acting org).
 */

// The active-location cookie is read through next/headers; stub it so N2 can
// present a forged value without an HTTP request.
let activeLocationCookie: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "roster_active_location" && activeLocationCookie
        ? { value: activeLocationCookie }
        : undefined,
    set: () => {},
  }),
}));

type TenantTable = PgTable & { businessId: PgColumn };
/** Every business-scoped table (the tenancy predicate's universe). */
const TENANT_TABLES: Array<[string, TenantTable]> = [
  ["staff_member", staffMembers],
  ["staff_location", staffLocations],
  ["shift_template", shiftTemplates],
  ["roster_period", rosterPeriods],
  ["shift", shifts],
  ["availability_request", availabilityRequests],
  ["availability_response", availabilityResponses],
  ["roster_assignment", rosterAssignments],
  ["published_roster", publishedRosters],
  ["timesheet_entry", timesheetEntries],
  ["clock_photo", clockPhotos],
  ["leave_request", leaveRequests],
  ["shift_offer", shiftOffers],
  ["staff_certification", staffCertifications],
  ["supplier", suppliers],
  ["item", items],
  ["stock_check_entry", stockCheckEntries],
  ["notification", notifications],
  ["staff_notification", staffNotifications],
  ["form", forms],
  ["form_field", formFields],
  ["form_response", formResponses],
  ["form_response_answer", formResponseAnswers],
  ["google_drive_connection", googleDriveConnections],
  ["staff_document", staffDocuments],
  ["xero_connection", xeroConnections],
  ["xero_employee_map", xeroEmployeeMaps],
  ["xero_timesheet_push", xeroTimesheetPushes],
  ["xero_connect_invite", xeroConnectInvites],
  ["pay_rule", payRules],
];

/** Every row of every tenant table for one business, as a stable string. */
async function snapshot(businessId: string): Promise<string> {
  const parts: string[] = [];
  const [biz] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId));
  parts.push(`business:${JSON.stringify(biz)}`);
  for (const [name, table] of TENANT_TABLES) {
    const rows = await db
      .select()
      .from(table)
      .where(eq(table.businessId, businessId));
    parts.push(
      `${name}:\n${rows
        .map((r) => JSON.stringify(r))
        .sort()
        .join("\n")}`,
    );
  }
  return parts.join("\n");
}

/** "Nothing happened": null/undefined/false/0/[]/{ ok: false }. */
function isRefusal(v: unknown): boolean {
  if (v == null || v === false || v === 0) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object" && "ok" in (v as object)) {
    return (v as { ok: unknown }).ok === false;
  }
  return false;
}

/** Tenant B's object graph — filled in beforeAll, read by the calls below. */
const f = {
  staffId: "",
  staff2Id: "",
  templateId: "",
  periodId: "",
  shift1: "",
  shift2: "",
  requestId: "",
  offerId: "",
  entryId: "",
  openEntryId: "",
  leaveId: "",
  certId: "",
  supplierId: "",
  itemId: "",
  notificationId: "",
  staffNoteId: "",
  formId: "",
  docId: "",
  inviteId: "",
  pushId: "",
  ruleId: "",
};
const FUTURE = new Date("2030-01-01T00:00:00Z");

type Call = {
  name: keyof TenantRepo;
  /**
   * `refuses`: the method must also RETURN a refusal (null/false/[]/{ok:false})
   * or throw. `ownRowOnly`: a creator that trusts its caller to pass owned
   * parent ids (the calling action validates them through a scoped getter);
   * it may insert a row under A, but must never touch B.
   */
  expect: "refuses" | "ownRowOnly";
  run: (repo: TenantRepo) => Promise<unknown>;
};

/** Every mutating method, called by tenant A's repo with tenant B's ids. */
const CALLS: Call[] = [
  // Staff
  {
    name: "updateStaff",
    expect: "refuses",
    run: (r) => r.updateStaff(f.staffId, { name: "Hacked" }),
  },
  {
    name: "setStaffPin",
    expect: "refuses",
    run: (r) => r.setStaffPin(f.staffId, hashPin("9182")),
  },
  {
    name: "setStaffNoticesTokenHash",
    expect: "refuses",
    run: (r) => r.setStaffNoticesTokenHash(f.staffId, "foreign-notices-hash"),
  },
  {
    name: "updateStaffLockout",
    expect: "refuses",
    run: (r) =>
      r.updateStaffLockout(f.staffId, {
        failedPinAttempts: 5,
        pinLockedUntil: FUTURE,
      }),
  },
  {
    name: "deleteStaff",
    expect: "refuses",
    run: (r) => r.deleteStaff(f.staffId),
  },
  // Shift types
  {
    name: "updateTemplate",
    expect: "refuses",
    run: (r) => r.updateTemplate(f.templateId, { label: "Hacked" }),
  },
  {
    name: "deleteTemplate",
    expect: "refuses",
    run: (r) => r.deleteTemplate(f.templateId),
  },
  // Roster periods + shifts
  {
    name: "updatePeriod",
    expect: "refuses",
    run: (r) => r.updatePeriod(f.periodId, { label: "Hacked" }),
  },
  {
    name: "createShifts",
    expect: "refuses",
    run: (r) =>
      r.createShifts([
        {
          rosterPeriodId: f.periodId,
          date: "2026-06-10",
          label: "Foreign",
          startTime: "08:00",
          endTime: "16:00",
        },
      ]),
  },
  {
    name: "updateShiftRequiredStaff",
    expect: "refuses",
    run: (r) => r.updateShiftRequiredStaff(f.shift1, 4),
  },
  {
    name: "deleteShiftsForPeriod",
    expect: "refuses",
    run: (r) => r.deleteShiftsForPeriod(f.periodId),
  },
  // Availability
  {
    name: "createRequest",
    expect: "refuses",
    run: (r) =>
      r.createRequest({
        rosterPeriodId: f.periodId,
        staffMemberId: f.staffId,
        tokenHash: "foreign-request-hash",
        expiresAt: FUTURE,
      }),
  },
  {
    name: "markRequestSent",
    expect: "refuses",
    run: (r) => r.markRequestSent(f.requestId),
  },
  {
    name: "markReminderSent",
    expect: "refuses",
    run: (r) => r.markReminderSent(f.requestId),
  },
  {
    name: "markRequestResponded",
    expect: "refuses",
    run: (r) => r.markRequestResponded(f.requestId),
  },
  {
    name: "markAvailableManually",
    expect: "refuses",
    run: (r) => r.markAvailableManually(f.staffId, f.periodId),
  },
  {
    name: "saveResponses",
    expect: "refuses",
    run: (r) =>
      r.saveResponses(f.requestId, [{ shiftId: f.shift1, available: false }]),
  },
  // Assignments
  {
    name: "assign",
    expect: "refuses",
    run: (r) => r.assign(f.shift2, f.staffId),
  },
  {
    name: "unassign",
    expect: "refuses",
    run: (r) => r.unassign(f.shift1, f.staffId),
  },
  {
    name: "moveAssignment",
    expect: "refuses",
    run: (r) =>
      r.moveAssignment({
        fromShiftId: f.shift1,
        staffMemberId: f.staffId,
        toShiftId: f.shift2,
      }),
  },
  {
    name: "setAssignmentSchedule",
    expect: "refuses",
    run: (r) =>
      r.setAssignmentSchedule(f.shift1, f.staffId, {
        startTime: "09:00",
        endTime: "15:00",
        breakMinutes: 0,
        breakStart: null,
      }),
  },
  {
    name: "createSuggestedAssignments",
    expect: "refuses",
    run: (r) =>
      r.createSuggestedAssignments([
        { shiftId: f.shift2, staffMemberId: f.staff2Id },
      ]),
  },
  {
    name: "acceptSuggestion",
    expect: "refuses",
    run: (r) => r.acceptSuggestion(f.shift2, f.staffId),
  },
  {
    name: "acceptAllSuggestions",
    expect: "refuses",
    run: (r) => r.acceptAllSuggestions(f.periodId),
  },
  {
    name: "clearSuggestion",
    expect: "refuses",
    run: (r) => r.clearSuggestion(f.shift2, f.staffId),
  },
  {
    name: "publish",
    expect: "refuses",
    run: (r) => r.publish(f.periodId, "foreign-slug"),
  },
  // Timesheets
  {
    name: "clockIn",
    expect: "refuses",
    run: (r) => r.clockIn(f.staffId, { at: new Date("2026-06-11T00:00:00Z") }),
  },
  {
    name: "clockOut",
    expect: "refuses",
    run: (r) => r.clockOut(f.openEntryId),
  },
  {
    name: "addClockPhoto",
    expect: "refuses",
    run: (r) =>
      r.addClockPhoto({
        timesheetEntryId: f.entryId,
        kind: "out",
        mimeType: "image/jpeg",
        imageData: Buffer.from("x"),
      }),
  },
  {
    name: "updateEntry",
    expect: "refuses",
    run: (r) =>
      r.updateEntry(f.entryId, {
        clockInAt: new Date("2026-06-08T00:00:00Z"),
        clockOutAt: null,
      }),
  },
  {
    name: "setEntryApproved",
    expect: "refuses",
    run: (r) => r.setEntryApproved(f.entryId, true),
  },
  {
    name: "deleteEntry",
    expect: "refuses",
    run: (r) => r.deleteEntry(f.entryId),
  },
  {
    name: "restoreEntry",
    expect: "refuses",
    run: (r) => r.restoreEntry(f.entryId),
  },
  // Leave
  {
    name: "createLeaveRequest",
    expect: "refuses",
    run: (r) =>
      r.createLeaveRequest({
        staffMemberId: f.staffId,
        leaveType: "annual",
        startDate: "2026-08-01",
        endDate: "2026-08-02",
      }),
  },
  {
    name: "decideLeaveRequest",
    expect: "refuses",
    run: (r) => r.decideLeaveRequest(f.leaveId, "denied"),
  },
  {
    name: "markLeaveDecisionNotified",
    expect: "refuses",
    run: (r) => r.markLeaveDecisionNotified(f.leaveId),
  },
  {
    name: "deleteLeaveRequest",
    expect: "refuses",
    run: (r) => r.deleteLeaveRequest(f.leaveId),
  },
  // Certifications
  {
    name: "addCertification",
    expect: "refuses",
    run: (r) =>
      r.addCertification({
        staffMemberId: f.staffId,
        certType: "rsa",
        expiryDate: "2027-01-01",
      }),
  },
  {
    name: "updateCertification",
    expect: "refuses",
    run: (r) =>
      r.updateCertification(f.certId, {
        certType: "rsa",
        expiryDate: "2028-01-01",
      }),
  },
  {
    name: "deleteCertification",
    expect: "refuses",
    run: (r) => r.deleteCertification(f.certId),
  },
  {
    name: "updateCertReminderStage",
    expect: "refuses",
    run: (r) => r.updateCertReminderStage(f.certId, "early"),
  },
  // Shift offers
  {
    name: "releaseOwnShift",
    expect: "refuses",
    run: (r) => r.releaseOwnShift(f.staffId, f.shift1),
  },
  {
    name: "postOpenShift",
    expect: "refuses",
    run: (r) => r.postOpenShift(f.shift2),
  },
  {
    name: "claimOffer",
    expect: "refuses",
    run: (r) => r.claimOffer(f.offerId, f.staff2Id),
  },
  {
    name: "approveOffer",
    expect: "refuses",
    run: (r) => r.approveOffer(f.offerId),
  },
  { name: "denyOffer", expect: "refuses", run: (r) => r.denyOffer(f.offerId) },
  {
    name: "withdrawOffer",
    expect: "refuses",
    run: (r) => r.withdrawOffer(f.offerId),
  },
  {
    name: "markOfferDecisionNotified",
    expect: "refuses",
    run: (r) => r.markOfferDecisionNotified(f.offerId),
  },
  // Suppliers + items + stock
  {
    name: "updateSupplier",
    expect: "refuses",
    run: (r) =>
      r.updateSupplier(f.supplierId, {
        name: "Hacked",
        deliveryDays: [1],
        orderCutoffDaysBefore: 1,
      }),
  },
  {
    name: "deleteSupplier",
    expect: "refuses",
    run: (r) => r.deleteSupplier(f.supplierId),
  },
  {
    name: "markSupplierOrderReminded",
    expect: "refuses",
    run: (r) => r.markSupplierOrderReminded(f.supplierId, "2026-06-15"),
  },
  {
    name: "addItem",
    expect: "ownRowOnly",
    run: (r) =>
      r.addItem({ name: "Foreign-supplier item", supplierId: f.supplierId }),
  },
  {
    name: "updateItem",
    expect: "refuses",
    run: (r) => r.updateItem(f.itemId, { name: "Hacked" }),
  },
  {
    name: "setItemActive",
    expect: "refuses",
    run: (r) => r.setItemActive(f.itemId, false),
  },
  { name: "deleteItem", expect: "refuses", run: (r) => r.deleteItem(f.itemId) },
  {
    name: "bulkInsertItems",
    expect: "ownRowOnly",
    run: (r) =>
      r.bulkInsertItems([
        {
          name: "Bulk foreign",
          skuCode: null,
          unit: null,
          supplierId: f.supplierId,
        },
      ]),
  },
  {
    name: "recordStockCheck",
    expect: "refuses",
    run: (r) =>
      r.recordStockCheck([{ itemId: f.itemId, status: "needs_order" }], {
        checkedByStaffId: f.staffId,
      }),
  },
  // Owner + staff notifications
  {
    name: "upsertFormResponseNotification",
    expect: "refuses",
    run: (r) =>
      r.upsertFormResponseNotification({
        formId: f.formId,
        formTitle: "Foreign form",
      }),
  },
  {
    name: "markNotificationRead",
    expect: "refuses",
    run: (r) => r.markNotificationRead(f.notificationId),
  },
  {
    name: "createStaffNotification",
    expect: "refuses",
    run: (r) =>
      r.createStaffNotification({
        staffMemberId: f.staffId,
        type: "rostered",
        title: "Foreign notice",
      }),
  },
  {
    name: "markStaffNotificationRead",
    expect: "refuses",
    run: (r) => r.markStaffNotificationRead(f.staffNoteId, f.staffId),
  },
  {
    name: "markAllStaffNotificationsRead",
    expect: "refuses",
    run: (r) => r.markAllStaffNotificationsRead(f.staffId),
  },
  // Forms
  {
    name: "deleteForm",
    expect: "refuses",
    run: (r) => r.deleteForm(f.formId, { confirmed: true }),
  },
  {
    name: "saveForm",
    expect: "refuses",
    run: (r) => r.saveForm(f.formId, { title: "Hacked", fields: [] }),
  },
  {
    name: "publishForm",
    expect: "refuses",
    run: (r) => r.publishForm(f.formId),
  },
  { name: "closeForm", expect: "refuses", run: (r) => r.closeForm(f.formId) },
  {
    name: "setFormInternalEnabled",
    expect: "refuses",
    run: (r) => r.setFormInternalEnabled(f.formId, false),
  },
  {
    name: "setFormAllowAnonymous",
    expect: "refuses",
    run: (r) => r.setFormAllowAnonymous(f.formId, true),
  },
  {
    name: "createInternalResponse",
    expect: "refuses",
    run: (r) =>
      r.createInternalResponse(f.formId, {
        respondentStaffId: f.staffId,
        source: "internal",
        answers: [],
      }),
  },
  {
    name: "createPublicResponse",
    expect: "refuses",
    run: (r) =>
      r.createPublicResponse(f.formId, {
        channel: "public",
        source: "link",
        answers: [],
      }),
  },
  // Drive documents
  {
    name: "addStaffDocument",
    expect: "refuses",
    run: (r) =>
      r.addStaffDocument({
        staffMemberId: f.staffId,
        fileName: "foreign.pdf",
        docType: null,
        driveFileId: "foreign-file",
        driveWebLink: "https://example.test/f",
        mimeType: "application/pdf",
      }),
  },
  {
    name: "deleteStaffDocument",
    expect: "refuses",
    run: (r) => r.deleteStaffDocument(f.docId),
  },
  // Xero
  {
    name: "revokeXeroConnectInvite",
    expect: "refuses",
    run: (r) => r.revokeXeroConnectInvite(f.inviteId),
  },
  {
    name: "upsertXeroEmployeeMap",
    expect: "refuses",
    run: (r) =>
      r.upsertXeroEmployeeMap({
        staffMemberId: f.staffId,
        xeroEmployeeId: "foreign-emp",
        xeroEmployeeName: "Foreign",
        earningsRateId: null,
        payrollCalendarId: null,
      }),
  },
  {
    name: "deleteXeroEmployeeMap",
    expect: "refuses",
    run: (r) => r.deleteXeroEmployeeMap(f.staffId),
  },
  {
    name: "saveXeroPushDraft",
    expect: "refuses",
    run: (r) =>
      r.saveXeroPushDraft({
        staffMemberId: f.staffId,
        xeroEmployeeId: "foreign-emp",
        periodStart: "2026-06-08",
        periodEnd: "2026-06-14",
        xeroTimesheetId: "foreign-ts",
        hoursTotal: 1,
        payloadHash: "h",
        idempotencyKey: "foreign-key-1",
        attempt: 1,
      }),
  },
  {
    name: "markXeroPushNoDraft",
    expect: "refuses",
    run: (r) =>
      r.markXeroPushNoDraft({
        staffMemberId: f.staffId,
        xeroEmployeeId: "foreign-emp",
        periodStart: "2026-06-08",
        periodEnd: "2026-06-14",
        hoursTotal: 1,
        payloadHash: "h",
        idempotencyKey: "foreign-key-2",
        attempt: 2,
      }),
  },
  {
    name: "markXeroPushCancelled",
    expect: "refuses",
    run: (r) => r.markXeroPushCancelled(f.pushId),
  },
  // Pay rules
  {
    name: "updatePayRule",
    expect: "refuses",
    run: (r) =>
      r.updatePayRule(f.ruleId, {
        name: "Hacked",
        conditionType: "day_of_week",
        conditionConfig: { days: [7] },
        earningsRateId: "rate-x",
        earningsRateName: "X",
        isActive: true,
      }),
  },
  {
    name: "setPayRuleActive",
    expect: "refuses",
    run: (r) => r.setPayRuleActive(f.ruleId, false),
  },
  {
    name: "movePayRule",
    expect: "refuses",
    run: (r) => r.movePayRule(f.ruleId, "up"),
  },
  {
    name: "deletePayRule",
    expect: "refuses",
    run: (r) => r.deletePayRule(f.ruleId),
  },
];

/**
 * Mutators with NO foreign id to pass — they create or edit rows keyed only on
 * the repo's OWN business_id, so isolation is structural (the id is baked in
 * at `createTenantRepo`). Listed so the completeness check still accounts for
 * every method.
 */
const OWN_BUSINESS_ONLY: Record<keyof TenantRepo & string, string> = {
  addStaff: "inserts with the repo's business_id",
  addTemplate: "inserts with the repo's business_id",
  createPeriod: "inserts with the repo's business_id",
  updateBusinessSettings: "updates the repo's own business row",
  deleteExpiredPhotos: "sweeps only the repo's own photos",
  addSupplier: "inserts with the repo's business_id",
  createNotification: "inserts with the repo's business_id",
  markAllNotificationsRead: "updates only the repo's own notifications",
  updateNotificationPrefs: "updates the repo's own business row",
  createForm: "inserts with the repo's business_id",
  upsertDriveConnection: "keyed on the repo's business_id (unique)",
  updateDriveAccessToken: "keyed on the repo's business_id",
  markDriveNeedsReconnect: "keyed on the repo's business_id",
  setDriveRootFolder: "keyed on the repo's business_id",
  deleteDriveConnection: "keyed on the repo's business_id",
  upsertXeroConnection: "keyed on the repo's business_id (unique)",
  confirmXeroConnection: "keyed on the repo's business_id",
  updateXeroTokens: "keyed on the repo's business_id",
  markXeroNeedsReconnect: "keyed on the repo's business_id",
  deleteXeroConnection: "keyed on the repo's business_id",
  createXeroConnectInvite: "inserts with the repo's business_id",
  createPayRule: "inserts with the repo's business_id",
} as Record<keyof TenantRepo & string, string>;

/** Methods that only read (any of these prefixes). Everything else mutates. */
const READ_ONLY =
  /^(list|get|count|find|has|responses|rosterRows|assignmentsWithShiftType|itemsWithCurrentStatus|confirmedShiftsForStaffOnDate|resolveOwnedSupplierId)/;

describe("tenant isolation", () => {
  let tenantA: TwoLocationOrg;
  let tenantB: TwoLocationOrg;
  let A = "";
  let B = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;
  let baseline = "";

  beforeAll(async () => {
    tenantA = await makeOrgWithTwoLocations({ prefix: "iso-a" });
    tenantB = await makeOrgWithTwoLocations({ prefix: "iso-b" });
    A = tenantA.bizA;
    B = tenantB.bizA;
    repoA = createTenantRepo(A);
    repoB = createTenantRepo(B);
    // This tenant has an owner AND a form response, which would make it
    // digest-eligible in another file's global sweep; keep it out of theirs.
    await repoB.updateBusinessSettings({ formDigestEnabled: false });

    // ---- Tenant B's object graph -------------------------------------
    const staff = await repoB.addStaff({
      name: "Bea",
      email: "bea@iso-b.test",
    });
    const staff2 = await repoB.addStaff({ name: "Bo", email: "bo@iso-b.test" });
    await repoB.setStaffPin(staff.id, hashPin("4821"));
    f.staffId = staff.id;
    f.staff2Id = staff2.id;

    const template = await repoB.addTemplate({
      label: "Morning",
      startTime: "08:00",
      endTime: "16:00",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    });
    f.templateId = template.id;
    const period = await repoB.createPeriod({
      label: "Week",
      startDate: "2026-06-08",
      endDate: "2026-06-14",
    });
    f.periodId = period.id;
    const created = await repoB.createShifts([
      {
        rosterPeriodId: period.id,
        templateId: template.id,
        date: "2026-06-08",
        label: "Morning",
        startTime: "08:00",
        endTime: "16:00",
      },
      {
        rosterPeriodId: period.id,
        templateId: template.id,
        date: "2026-06-09",
        label: "Morning",
        startTime: "08:00",
        endTime: "16:00",
      },
    ]);
    f.shift1 = created[0]!.id;
    f.shift2 = created[1]!.id;

    const request = (await repoB.createRequest({
      rosterPeriodId: period.id,
      staffMemberId: staff.id,
      tokenHash: "iso-b-request-hash",
      expiresAt: FUTURE,
    }))!;
    f.requestId = request.id;
    await repoB.saveResponses(request.id, [
      { shiftId: f.shift1, available: true },
    ]);
    await repoB.assign(f.shift1, staff.id);
    await repoB.createSuggestedAssignments([
      { shiftId: f.shift2, staffMemberId: staff.id },
    ]);
    await repoB.updatePeriod(period.id, { status: "published" });
    await repoB.publish(period.id, "iso-b-public-slug");
    const released = await repoB.releaseOwnShift(staff.id, f.shift1);
    if (!released.ok) throw new Error("fixture: release failed");
    f.offerId = released.offer.id;
    await repoB.claimOffer(f.offerId, staff2.id);

    const entry = await repoB.clockIn(staff.id, {
      at: new Date("2026-06-08T00:00:00Z"),
    });
    await repoB.clockOut(entry.id, new Date("2026-06-08T08:00:00Z"));
    await repoB.addClockPhoto({
      timesheetEntryId: entry.id,
      kind: "in",
      mimeType: "image/jpeg",
      imageData: Buffer.from("iso-b"),
    });
    f.entryId = entry.id;
    const open = await repoB.clockIn(staff2.id, {
      at: new Date("2026-06-09T00:00:00Z"),
    });
    f.openEntryId = open.id;

    const leave = await repoB.createLeaveRequest({
      staffMemberId: staff.id,
      leaveType: "annual",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
    });
    f.leaveId = leave!.id;
    const cert = await repoB.addCertification({
      staffMemberId: staff.id,
      certType: "rsa",
      expiryDate: "2027-01-01",
    });
    f.certId = cert!.id;

    const supplier = await repoB.addSupplier({
      name: "Bean Bros",
      deliveryDays: [1],
      orderCutoffDaysBefore: 1,
    });
    f.supplierId = supplier.id;
    const item = await repoB.addItem({ name: "Milk", supplierId: supplier.id });
    f.itemId = item.id;
    await repoB.recordStockCheck([{ itemId: item.id, status: "low" }], {
      checkedByStaffId: staff.id,
    });

    const note = await repoB.createNotification({
      type: "leave_requested",
      title: "Leave requested",
    });
    f.notificationId = note.id;
    const sNote = await repoB.createStaffNotification({
      staffMemberId: staff.id,
      type: "rostered",
      title: "You're rostered",
    });
    f.staffNoteId = sNote!.id;

    const form = await repoB.createForm({ title: "Feedback" });
    f.formId = form.id;
    await repoB.saveForm(form.id, {
      title: "Feedback",
      fields: [
        { label: "Comment", type: "short_text", required: false, options: [] },
      ],
    });
    await repoB.publishForm(form.id);
    await repoB.setFormInternalEnabled(form.id, true);
    const fw = await repoB.getFormWithFields(form.id);
    await repoB.createPublicResponse(form.id, {
      channel: "public",
      source: "link",
      answers: [
        {
          fieldId: fw!.fields[0]!.id,
          fieldLabel: "Comment",
          fieldType: "short_text",
          valueText: "Lovely coffee",
          valueNumber: null,
        },
      ],
    });

    await repoB.upsertDriveConnection({
      googleAccountEmail: "drive@iso-b.test",
      accessTokenEnc: "enc",
      refreshTokenEnc: "enc",
      tokenExpiry: FUTURE,
      rootFolderId: "root",
    });
    const doc = await repoB.addStaffDocument({
      staffMemberId: staff.id,
      fileName: "contract.pdf",
      docType: "Contract",
      driveFileId: "iso-b-file",
      driveWebLink: "https://example.test/doc",
      mimeType: "application/pdf",
    });
    f.docId = doc!.id;

    await repoB.upsertXeroConnection({
      xeroTenantId: "iso-b-tenant",
      orgName: "B Pty Ltd",
      connectedAccountEmail: "xero@iso-b.test",
      accessTokenEnc: "enc",
      refreshTokenEnc: "enc",
      tokenExpiry: FUTURE,
      authorisedScopes: null,
      connectedViaInviteId: null,
      connectedIp: null,
      connectedUserAgent: null,
    });
    const invite = await repoB.createXeroConnectInvite({
      tokenHash: "iso-b-invite-hash",
      sentToEmail: "books@iso-b.test",
      createdByUserId: tenantB.ownerUserId,
      expiresAt: FUTURE,
    });
    f.inviteId = invite.id;
    await repoB.upsertXeroEmployeeMap({
      staffMemberId: staff.id,
      xeroEmployeeId: "emp-b",
      xeroEmployeeName: "Bea",
      earningsRateId: "rate-b",
      payrollCalendarId: "cal-b",
    });
    const push = (await repoB.saveXeroPushDraft({
      staffMemberId: staff.id,
      xeroEmployeeId: "emp-b",
      periodStart: "2026-06-08",
      periodEnd: "2026-06-14",
      xeroTimesheetId: "ts-b",
      hoursTotal: 8,
      payloadHash: "hash-b",
      idempotencyKey: "key-b",
      attempt: 1,
    }))!;
    f.pushId = push.id;

    const rule = await repoB.createPayRule({
      name: "Saturday",
      conditionType: "day_of_week",
      conditionConfig: { days: [6] },
      earningsRateId: "rate-sat",
      earningsRateName: "Saturday rate",
      isActive: true,
    });
    f.ruleId = rule.id;

    baseline = await snapshot(B);
    expect(baseline.length).toBeGreaterThan(2000); // the graph really exists
  });

  afterAll(async () => {
    await tenantB.cleanup();
    await tenantA.cleanup();
    await db.$client.end();
  });

  it("names every mutating repo method exactly once (a new unscoped method fails here)", () => {
    const all = Object.keys(repoA).filter(
      (k) =>
        typeof (repoA as unknown as Record<string, unknown>)[k] === "function",
    );
    const mutating = all.filter((k) => !READ_ONLY.test(k));
    const covered = new Set<string>([
      ...CALLS.map((c) => c.name as string),
      ...Object.keys(OWN_BUSINESS_ONLY),
    ]);
    // Every mutating method must be in the foreign-id table or explicitly
    // excused as own-business-only. Add it to CALLS with a foreign id.
    expect(mutating.filter((m) => !covered.has(m))).toEqual([]);
    // And the table must not name methods that no longer exist.
    expect([...covered].filter((c) => !all.includes(c))).toEqual([]);
    // No method is listed in both places.
    const both = CALLS.map((c) => c.name as string).filter(
      (n) => n in OWN_BUSINESS_ONLY,
    );
    expect(both).toEqual([]);
  });

  it("the baseline reflects a full graph under tenant B", () => {
    for (const [name] of TENANT_TABLES) {
      expect(baseline, name).toContain(`${name}:\n{`);
    }
  });

  for (const call of CALLS) {
    it(`${call.name} cannot touch tenant B with B's ids`, async () => {
      // A fresh snapshot per call so a leak is attributed to exactly one
      // method (and never masks the ones after it).
      const before = await snapshot(B);
      let result: unknown;
      let threw: unknown = null;
      try {
        result = await call.run(repoA);
      } catch (err) {
        threw = err;
      }
      const after = await snapshot(B);
      expect(after === before, `${call.name} MUTATED tenant B`).toBe(true);
      if (call.expect === "refuses") {
        expect(
          threw !== null || isRefusal(result),
          `${call.name} returned ${JSON.stringify(result)} for a foreign id`,
        ).toBe(true);
      }
    });
  }

  it("reads by id stay blind across tenants (spot checks)", async () => {
    expect(await repoA.getStaff(f.staffId)).toBeNull();
    expect(await repoA.getPeriod(f.periodId)).toBeNull();
    expect(await repoA.getShift(f.shift1)).toBeNull();
    expect(await repoA.getEntry(f.entryId)).toBeNull();
    expect(await repoA.getLeaveRequest(f.leaveId)).toBeNull();
    expect(await repoA.getCertification(f.certId)).toBeNull();
    expect(await repoA.getOffer(f.offerId)).toBeNull();
    expect(await repoA.getSupplier(f.supplierId)).toBeNull();
    expect(await repoA.getItem(f.itemId)).toBeNull();
    expect(await repoA.getFormWithFields(f.formId)).toBeNull();
    expect(await repoA.getStaffDocument(f.docId)).toBeNull();
    expect(await repoA.getPayRule(f.ruleId)).toBeNull();
    expect(await repoA.getXeroPushById(f.pushId)).toBeNull();
    expect(await repoA.listStaff()).toEqual([]);
  });

  describe("org invariants (M29)", () => {
    it("N1: the org comes from org_membership — the legacy users.business_id pointer grants nothing", async () => {
      expect(await resolveOrgForUser(tenantA.ownerUserId)).toBe(tenantA.orgId);
      const [legacy] = await db
        .insert(users)
        .values({ email: "legacy-pointer@iso.test", businessId: A })
        .returning();
      try {
        expect(await resolveOrgForUser(legacy!.id)).toBeNull();
      } finally {
        await db.delete(users).where(eq(users.id, legacy!.id));
      }
    });

    it("N2: the active-location cookie is honoured only for a location in the owner's org", async () => {
      // A forged cookie naming ANOTHER org's location falls back to home.
      activeLocationCookie = tenantB.bizA;
      expect(await resolveActiveLocation(tenantA.orgId, tenantA.bizA)).toBe(
        tenantA.bizA,
      );
      // Garbage falls back to home too.
      activeLocationCookie = "not-a-location";
      expect(await resolveActiveLocation(tenantA.orgId, tenantA.bizA)).toBe(
        tenantA.bizA,
      );
      // A genuine switch within the org is honoured.
      activeLocationCookie = tenantA.bizB;
      expect(await resolveActiveLocation(tenantA.orgId, tenantA.bizA)).toBe(
        tenantA.bizB,
      );
      // No cookie, no home: the org's first location — never another org's.
      activeLocationCookie = undefined;
      const fallback = await resolveActiveLocation(tenantA.orgId, null);
      expect([tenantA.bizA, tenantA.bizB]).toContain(fallback);
      expect(fallback).not.toBe(tenantB.bizA);
    });

    it("N3: cross-location writes verify BOTH the person and the location belong to the acting org", async () => {
      const orgA = createOrgRepo(tenantA.orgId);
      const orgB = createOrgRepo(tenantB.orgId);
      const personA = await repoA.addStaff({
        name: "Al",
        email: "al@iso-a.test",
      });
      const before = await snapshot(B);

      // A location in another org is never "mine".
      expect(await orgA.locationBelongsToOrg(tenantB.bizA)).toBe(false);
      expect(await orgA.locationBelongsToOrg(tenantA.bizB)).toBe(true);
      // Another org's person is invisible.
      expect(await orgA.getPersonInOrg(f.staffId)).toBeNull();

      // Placing: foreign person → refused; foreign location → refused.
      expect((await orgA.addPersonToLocation(f.staffId, tenantA.bizB)).ok).toBe(
        false,
      );
      expect(
        (await orgA.addPersonToLocation(personA.id, tenantB.bizB)).ok,
      ).toBe(false);
      expect(
        (await orgA.removePersonFromLocation(f.staffId, tenantB.bizB)).ok,
      ).toBe(false);
      // ...and a genuine placement within the org works.
      expect(
        (await orgA.addPersonToLocation(personA.id, tenantA.bizB)).ok,
      ).toBe(true);

      // Lending: to another org's location, or of another org's person → refused.
      expect(
        (
          await orgA.createLoan({
            staffMemberId: personA.id,
            toBusinessId: tenantB.bizB,
            startDate: "2026-07-01",
            endDate: "2026-07-07",
          })
        ).ok,
      ).toBe(false);
      expect(
        (
          await orgA.createLoan({
            staffMemberId: f.staffId,
            toBusinessId: tenantA.bizB,
            startDate: "2026-07-01",
            endDate: "2026-07-07",
          })
        ).ok,
      ).toBe(false);
      // Ending another org's loan → refused.
      const lent = await orgB.createLoan({
        staffMemberId: f.staffId,
        toBusinessId: tenantB.bizB,
        startDate: "2026-07-01",
        endDate: "2026-07-07",
      });
      expect(lent.ok).toBe(true);
      const loanB = (await orgB.listLoans()).find(
        (l) => l.staffMemberId === f.staffId,
      );
      expect(loanB).toBeDefined();
      expect((await orgA.endLoan(loanB!.id)).ok).toBe(false);

      // Claiming another org's offer through the org repo → refused.
      const claim = await orgA.claimOrgOffer(f.offerId, personA.id);
      expect(isRefusal(claim)).toBe(true);

      // Through all of that, tenant B's location rows never changed.
      expect((await snapshot(B)) === before).toBe(true);
    });
  });
});
