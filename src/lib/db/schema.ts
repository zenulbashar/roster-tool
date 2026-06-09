import type { AdapterAccountType } from "next-auth/adapters";
import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  customType,
  text,
  uuid,
  timestamp,
  date,
  time,
  boolean,
  integer,
  doublePrecision,
  primaryKey,
  unique,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Raw binary column (Postgres `bytea`) carried as a Node `Buffer`. Used for the
 * small clock-in/out photos so we don't need external object storage in the
 * MVP. Keep payloads small (validated + capped at the call site).
 */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

/* -------------------------------------------------------------------------- */
/* Tenancy root                                                               */
/* -------------------------------------------------------------------------- */

export const businesses = pgTable("business", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Australia/Sydney"),
  // When on, the kiosk captures a still photo on each clock in/out. Off by
  // default — owners opt in (see CLAUDE.md "Clock-in photos").
  requireClockInPhoto: boolean("require_clock_in_photo")
    .notNull()
    .default(false),
  // How many days clock-in photos are kept before the daily retention job
  // purges them. Always on (no "off"); owners pick 7, 30 or 90. Only the photos
  // are deleted — the timesheet entry/hours are kept. See CLAUDE.md.
  photoRetentionDays: integer("photo_retention_days").notNull().default(7),
  // SHA-256 hash of the kiosk capability token. Only the hash is stored; the
  // raw token lives in the kiosk link / cookie. Rotating it revokes old links.
  kioskTokenHash: text("kiosk_token_hash").unique(),
  // The shop's location, set by the owner in Settings. Used ONLY to geofence
  // personal-phone clock-in (not the shared kiosk). Null until the owner sets
  // it; personal clock-in is unavailable until then.
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  // How close (metres) a personal phone must be to the shop to clock in.
  geofenceRadiusM: integer("geofence_radius_m").notNull().default(200),
  // SHA-256 hash of the SEPARATE personal-phone clock-in capability token.
  // Distinct from the kiosk token so staff on their own phones only get the
  // GPS-checked route (no no-location bypass). Rotating it revokes old links.
  personalClockTokenHash: text("personal_clock_token_hash").unique(),
  // How many days before a certification's expiry the FIRST reminder email
  // fires (the final 7-day notice is fixed in code). Owner picks 30/60/90.
  certReminderLeadDays: integer("cert_reminder_lead_days")
    .notNull()
    .default(30),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Auth.js tables (owner authentication)                                      */
/* Column names MUST match what @auth/drizzle-adapter expects (camelCase).    */
/* `businessId` is our own addition, set when the owner's business is created.*/
/* -------------------------------------------------------------------------- */

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  businessId: uuid("businessId").references(() => businesses.id, {
    onDelete: "set null",
  }),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  ],
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

/* -------------------------------------------------------------------------- */
/* Domain (all business-scoped)                                               */
/* -------------------------------------------------------------------------- */

export const rosterStatus = pgEnum("roster_status", [
  "draft",
  "collecting",
  "building",
  "published",
]);

/**
 * Where an availability response came from. `staff` = the person answered via
 * their magic link. `manual` = the owner pre-filled it (no email sent, no
 * request record), e.g. they already know the person is free.
 */
export const availabilitySource = pgEnum("availability_source", [
  "staff",
  "manual",
]);

/**
 * `suggested` = a draft assignment proposed by "Draft from last week" that the
 * owner hasn't confirmed yet. `confirmed` = a real assignment. Only confirmed
 * assignments are published.
 */
export const assignmentStatus = pgEnum("assignment_status", [
  "suggested",
  "confirmed",
]);

/** Which side of a timesheet entry a clock photo belongs to. */
export const clockPhotoKind = pgEnum("clock_photo_kind", ["in", "out"]);

/**
 * How a staff member's pay rate was set. Both are just a stored hourly number
 * with a label — the app does NOT interpret awards, penalties or overtime.
 * `award` only records that the owner sourced the number from an award.
 */
export const rateType = pgEnum("rate_type", ["flat", "award"]);

