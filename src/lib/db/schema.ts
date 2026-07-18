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
  jsonb,
  doublePrecision,
  primaryKey,
  unique,
  uniqueIndex,
  index,
  check,
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

/**
 * The account boundary for the multi-location feature (M29). One owner's set of
 * locations belongs to one organisation; each `business` (= a location) carries
 * `org_id`. Staff collapse to the org (Strategy A): a `staff_member` belongs to
 * the org and reaches a location through `staff_location`. Introduced additively
 * — pre-M29 every business gets its own org 1:1 at migration time, so existing
 * single-location owners see no change. See docs/multi-location-plan.md.
 */
/**
 * Vendor-set account-lifecycle label for the Zale IT admin console (M37). This
 * is NOT billing or wage data — Zale IT simply marks whether a client account
 * is live, on trial, or paused. It drives the admin client filters + KPIs only
 * and never changes any tenant-facing behaviour.
 */
export const planStatus = pgEnum("plan_status", ["active", "trial", "paused"]);

export const organisations = pgTable("organisation", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Seeds a new location's timezone; each location still owns its own tz.
  defaultTimezone: text("default_timezone")
    .notNull()
    .default("Australia/Sydney"),
  // Account lifecycle for the vendor admin console (M37). Default `active`; the
  // admin can mark an account trial/paused. Purely a label — no billing maths.
  planStatus: planStatus("plan_status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const businesses = pgTable("business", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The organisation this location belongs to (M29). Nullable during the
  // additive rollout; backfilled 1:1 (org id = business id at migration time)
  // and treated as required by the app once every row is populated.
  orgId: uuid("org_id").references(() => organisations.id, {
    onDelete: "cascade",
  }),
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
  // Per-event owner in-app notification preferences. One boolean per
  // notification type; all ON by default. When off, that event creates no
  // in-app notification (the existing emails are unaffected). The type set is
  // fixed (five events), so plain columns are simpler than a side table.
  notifyLeaveRequested: boolean("notify_leave_requested")
    .notNull()
    .default(true),
  notifyShiftOfferActivity: boolean("notify_shift_offer_activity")
    .notNull()
    .default(true),
  notifyStockNeedsOrder: boolean("notify_stock_needs_order")
    .notNull()
    .default(true),
  notifyCertExpiring: boolean("notify_cert_expiring").notNull().default(true),
  notifyAvailabilityReply: boolean("notify_availability_reply")
    .notNull()
    .default(true),
  // Phase 3a — coalesced "new form response" notifications (count-only, no
  // answer content or respondent identity). On by default like the others.
  notifyFormResponse: boolean("notify_form_response").notNull().default(true),
  // Whether the daily IN-APP shift reminder ("you work tomorrow") is created
  // for this business's staff. Business-level (staff have no settings surface);
  // on by default. In-app only — this never sends email.
  staffShiftRemindersEnabled: boolean("staff_shift_reminders_enabled")
    .notNull()
    .default(true),
  // M35 — the daily form-response EMAIL digest (one consolidated email per
  // day when forms received new responses; counts + titles only, never
  // answer content or respondent identity). Settings toggle, on by default.
  formDigestEnabled: boolean("form_digest_enabled").notNull().default(true),
  // Idempotency cursor: the sweep counts responses submitted AFTER this and
  // advances it only after a successful send (null = never sent → the first
  // digest covers the last 24 h, not all history).
  formDigestLastAt: timestamp("form_digest_last_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Auth.js tables (owner authentication)                                      */
/* Column names MUST match what @auth/drizzle-adapter expects (camelCase).    */
/* `businessId` is our own addition, set when the owner's business is created.*/
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  "user",
  {
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
  },
  (t) => [
    // Guard, not a behaviour change: the sign-in form and Auth.js's email
    // normalizer both lowercase before any lookup or insert, so the app can
    // only create lowercase rows. This stops any out-of-band or future code
    // path from creating case-variant duplicate accounts (one owner, two
    // "user" rows, business looks lost). Kept alongside the case-sensitive
    // unique constraint the adapter's equality lookups rely on.
    uniqueIndex("user_email_lower_unique").on(sql`lower(${t.email})`),
  ],
);

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
/* Organisation membership (which owners can reach which org — M29)            */
/* -------------------------------------------------------------------------- */

/**
 * An owner's role in an organisation. v1 ships a single role (`owner`); the
 * column exists so later manager/viewer roles are additive. This is the source
 * of "what can this signed-in owner reach", replacing the single
 * `user.businessId` pointer over the M29 rollout.
 */
export const orgRole = pgEnum("org_role", ["owner"]);

export const orgMemberships = pgTable(
  "org_membership",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgRole("role").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("org_membership_org_user_unique").on(t.orgId, t.userId),
    index("org_membership_user_idx").on(t.userId),
    index("org_membership_org_idx").on(t.orgId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Cross-app SSO (inbound handoff from prompt2eat)                             */
/* -------------------------------------------------------------------------- */

/**
 * Replay guard for inbound prompt2eat SSO tokens. NOT a domain table — it holds
 * no tenant data, only the one-time `jti` of each consumed handoff token (like
 * `verificationToken`, this is auth/SSO infrastructure). Insert-on-first-use
 * with the `jti` primary key as the arbiter: a unique violation means the token
 * was already spent, so the handoff is rejected. Rows are garbage-collected
 * after ~10 minutes (far beyond the token's ≤60s lifetime). See
 * `src/lib/sso/roster-sso.ts` and the `POST /api/sso/prompt2eat` route.
 */
export const ssoConsumedTokens = pgTable(
  "sso_consumed_tokens",
  {
    jti: text("jti").primaryKey(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sso_consumed_tokens_seen_at_idx").on(t.seenAt)],
);

/* -------------------------------------------------------------------------- */
/* Zale IT platform admin (vendor back-office — M37)                          */
/* NON-TENANT: these two tables belong to the vendor, not any one business.   */
/* They are reachable ONLY behind requireAdmin(); the cross-tenant admin repo  */
/* is the single, explicit exception to the per-business scoping rule.        */
/* -------------------------------------------------------------------------- */

/**
 * A Zale IT staff member allowed into the admin console. Keyed to an Auth.js
 * `user` — an admin still signs in with the ordinary email magic link, so this
 * is a ROLE grant, NOT a separate login. A row is provisioned on first sign-in
 * for any email in ADMIN_ALLOWLIST (or seeded directly). Being an admin is
 * independent of owning a business: an admin has no org membership and reaches
 * live tenants only through impersonation.
 */
export const platformAdmins = pgTable("platform_admin", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  // Display name shown in the admin chrome ("Priya · Zale IT"); falls back to
  // the user's name/email when null.
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Append-only audit log of every admin action across clients — the
 * accountability record behind impersonation. Writes made while impersonating a
 * tenant are flagged (`is_write`), alongside the enter/exit of each live-account
 * session. Admin name + venue are SNAPSHOTTED so a row stays legible even after
 * the admin or business is deleted (the FKs null out but the text remains).
 */
export const adminActivities = pgTable(
  "admin_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminUserId: text("admin_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    adminName: text("admin_name").notNull(),
    // Free-text action title, e.g. "Entered live account" / "Publish roster".
    action: text("action").notNull(),
    detail: text("detail"),
    // True for a write made to a tenant's live data while impersonating; false
    // for reads / navigation (enter + exit of a live-account session).
    isWrite: boolean("is_write").notNull().default(false),
    // The affected client (organisation) + location, snapshotted by name so the
    // log reads correctly even after either is deleted.
    orgId: uuid("org_id").references(() => organisations.id, {
      onDelete: "set null",
    }),
    businessId: uuid("business_id").references(() => businesses.id, {
      onDelete: "set null",
    }),
    venueName: text("venue_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("admin_activity_created_idx").on(t.createdAt),
    index("admin_activity_org_idx").on(t.orgId),
  ],
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
 * How widely an open shift offer can be claimed (M29 Phase 3). `location` = only
 * staff at the offer's own location (the pre-M29 behaviour, still the default).
 * `org` = any member of the organisation, so a person can cover a shift at
 * another of the owner's locations. The owner always approves the handover.
 */
export const shiftOfferScope = pgEnum("shift_offer_scope", ["location", "org"]);

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
    // The organisation this person belongs to (M29, Strategy A — staff collapse
    // to the org). Nullable during the additive rollout; backfilled from the
    // home business's org. Staff scoping migrates from `business_id` to this
    // `org_id` + `staff_location` one surface at a time.
    orgId: uuid("org_id").references(() => organisations.id, {
      onDelete: "cascade",
    }),
    // The person's HOME location. Retained through the M29 transition (every
    // staff query still uses it) and retired only once all staff scoping runs
    // off `org_id` + `staff_location`. A person works additional locations via
    // `staff_location` memberships.
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
    // SHA-256 hash of this staff member's PRIVATE notices capability token
    // (the /me/<token> link). Mirrors business.kiosk_token_hash: only the hash
    // is stored, the raw token lives in the link/cookie, rotating revokes old
    // links. Null = no link generated yet. The link identifies WHO; their PIN
    // proves it's them before anything personal is shown.
    noticesTokenHash: text("notices_token_hash").unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("staff_member_business_email_unique").on(t.businessId, t.email),
    index("staff_member_org_idx").on(t.orgId),
  ],
);

/**
 * Which locations an org-level `staff_member` can work at (M29). A person
 * appears in a location's roster / availability / kiosk ONLY through an active
 * membership here — the org collapse must never make one location's kiosk show
 * the whole org's people. Backfilled 1:1 from each staff member's home
 * `business_id`; a cross-location loan/claim first ensures a membership at the
 * target location.
 */
export const staffLocations = pgTable(
  "staff_location",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    staffMemberId: uuid("staff_member_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    active: boolean("active").notNull().default(true),
    // When this membership was created by a date-ranged loan (M29 Phase 4), the
    // loan that created it. NULL = a permanent membership (home or owner-added on
    // the People page). The loan-expiry job only ever deactivates memberships
    // with a loan_id, so a permanent membership is never removed.
    loanId: uuid("loan_id").references(() => staffLoans.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("staff_location_business_staff_unique").on(
      t.businessId,
      t.staffMemberId,
    ),
    index("staff_location_business_idx").on(t.businessId),
    index("staff_location_staff_idx").on(t.staffMemberId),
    index("staff_location_org_idx").on(t.orgId),
  ],
);

/**
 * A time-boxed lend of an org staff member to another location (M29 Phase 4) —
 * the dated refinement of the People-page membership lend. Creating a loan
 * records it AND ensures an active `staff_location` at `to_business_id` (tagged
 * with this loan's id) so the person is rosterable there for the range. When the
 * loan ends (owner-ended or the daily expiry job past `end_date`) that
 * loan-created membership is deactivated — a permanent membership is never
 * touched. `active` flips false on end/expiry; `from_business_id` is the
 * person's home at loan time (display only).
 */
export const staffLoans = pgTable(
  "staff_loan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    staffMemberId: uuid("staff_member_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    fromBusinessId: uuid("from_business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    toBusinessId: uuid("to_business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    // Inclusive calendar dates ("YYYY-MM-DD"), like shift/leave dates.
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    note: text("note"),
    // False once the loan has been ended by the owner or expired past end_date.
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("staff_loan_org_idx").on(t.orgId),
    index("staff_loan_staff_idx").on(t.staffMemberId),
    index("staff_loan_to_business_idx").on(t.toBusinessId),
    index("staff_loan_active_idx").on(t.active),
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
  // Owner-chosen accent colour (a bar hex from the fixed SHIFT_PALETTE). Null =
  // no explicit choice, so the display falls back to the keyword-derived scheme
  // (shiftColorScheme). Purely presentational; never enforced.
  color: text("color"),
  // Optional per-weekday time overrides, keyed by ISO weekday ("1".."7") →
  // { start, end } ("HH:MM"). A day with no entry uses the default start/end
  // above. Null/empty = every day uses the default (the original behaviour).
  // Applied only at expansion (expandTemplatesToShifts); concrete shifts still
  // snapshot their own resolved times, so nothing downstream changes.
  dayTimeOverrides:
    jsonb("day_time_overrides").$type<
      Record<string, { start: string; end: string }>
    >(),
  // How many people each instance of this shift needs (hospitality: several
  // staff share one Friday-night close). A TARGET the builder flags against —
  // never a hard block. Snapshotted onto each concrete shift at expansion.
  requiredStaff: integer("required_staff").notNull().default(1),
  // Optional per-weekday staffing overrides, keyed by ISO weekday ("1".."7")
  // → required staff for that day ("Friday needs 4"). A day with no entry
  // uses requiredStaff above. Null/empty = every day uses the default.
  // Applied only at expansion (like dayTimeOverrides); concrete shifts still
  // snapshot their own resolved number.
  dayStaffOverrides: jsonb("day_staff_overrides").$type<
    Record<string, number>
  >(),
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
    // Snapshot of the type's required_staff at expansion (like label/times),
    // owner-adjustable per shift in the builder ("Friday needs one more").
    // A staffing TARGET the builder flags against; publish is never blocked.
    requiredStaff: integer("required_staff").notNull().default(1),
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
    // Per-assignment schedule override (drag-and-drop builder). Null start/end
    // = this person works the shift's own times (the original behaviour —
    // every pre-existing row behaves exactly as before). When set, BOTH are
    // set, and this person's effective times differ from the shift block's.
    // The shift's snapshot times stay the source of truth for the slot itself.
    startTime: time("start_time"),
    endTime: time("end_time"),
    // Unpaid break inside this person's shift, minutes (0 = none). Roster
    // display only — actual worked hours still come from timesheets.
    breakMinutes: integer("break_minutes").notNull().default(0),
    // Where the break sits ("HH:MM" wall clock). Set whenever breakMinutes >
    // 0 so the builder can draw the gap and the owner can drag it.
    breakStart: time("break_start"),
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
    // Unpaid break (minutes) the owner records on the entry, subtracted from
    // worked hours everywhere hours are shown/exported/reported. 0 = no break;
    // the UI offers None / 30 / 60. Never a payroll calc — just net worked time.
    breakMinutes: integer("break_minutes").notNull().default(0),
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
    // How widely the offer can be claimed (M29 Phase 3). `location` (default)
    // keeps the pre-M29 same-location behaviour; `org` lets any org member claim
    // it from their own location's kiosk, for cross-location cover.
    scope: shiftOfferScope("scope").notNull().default("location"),
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

/**
 * Kind of owner-facing in-app notification. One per in-scope event. Each maps to
 * a boolean preference column on `business` (see `notify_*` below) that gates
 * creation. `form_response` (Phase 3a) is the only COALESCED type — see
 * `notification.group_key`/`count`.
 */
export const notificationType = pgEnum("notification_type", [
  "leave_requested",
  "shift_offer_activity",
  "stock_needs_order",
  "cert_expiring",
  "availability_reply",
  "form_response",
]);

/**
 * An owner-facing in-app notification. Business-scoped; shown in the header bell
 * dropdown. Created best-effort at each in-scope event's source, and ONLY when
 * the business has that event type enabled (the `notify_*` columns on
 * `business`). `link_path` is where clicking it takes the owner (e.g.
 * `/app/leave`). These are IN ADDITION to the existing emails — never a
 * replacement. NO staff-facing notifications (staff have no persistent session).
 *
 * COALESCING (Phase 3a, `form_response`): a busy public form would flood the
 * bell with one item per response, so form-response notifications COALESCE into
 * ONE updating unread row per form. `group_key` is the coalescing handle
 * (`form_response:<formId>`; NULL for every non-coalesced type) and `count` is
 * how many responses the row represents (default 1). A new response increments
 * the existing UNREAD row for that group (refreshing `created_at`) or starts a
 * fresh one; the partial unique index `(business_id, group_key) WHERE group_key
 * IS NOT NULL AND is_read = false` guarantees at most one active row per group
 * and is the ON CONFLICT arbiter. Reading the row (the bell marks it read on
 * navigate) flips `is_read`, so the next response starts a fresh count.
 */
export const notifications = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    type: notificationType("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    linkPath: text("link_path"),
    isRead: boolean("is_read").notNull().default(false),
    // Coalescing handle: `form_response:<formId>` for the coalesced
    // form-response type, NULL for every other (one-shot) notification type.
    groupKey: text("group_key"),
    // How many underlying events this (coalesced) row represents. Always 1 for
    // non-coalesced rows.
    count: integer("count").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notification_business_read_idx").on(t.businessId, t.isRead),
    index("notification_business_created_idx").on(t.businessId, t.createdAt),
    // At most one ACTIVE (unread) coalesced row per (business, group). The
    // predicate MUST match the upsert's ON CONFLICT arbiter so Postgres uses
    // this partial unique index. Non-coalesced rows (group_key NULL) are
    // excluded, so they never collide.
    uniqueIndex("notification_unread_group_unique")
      .on(t.businessId, t.groupKey)
      .where(sql`${t.groupKey} is not null and ${t.isRead} = false`),
  ],
);

export const staffNotificationType = pgEnum("staff_notification_type", [
  "leave_decided",
  "shift_swap_approved",
  "rostered",
  "shift_reminder",
]);

/**
 * A STAFF-facing in-app notification ("notice"), keyed to one staff member.
 * Shown only on that person's PIN-gated /me page (capability link). Created
 * best-effort via `notifyStaff` at the event source, IN ADDITION to the
 * existing staff emails — never a replacement. `dedupe_key` is the daily
 * shift-reminder's idempotency handle: a unique index + ON CONFLICT DO NOTHING
 * makes re-running the job a no-op (event notices leave it NULL; Postgres
 * unique indexes allow multiple NULLs).
 */
export const staffNotifications = pgTable(
  "staff_notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    staffMemberId: uuid("staff_member_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    type: staffNotificationType("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    isRead: boolean("is_read").notNull().default(false),
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("staff_notification_staff_read_idx").on(t.staffMemberId, t.isRead),
    index("staff_notification_business_created_idx").on(
      t.businessId,
      t.createdAt,
    ),
    uniqueIndex("staff_notification_dedupe_key_idx").on(t.dedupeKey),
  ],
);

/* -------------------------------------------------------------------------- */
/* Forms (custom form builder — Phase 1a: owner-authored drafts only)         */
/* -------------------------------------------------------------------------- */

/**
 * Lifecycle of a custom form. Phase 1a is builder-only and ONLY ever writes
 * `draft`; `published`/`closed` exist now for later phases (publishing +
 * response collection) and are never set by the builder CRUD, so those phases
 * stay purely additive (no enum migration later).
 */
export const formStatus = pgEnum("form_status", [
  "draft",
  "published",
  "closed",
]);

/**
 * A custom form field's input type (closed set for v1). `rating` is a fixed 1–5
 * scale and `yes_no` a fixed two-option choice — no per-field config. Only
 * `single_select` carries owner-managed `options`; every other type ignores
 * them.
 */
export const formFieldType = pgEnum("form_field_type", [
  "short_text",
  "long_text",
  "rating",
  "single_select",
  "yes_no",
]);

/**
 * A single_select option. `id` is generated server-side and is STABLE across
 * saves (preserved when present, generated only when absent) so a later phase
 * can store the option id as the answer and label edits won't break historical
 * responses. `label` is the owner-facing choice text.
 */
export type FormFieldOption = { id: string; label: string };

/**
 * An owner-authored custom form. Business-scoped like every domain table. Phase
 * 1a is builder-only: forms are created and edited as `draft` and never
 * published here. `public_slug` (the future public URL handle) and
 * `allow_anonymous` exist now so later phases are additive, but are NEVER set
 * by 1a — the slug stays NULL until a publish action generates it (Postgres
 * allows many NULLs under a unique constraint, so drafts never collide).
 * `title` is required at creation and editable thereafter; `description` is
 * optional.
 *
 * Phase 2 (staff/internal channel) finally uses two more flags, INDEPENDENT of
 * the public publish state:
 *  - `internal_enabled` — whether staff can see + fill this form in their
 *    PIN-gated /me portal. A form can be staff-only, public-only, or both.
 *  - `allow_anonymous` — whether STAFF responses are anonymous. When true, no
 *    respondent identity is ever written (true anonymity); when false, the
 *    PIN-authenticated staff member is attributed. Frozen once the form has its
 *    first internal response so the anonymity guarantee can't change under
 *    already-collected data.
 * FIELD-STRUCTURE LOCK (Phase 2): a form's fields are frozen when it is
 * `published` OR `internal_enabled` (see `saveForm`).
 */
export const forms = pgTable(
  "form",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: formStatus("status").notNull().default("draft"),
    publicSlug: text("public_slug").unique(),
    allowAnonymous: boolean("allow_anonymous").notNull().default(false),
    // Phase 2: staff can see + fill this form in their /me portal. Independent
    // of the public publish state (status/public_slug). Off by default.
    internalEnabled: boolean("internal_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("form_business_idx").on(t.businessId)],
);

/**
 * One field on a custom form, owner-labelled. `business_id` is carried so field
 * reads/writes stay tenant-scoped by construction; it is ALWAYS forced from the
 * owner session (never request input), so a field's business always equals its
 * parent form's business. `position` is re-sequenced 0..n from the editor's
 * array order on each save. `options` holds `{ id, label }[]` for
 * `single_select` only (stable option ids — see `FormFieldOption`); all other
 * field types leave it null.
 */
export const formFields = pgTable(
  "form_field",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    type: formFieldType("type").notNull(),
    required: boolean("required").notNull().default(false),
    position: integer("position").notNull(),
    options: jsonb("options").$type<FormFieldOption[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("form_field_business_form_idx").on(t.businessId, t.formId)],
);

/* -------------------------------------------------------------------------- */
/* Form responses (form builder Phase 1b — public collection)                 */
/* -------------------------------------------------------------------------- */

/**
 * Where a form response came in through. `public` = the unauthenticated
 * `/f/<slug>` route (Phase 1b); `internal` = the PIN-gated staff `/me` portal
 * (Phase 2). Fixed set.
 */
export const formChannel = pgEnum("form_channel", ["public", "internal"]);

/**
 * One submitted response to a form.
 *
 * `business_id` is denormalised for tenant-scoped owner reads and is ALWAYS set
 * server-side from the FORM's business, never from the request. `source` is
 * optional attribution ("qr"/"link").
 *
 * `respondent_staff_id` (Phase 2) attributes an INTERNAL response to the staff
 * member who submitted it. It is:
 *  - ALWAYS the PIN-authenticated staff member, resolved server-side from the
 *    /me session — NEVER taken from request input;
 *  - NULL for `public` responses and for ANONYMOUS internal responses (when the
 *    form's `allow_anonymous` is true we write nothing linking the response to a
 *    person — true anonymity, not "stored then hidden");
 *  - ON DELETE SET NULL, so deleting a staff member keeps their responses but
 *    drops the link (an attributed row then reads as "Former staff", derived
 *    from the form's frozen `allow_anonymous`, NOT mislabelled "Anonymous").
 *
 * The partial unique index enforces ONE response per staff per form for
 * ATTRIBUTED responses (anonymous rows have a NULL respondent → excluded, so
 * multiple anonymous rows are fine). This is the AUTHORITATIVE, race-safe
 * one-per-staff guard (the /me list's "already responded" check is UX only).
 */
export const formResponses = pgTable(
  "form_response",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    channel: formChannel("channel").notNull().default("public"),
    source: text("source"),
    // Phase 2 — the attributed staff member (internal channel only). Null for
    // public AND for anonymous internal responses. Server-resolved only.
    respondentStaffId: uuid("respondent_staff_id").references(
      () => staffMembers.id,
      { onDelete: "set null" },
    ),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("form_response_business_form_idx").on(t.businessId, t.formId),
    index("form_response_form_submitted_idx").on(t.formId, t.submittedAt),
    // One ATTRIBUTED response per staff per form. Anonymous rows (null
    // respondent) are excluded, so they never collide.
    uniqueIndex("form_response_one_per_staff")
      .on(t.formId, t.respondentStaffId)
      .where(sql`${t.respondentStaffId} is not null`),
  ],
);

/**
 * One answer to one field within a response. Answers are **self-describing
 * snapshots**: `field_label` + `field_type` are captured at submit time from
 * the form's live field defs, and `field_id` is **ON DELETE SET NULL** — so an
 * answer SURVIVES a later field edit or deletion as a standalone historical
 * record (owners revise forms over time; cascade-deleting answers or losing the
 * question text would be silent data loss).
 *
 * Exactly one value column is populated per answer, enforced by a CHECK:
 *  - `value_number` for `rating` (1–5, so AVG()/COUNT() are trivial later);
 *  - `value_text` for everything else. For `single_select` it holds the chosen
 *    option's LABEL (point-in-time human-readable), after the submitted option
 *    id was validated against that field's stored option ids.
 * `field_label`/`field_type` are snapshot metadata, NOT value columns, so the
 * CHECK only counts the two value columns.
 */
export const formResponseAnswers = pgTable(
  "form_response_answer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    responseId: uuid("response_id")
      .notNull()
      .references(() => formResponses.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id").references(() => formFields.id, {
      onDelete: "set null",
    }),
    fieldLabel: text("field_label").notNull(),
    fieldType: formFieldType("field_type").notNull(),
    valueText: text("value_text"),
    valueNumber: integer("value_number"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("form_response_answer_response_idx").on(t.responseId),
    index("form_response_answer_business_field_idx").on(
      t.businessId,
      t.fieldId,
    ),
    check(
      "form_response_answer_one_value",
      sql`num_nonnulls(${t.valueText}, ${t.valueNumber}) = 1`,
    ),
  ],
);

/**
 * Durable fixed-window rate-limit counter for public form submissions. Durable
 * (a table, not in-memory) for the same reason as the PIN lockout: the app runs
 * on multiple serverless instances where in-process state is unreliable.
 * `bucket_key` encodes (hashed IP + slug + window kind + window epoch), so each
 * window is its own row; `expires_at` lets old rows be ignored/swept. See
 * `src/lib/rate-limit.ts` for the limits.
 */
export const formRateLimits = pgTable("form_rate_limit", {
  bucketKey: text("bucket_key").primaryKey(),
  count: integer("count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/* -------------------------------------------------------------------------- */
/* Google Drive document storage (Phase 1)                                    */
/*                                                                            */
/* The owner connects their OWN Google Drive as an ADDITIONAL authorization   */
/* (drive.file scope) — this is NOT a sign-in method. Files live in the       */
/* owner's Drive; we store only a reference. OAuth tokens are stored          */
/* AES-256-GCM encrypted (src/lib/crypto.ts); we never persist file bytes.    */
/* -------------------------------------------------------------------------- */

export const googleDriveConnections = pgTable(
  "google_drive_connection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // One connection per business (UNIQUE) — the owner's single linked Drive.
    businessId: uuid("business_id")
      .notNull()
      .unique()
      .references(() => businesses.id, { onDelete: "cascade" }),
    // Which Google account is connected — display only.
    googleAccountEmail: text("google_account_email").notNull(),
    // OAuth tokens, AES-256-GCM encrypted at rest. Never sent to the client,
    // never logged.
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    tokenExpiry: timestamp("token_expiry", { withTimezone: true }).notNull(),
    // The Drive folder id the app created to hold this business's documents.
    rootFolderId: text("root_folder_id"),
    // Set true when a refresh fails (revoked/invalid_grant); the owner is shown
    // a "reconnect Google Drive" prompt instead of a crash.
    needsReconnect: boolean("needs_reconnect").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("google_drive_connection_business_idx").on(t.businessId)],
);

export const staffDocuments = pgTable(
  "staff_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    staffMemberId: uuid("staff_member_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    // Optional owner-chosen label (Contract / RSA / ID / Other) — free text.
    docType: text("doc_type"),
    // The file's identity in the owner's Drive — we store only the reference.
    driveFileId: text("drive_file_id").notNull(),
    driveWebLink: text("drive_web_link").notNull(),
    mimeType: text("mime_type").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("staff_document_business_idx").on(t.businessId),
    index("staff_document_business_staff_idx").on(
      t.businessId,
      t.staffMemberId,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Xero Payroll AU integration                                                */
/*                                                                            */
/* Owner connects their business's Xero org (Payroll module) so approved      */
/* hours can be pushed to Xero as DRAFT timesheets. See                       */
/* docs/xero-payroll-integration-plan.md. HARD BOUNDARY: draft timesheets     */
/* only, from approved hours only; the app has NO pay-run capability (no code, */
/* no `payroll.payruns` scope) and only READ access to employees (no bank/tax/ */
/* super writes). A human always finalises pay inside Xero.                   */
/* -------------------------------------------------------------------------- */

// A connection is stored inactive (pending_confirmation) until the OWNER
// confirms the connected org's name — the catch for a delegated-link that
// connected the wrong org. Only `active` connections are eligible to push.
export const xeroConnectionStatus = pgEnum("xero_connection_status", [
  "pending_confirmation",
  "active",
]);

// The lifecycle of one pushed DRAFT timesheet, from Roster's side.
export const xeroPushStatus = pgEnum("xero_push_status", [
  "draft",
  "failed",
  "cancelled",
]);

/**
 * One Xero connection per business (UNIQUE `business_id`, cascade). Mirrors
 * `google_drive_connection`: OAuth tokens AES-256-GCM encrypted at rest (never
 * plaintext, never sent to the client, never logged), refreshed via
 * `token_expiry`, `needs_reconnect` set on `invalid_grant`. `status` gates
 * eligibility — a push is refused unless `active`. Audit columns record who/
 * how the connection was made (incl. via a delegated bookkeeper invite) and who
 * confirmed it. `payroll.payruns` is never requested; `authorised_scopes` is
 * recorded for audit of exactly what was granted.
 */
export const xeroConnections = pgTable(
  "xero_connection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .unique()
      .references(() => businesses.id, { onDelete: "cascade" }),
    // The connected Xero organisation (tenant) + display fields.
    xeroTenantId: text("xero_tenant_id").notNull(),
    orgName: text("org_name").notNull(),
    connectedAccountEmail: text("connected_account_email").notNull(),
    // OAuth tokens — AES-256-GCM ciphertext ONLY. Never plaintext/logged.
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    tokenExpiry: timestamp("token_expiry", { withTimezone: true }).notNull(),
    // Exactly which scopes Xero granted — recorded so we can audit that
    // `payroll.payruns` was never among them.
    authorisedScopes: text("authorised_scopes"),
    needsReconnect: boolean("needs_reconnect").notNull().default(false),
    status: xeroConnectionStatus("status")
      .notNull()
      .default("pending_confirmation"),
    // Audit: how the connection was established. `connected_via_invite_id` is a
    // soft reference to xero_connect_invite (the delegated bookkeeper link).
    // IP/user-agent are captured at the OAuth callback for security audit.
    connectedViaInviteId: uuid("connected_via_invite_id"),
    connectedIp: text("connected_ip"),
    connectedUserAgent: text("connected_user_agent"),
    // Who activated it (the owner confirming the org name) and when.
    confirmedByUserId: text("confirmed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("xero_connection_business_idx").on(t.businessId)],
);

/**
 * Maps a Roster staff member to a Xero employee (pull-and-confirm; never a
 * silent guess). `earnings_rate_id` is the ordinary earnings rate for their
 * timesheet lines (auto-resolved from the employee's pay template, owner-
 * editable); null means unresolved → that person is blocked from push.
 * `payroll_calendar_id` is snapshotted so the push period aligns to how Xero
 * will pay them. One mapping per staff member per business.
 */
export const xeroEmployeeMaps = pgTable(
  "xero_employee_map",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    staffMemberId: uuid("staff_member_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    xeroEmployeeId: text("xero_employee_id").notNull(),
    xeroEmployeeName: text("xero_employee_name").notNull(),
    earningsRateId: text("earnings_rate_id"),
    payrollCalendarId: text("payroll_calendar_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("xero_employee_map_business_staff_unique").on(
      t.businessId,
      t.staffMemberId,
    ),
    index("xero_employee_map_business_idx").on(t.businessId),
  ],
);

/**
 * Audit + idempotency record of one DRAFT timesheet pushed to Xero, per staff
 * member per calendar-aligned period. The UNIQUE `(business_id, staff_member_id,
 * period_start, period_end)` is the durable long-window de-dupe guard behind
 * Xero's own `Idempotency-Key` (which has a short retention). `idempotency_key`
 * is the deterministic key sent to Xero; `payload_hash` detects whether the
 * pushed hours changed since last time.
 */
export const xeroTimesheetPushes = pgTable(
  "xero_timesheet_push",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    staffMemberId: uuid("staff_member_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    xeroEmployeeId: text("xero_employee_id").notNull(),
    // Inclusive calendar-aligned period (YYYY-MM-DD), derived from the
    // employee's Xero payroll calendar — never an arbitrary owner date range.
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    // The Xero timesheet id once created; null while a push is `failed`.
    xeroTimesheetId: text("xero_timesheet_id"),
    status: xeroPushStatus("status").notNull().default("draft"),
    hoursTotal: doublePrecision("hours_total").notNull(),
    payloadHash: text("payload_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    // Monotonic push-attempt counter. The Xero Idempotency-Key is derived as
    // (deterministic base + ":attempt=" + attempt), incremented on every
    // delete-then-recreate cycle so a replay after a delete can NEVER return
    // Xero's cached response for the now-deleted timesheet. A network retry of
    // the SAME attempt reuses the same key (safe de-dupe); a new cycle varies it.
    attempt: integer("attempt").notNull().default(1),
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("xero_timesheet_push_period_unique").on(
      t.businessId,
      t.staffMemberId,
      t.periodStart,
      t.periodEnd,
    ),
    index("xero_timesheet_push_business_idx").on(t.businessId),
  ],
);

/**
 * A delegated, single-use "Connect Xero" link the OWNER mints and emails to a
 * bookkeeper/accountant (who must be a Xero payroll administrator to authorise).
 * Only the SHA-256 `token_hash` is stored (like the kiosk/notices links); the
 * raw token lives in the emailed link. Single-use (`consumed_at`), 72h expiry,
 * revocable (`revoked_at`). Consumption is a SINGLE atomic UPDATE in the OAuth
 * callback (…WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at >
 * now() RETURNING id) so a mid-flow revoke stops completion and two concurrent
 * completions can't both succeed. IP/user-agent + the sent-to email are recorded
 * for security audit.
 */
export const xeroConnectInvites = pgTable(
  "xero_connect_invite",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    sentToEmail: text("sent_to_email").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedIp: text("consumed_ip"),
    consumedUserAgent: text("consumed_user_agent"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("xero_connect_invite_business_idx").on(t.businessId)],
);

// The five mechanical condition shapes an owner can pick for a pay rule.
export const payRuleConditionType = pgEnum("pay_rule_condition_type", [
  "day_of_week",
  "time_of_day_after",
  "time_of_day_before",
  "daily_hours_beyond",
  "weekly_hours_beyond",
]);

/**
 * One OWNER-AUTHORED pay-classification rule: a mechanical condition
 * (`condition_type` + zod-validated `condition_config`) mapping matched hours
 * to ONE of the owner's OWN Xero pay items (`earnings_rate_id` — a reference;
 * `earnings_rate_name` is a display snapshot). `priority` is the owner-visible
 * precedence — lower evaluates first, first match wins per sub-block.
 *
 * THE BOUNDARY: this table deliberately has NO rate, multiplier, percentage or
 * dollar column, ships EMPTY (no seed, no defaults), and Roster ships zero
 * built-in award rules. All pay math lives in the Xero pay item the owner
 * points at. Rows are business-scoped and only ever written through the
 * owner's tenant-scoped, zod-validated actions.
 */
export const payRules = pgTable(
  "pay_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priority: integer("priority").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    conditionType: payRuleConditionType("condition_type").notNull(),
    // Per-type config WITHOUT the type (the enum column carries it):
    // day_of_week → {days: number[]} (ISO 1–7); time_of_day_* → {time: "HH:MM"};
    // daily/weekly_hours_beyond → {hours: number}.
    conditionConfig: jsonb("condition_config").notNull(),
    earningsRateId: text("earnings_rate_id").notNull(),
    earningsRateName: text("earnings_rate_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("pay_rule_business_idx").on(t.businessId),
    index("pay_rule_business_priority_idx").on(t.businessId, t.priority),
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

export const notificationsRelations = relations(notifications, ({ one }) => ({
  business: one(businesses, {
    fields: [notifications.businessId],
    references: [businesses.id],
  }),
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

export const formsRelations = relations(forms, ({ one, many }) => ({
  business: one(businesses, {
    fields: [forms.businessId],
    references: [businesses.id],
  }),
  fields: many(formFields),
}));

export const formFieldsRelations = relations(formFields, ({ one }) => ({
  business: one(businesses, {
    fields: [formFields.businessId],
    references: [businesses.id],
  }),
  form: one(forms, {
    fields: [formFields.formId],
    references: [forms.id],
  }),
}));

export const formResponsesRelations = relations(
  formResponses,
  ({ one, many }) => ({
    business: one(businesses, {
      fields: [formResponses.businessId],
      references: [businesses.id],
    }),
    form: one(forms, {
      fields: [formResponses.formId],
      references: [forms.id],
    }),
    // Phase 2 — the attributed staff member (internal channel). Null for public
    // and anonymous internal responses.
    respondent: one(staffMembers, {
      fields: [formResponses.respondentStaffId],
      references: [staffMembers.id],
    }),
    answers: many(formResponseAnswers),
  }),
);

export const formResponseAnswersRelations = relations(
  formResponseAnswers,
  ({ one }) => ({
    business: one(businesses, {
      fields: [formResponseAnswers.businessId],
      references: [businesses.id],
    }),
    response: one(formResponses, {
      fields: [formResponseAnswers.responseId],
      references: [formResponses.id],
    }),
    field: one(formFields, {
      fields: [formResponseAnswers.fieldId],
      references: [formFields.id],
    }),
  }),
);