/**
 * Kind of time off a staff member is requesting. A plain label only — the app
 * records leave, it does NOT track balances, accruals or entitlements, and does
 * no NES/award/payroll leave calculation.
 */
export const leaveType = pgEnum("leave_type", [
  "annual",
  "sick",
  "unpaid",
  "other",
]);

/**
 * Lifecycle of a leave request. `pending` = submitted by a staff member, awaiting
 * the owner; `approved`/`denied` = the owner decided. Owner-entered leave (a
 * verbal heads-up they record themselves) is created straight as `approved`.
 */
export const leaveStatus = pgEnum("leave_status", [
  "pending",
  "approved",
  "denied",
]);

/**
 * Lifecycle of a shift offer (release → claim → owner decision). `open` =
 * claimable; `claimed` = a staff member has claimed it, awaiting the owner;
 * `approved` = the owner approved the handover (assignment transferred);
 * `denied` = the owner declined the claim; `withdrawn` = pulled before anyone
 * claimed (by the owner, or the releaser self-cancelling their own open offer).
 * Only `open` and `claimed` are "active" — at most one active offer per shift.
 */
export const shiftOfferStatus = pgEnum("shift_offer_status", [
  "open",
  "claimed",
  "approved",
  "denied",
  "withdrawn",
]);

/**
 * Kind of certification / qualification tracked for a staff member. `other`
 * carries a free `cert_label`. These are plain expiry-tracked records — the app
 * does no award/compliance interpretation beyond the expiry date.
 */
export const certType = pgEnum("cert_type", [
  "rsa",
  "rsg",
  "food_safety",
  "first_aid",
  "wwcc",
  "other",
]);

/**
 * Which reminder email has already been sent for a certification, newest stage
 * wins (early → final → expired). Null = none sent yet. Used to make the daily
 * reminder job idempotent: each stage emails at most once.
 */
export const certReminderStage = pgEnum("cert_reminder_stage", [
  "early",
  "final",
  "expired",
]);

export const staffMembers = pgTable(
  "staff_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    active: boolean("active").notNull().default(true),
    // Whether this person is pre-checked when the owner asks for availability.
    // Owners can still override per-send; this is just the default.
    notifyByDefault: boolean("notify_by_default").notNull().default(true),
    // Salted scrypt hash of the staff member's kiosk PIN ("scrypt$salt$hash").
    // Null until the owner sets one. Never store or log the PIN itself.
    pinHash: text("pin_hash"),
    // Brute-force guard for the public kiosk: count of consecutive wrong PINs
    // and, once the limit is hit, the instant until which clock-in is locked.
    // Durable (not in-memory) so the cooldown holds across server instances.
    failedPinAttempts: integer("failed_pin_attempts").notNull().default(0),
    pinLockedUntil: timestamp("pin_locked_until", { withTimezone: true }),
    // Per-employee hourly pay rate the owner typed, in cents. Nullable until
    // set. This is a stored number + label only: the app records it (and shows
    // it on the CSV export), it never calculates wages, penalties or overtime.
    payRateCents: integer("pay_rate_cents"),
    rateType: rateType("rate_type").notNull().default("flat"),
    rateLabel: text("rate_label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("staff_member_business_email_unique").on(t.businessId, t.email),
  ],
);

/**
 * Reusable shift definition for a business, e.g. "Morning 07:00–12:00 on
 * Mon–Fri". `weekdays` holds ISO weekday numbers (1=Mon … 7=Sun) the template
 * applies to. Times are stored as wall-clock "HH:MM:SS" strings.
 */
export const shiftTemplates = pgTable("shift_template", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  weekdays: integer("weekdays").array().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const rosterPeriods = pgTable("roster_period", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  availabilityDeadline: timestamp("availability_deadline", {
    withTimezone: true,
  }),
  status: rosterStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const shifts = pgTable(
  "shift",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    rosterPeriodId: uuid("roster_period_id")
      .notNull()
      .references(() => rosterPeriods.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").references(() => shiftTemplates.id, {
      onDelete: "set null",
    }),
    date: date("date").notNull(),
    label: text("label").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("shift_period_idx").on(t.rosterPeriodId)],
);

export const availabilityRequests = pgTable(
  "availability_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    rosterPeriodId: uuid("roster_period_id")
      .notNull()
      .references(() => rosterPeriods.id, { onDelete: "cascade" }),
    staffMemberId: uuid("staff_member_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    // Only the hash of the magic-link token is stored; never the token itself.
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("availability_request_period_staff_unique").on(
      t.rosterPeriodId,
      t.staffMemberId,
    ),
  ],
);

export const availabilityResponses = pgTable(
  "availability_response",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    // Null for owner-entered ("manual") responses, which have no request.
    requestId: uuid("request_id").references(() => availabilityRequests.id, {
      onDelete: "cascade",
    }),
    // Set directly for manual responses (staff responses derive it via request).
    staffMemberId: uuid("staff_member_id").references(() => staffMembers.id, {
      onDelete: "cascade",
    }),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "cascade" }),
    available: boolean("available").notNull(),
    source: availabilitySource("source").notNull().default("staff"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("availability_response_request_shift_unique").on(
      t.requestId,
      t.shiftId,
    ),
    // Idempotent manual pre-fill: one manual response per staff member per
    // shift. Only applies to request-less (manual) rows.
    uniqueIndex("availability_response_manual_staff_shift_unique")
      .on(t.staffMemberId, t.shiftId)
      .where(sql`${t.requestId} is null`),
  ],
);

export const rosterAssignments = pgTable(
  "roster_assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "cascade" }),
    staffMemberId: uuid("staff_member_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    status: assignmentStatus("status").notNull().default("confirmed"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("roster_assignment_shift_staff_unique").on(
      t.shiftId,
      t.staffMemberId,
    ),
  ],
);

export const publishedRosters = pgTable("published_roster", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  rosterPeriodId: uuid("roster_period_id")
    .notNull()
    .unique()
    .references(() => rosterPeriods.id, { onDelete: "cascade" }),
  publicSlug: text("public_slug").notNull().unique(),
  publishedAt: timestamp("published_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A clock-in/out record for a staff member. `clockOutAt` null means the person
 * is currently clocked in. `shiftId` links the entry to a rostered shift when
 * one matches (published + confirmed) on the clock-in date; it stays null for
 * unscheduled work. `approved` is the owner's payroll sign-off.
 */
export const timesheetEntries = pgTable(
  "timesheet_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    staffMemberId: uuid("staff_member_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    shiftId: uuid("shift_id").references(() => shifts.id, {
      onDelete: "set null",
    }),
    clockInAt: timestamp("clock_in_at", { withTimezone: true }).notNull(),
    clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
    // Coordinates captured at clock-in from a personal phone, and whether they
    // were inside the business geofence. Null for kiosk and owner-entered rows
    // (location not checked). `within_geofence = true` means location-verified.
    clockInLat: doublePrecision("clock_in_lat"),
    clockInLng: doublePrecision("clock_in_lng"),
    withinGeofence: boolean("within_geofence"),
    approved: boolean("approved").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("timesheet_entry_business_staff_idx").on(
      t.businessId,
      t.staffMemberId,
    ),
    // A staff member can have at most one open (not-yet-clocked-out) entry,
    // making double clock-in impossible at the database level.
    uniqueIndex("timesheet_entry_one_open_per_staff")
      .on(t.staffMemberId)
      .where(sql`${t.clockOutAt} is null`),
  ],
);

/**
 * Optional photo captured at clock in/out, stored inline as `bytea`. Cascades
 * away with its timesheet entry. Served only to the owner via a scoped route.
 */
export const clockPhotos = pgTable("clock_photo", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  timesheetEntryId: uuid("timesheet_entry_id")
    .notNull()
    .references(() => timesheetEntries.id, { onDelete: "cascade" }),
  kind: clockPhotoKind("kind").notNull(),
  mimeType: text("mime_type").notNull(),
  imageData: bytea("image_data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A staff member's request for time off, and the owner's decision on it.
 *
 * `start_date`/`end_date` are inclusive calendar dates ("YYYY-MM-DD"), like
 * shift dates — timezone-free. `status` starts `pending` for staff-submitted
 * requests; the owner approves/denies (setting `decided_at`), or enters leave
 * directly as `approved`. `decision_notified_at` is set once the decision email
 * has been sent, so the email job is idempotent (mirrors availability
 * `sent_at`). This table records leave only — NO balances, accruals,
 * entitlements or NES/award/payroll calculation.
 */
export const leaveRequests = pgTable(
  "leave_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    staffMemberId: uuid("staff_member_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    leaveType: leaveType("leave_type").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    note: text("note"),
    status: leaveStatus("status").notNull().default("pending"),
    // When the owner approved/denied. Null while pending.
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    // When the decision email was sent; guards the email job against resends.
    decisionNotifiedAt: timestamp("decision_notified_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("leave_request_business_idx").on(t.businessId),
    index("leave_request_staff_idx").on(t.staffMemberId),
    index("leave_request_status_idx").on(t.status),
  ],
);

/**
 * A shift offer: a confirmed shift in a published roster that's been made
 * claimable, and the handover lifecycle around it (release → claim → owner
 * decision). See `shiftOfferStatus`. `offered_by_staff_id` is the staff member
 * who released their own assignment, or NULL when the owner posted an open shift
 * on an unassigned shift. `claimed_by_staff_id` is whoever claimed it.
 *
 * The original assignee's `roster_assignment` is NEVER removed on release — it's
 * removed only when the owner approves a replacement (the transfer), so a shift
 * is never left uncovered. `decision_notified_at` makes the approval email job
 * idempotent (mirrors leave). A partial unique index keeps at most ONE active
 * (`open`/`claimed`) offer per shift; re-offering after a final state is allowed.
 */
export const shiftOffers = pgTable(
  "shift_offer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "cascade" }),
    // Set when a staff member released their own assignment; NULL for an
    // owner-posted open shift. On staff deletion we keep the offer but null this.
    offeredByStaffId: uuid("offered_by_staff_id").references(
      () => staffMembers.id,
      { onDelete: "set null" },
    ),
    claimedByStaffId: uuid("claimed_by_staff_id").references(
      () => staffMembers.id,
      { onDelete: "set null" },
    ),
    status: shiftOfferStatus("status").notNull().default("open"),
    // When the owner approved/denied (or it was withdrawn). Null while open.
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    // When the approval email was sent; guards the email job against resends.
    decisionNotifiedAt: timestamp("decision_notified_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("shift_offer_business_idx").on(t.businessId),
    index("shift_offer_shift_idx").on(t.shiftId),
    index("shift_offer_status_idx").on(t.status),
    // At most one active (open/claimed) offer per shift, enforced in the DB.
    uniqueIndex("shift_offer_one_active_per_shift")
      .on(t.shiftId)
      .where(sql`${t.status} in ('open', 'claimed')`),
  ],
);

/**
 * A certification / qualification a staff member holds, tracked for expiry. Text
 * + dates only — NO document upload/storage in this build. `cert_label` is a
 * free label (required by the UI when `cert_type = 'other'`). `expiry_date` is a
 * calendar date ("YYYY-MM-DD"), timezone-free like shift dates.
 * `last_reminder_stage` records the most recent reminder email sent so the daily
 * job is idempotent (each stage at most once); it's reset to null when the
 * expiry date changes (a renewed cert re-arms its reminders). Expiry is FLAGGED
 * and reminded only — never enforced anywhere.
 */
export const staffCertifications = pgTable(
  "staff_certification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    staffMemberId: uuid("staff_member_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    certType: certType("cert_type").notNull(),
    certLabel: text("cert_label"),
    referenceNumber: text("reference_number"),
    expiryDate: date("expiry_date").notNull(),
    lastReminderStage: certReminderStage("last_reminder_stage"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("staff_certification_business_idx").on(t.businessId),
    index("staff_certification_staff_idx").on(t.staffMemberId),
    index("staff_certification_expiry_idx").on(t.expiryDate),
  ],
);

/**
 * A supplier the business orders stock from. Part 1 of the inventory feature:
 * record-keeping only — the app NEVER places orders or integrates with any
 * supplier system. `delivery_days` holds the ISO weekday numbers (1=Mon … 7=Sun)
 * the supplier delivers on, stored as an integer array to match
 * `shift_template.weekdays`. `order_cutoff_days_before` is how many days before a
 * delivery day the owner wants an order-by reminder. `last_order_reminder_date`
 * is the idempotency cursor for the daily order-reminder job (Part 2): the
 * delivery date we last reminded for, set after a successful send so the job
 * doesn't resend the same day and re-arms for the next delivery cycle.
 */
export const suppliers = pgTable(
  "supplier",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    deliveryDays: integer("delivery_days").array().notNull().default([]),
    orderCutoffDaysBefore: integer("order_cutoff_days_before")
      .notNull()
      .default(1),
    notes: text("notes"),
    // Part 2 order-reminder idempotency cursor (the delivery date last reminded
    // for). Null until the first reminder fires for this supplier.
    lastOrderReminderDate: date("last_order_reminder_date"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("supplier_business_idx").on(t.businessId)],
);

/**
 * An inventory item / SKU the business tracks. Part 1: record-keeping only (no
 * stock counts, no ordering — those are Part 2). `sku_code`/`unit` are free text.
 * `supplier_id` links a supplier when known; on supplier delete it's set null
 * (the item is kept, just unlinked). `is_active` lets owners retire an item
 * without deleting its history.
 */
export const items = pgTable(
  "item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    skuCode: text("sku_code"),
    unit: text("unit"),
    supplierId: uuid("supplier_id").references(() => suppliers.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("item_business_idx").on(t.businessId),
    index("item_business_supplier_idx").on(t.businessId, t.supplierId),
  ],
);

/**
 * Where an item's stock currently sits, as set by a staff stock check or the
 * owner. `available` = fine; `low` = running low; `needs_order` = order it. This
 * is FLAGGED only — it never blocks anything; it just feeds the owner's Stock
 * view and the daily order reminder.
 */
export const stockCheckStatus = pgEnum("stock_check_status", [
  "available",
  "low",
  "needs_order",
]);

/**
 * One stock check on one item (inventory Part 2; tracking + reminders only). The
 * CURRENT status of an item is its most recent entry (latest `checked_at`).
 * `checked_by_staff_id` is the staff member who recorded it via the PIN flow, or
 * NULL when the OWNER set it manually (also nulled if that staff member is later
 * deleted — the history row is kept). `quantity` is optional free text ("2
 * boxes") — record-only, never parsed. The app records status and reminds the
 * owner; it NEVER places orders.
 */
export const stockCheckEntries = pgTable(
  "stock_check_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    status: stockCheckStatus("status").notNull(),
    quantity: text("quantity"),
    checkedByStaffId: uuid("checked_by_staff_id").references(
      () => staffMembers.id,
      { onDelete: "set null" },
    ),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("stock_check_entry_business_item_idx").on(t.businessId, t.itemId),
    index("stock_check_entry_business_checked_idx").on(
      t.businessId,
      t.checkedAt,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations (for relational queries)                                         */
/* -------------------------------------------------------------------------- */

export const rosterPeriodsRelations = relations(
  rosterPeriods,
  ({ many, one }) => ({
    shifts: many(shifts),
    requests: many(availabilityRequests),
    business: one(businesses, {
      fields: [rosterPeriods.businessId],
      references: [businesses.id],
    }),
    published: one(publishedRosters),
  }),
);

export const shiftsRelations = relations(shifts, ({ one, many }) => ({
  period: one(rosterPeriods, {
    fields: [shifts.rosterPeriodId],
    references: [rosterPeriods.id],
  }),
  assignments: many(rosterAssignments),
  responses: many(availabilityResponses),
}));

export const availabilityRequestsRelations = relations(
  availabilityRequests,
  ({ one, many }) => ({
    period: one(rosterPeriods, {
      fields: [availabilityRequests.rosterPeriodId],
      references: [rosterPeriods.id],
    }),
    staff: one(staffMembers, {
      fields: [availabilityRequests.staffMemberId],
      references: [staffMembers.id],
    }),
    responses: many(availabilityResponses),
  }),
);

export const availabilityResponsesRelations = relations(
  availabilityResponses,
  ({ one }) => ({
    request: one(availabilityRequests, {
      fields: [availabilityResponses.requestId],
      references: [availabilityRequests.id],
    }),
    shift: one(shifts, {
      fields: [availabilityResponses.shiftId],
      references: [shifts.id],
    }),
  }),
);

export const rosterAssignmentsRelations = relations(
  rosterAssignments,
  ({ one }) => ({
    shift: one(shifts, {
      fields: [rosterAssignments.shiftId],
      references: [shifts.id],
    }),
    staff: one(staffMembers, {
      fields: [rosterAssignments.staffMemberId],
      references: [staffMembers.id],
    }),
  }),
);

export const staffMembersRelations = relations(staffMembers, ({ one }) => ({
  business: one(businesses, {
    fields: [staffMembers.businessId],
    references: [businesses.id],
  }),
}));

export const timesheetEntriesRelations = relations(
  timesheetEntries,
  ({ one, many }) => ({
    staff: one(staffMembers, {
      fields: [timesheetEntries.staffMemberId],
      references: [staffMembers.id],
    }),
    shift: one(shifts, {
      fields: [timesheetEntries.shiftId],
      references: [shifts.id],
    }),
    photos: many(clockPhotos),
  }),
);

export const clockPhotosRelations = relations(clockPhotos, ({ one }) => ({
  entry: one(timesheetEntries, {
    fields: [clockPhotos.timesheetEntryId],
    references: [timesheetEntries.id],
  }),
}));

export const leaveRequestsRelations = relations(leaveRequests, ({ one }) => ({
  business: one(businesses, {
    fields: [leaveRequests.businessId],
    references: [businesses.id],
  }),
  staff: one(staffMembers, {
    fields: [leaveRequests.staffMemberId],
    references: [staffMembers.id],
  }),
}));

export const shiftOffersRelations = relations(shiftOffers, ({ one }) => ({
  business: one(businesses, {
    fields: [shiftOffers.businessId],
    references: [businesses.id],
  }),
  shift: one(shifts, {
    fields: [shiftOffers.shiftId],
    references: [shifts.id],
  }),
  offeredBy: one(staffMembers, {
    fields: [shiftOffers.offeredByStaffId],
    references: [staffMembers.id],
  }),
  claimedBy: one(staffMembers, {
    fields: [shiftOffers.claimedByStaffId],
    references: [staffMembers.id],
  }),
}));

export const staffCertificationsRelations = relations(
  staffCertifications,
  ({ one }) => ({
    business: one(businesses, {
      fields: [staffCertifications.businessId],
      references: [businesses.id],
    }),
    staff: one(staffMembers, {
      fields: [staffCertifications.staffMemberId],
      references: [staffMembers.id],
    }),
  }),
);

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  business: one(businesses, {
    fields: [suppliers.businessId],
    references: [businesses.id],
  }),
  items: many(items),
}));

export const itemsRelations = relations(items, ({ one, many }) => ({
  business: one(businesses, {
    fields: [items.businessId],
    references: [businesses.id],
  }),
  supplier: one(suppliers, {
    fields: [items.supplierId],
    references: [suppliers.id],
  }),
  stockChecks: many(stockCheckEntries),
}));

export const stockCheckEntriesRelations = relations(
  stockCheckEntries,
  ({ one }) => ({
    business: one(businesses, {
      fields: [stockCheckEntries.businessId],
      references: [businesses.id],
    }),
    item: one(items, {
      fields: [stockCheckEntries.itemId],
      references: [items.id],
    }),
    checkedBy: one(staffMembers, {
      fields: [stockCheckEntries.checkedByStaffId],
      references: [staffMembers.id],
    }),
  }),
);
