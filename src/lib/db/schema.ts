import type { AdapterAccountType } from "next-auth/adapters";
import { relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  uuid,
  timestamp,
  date,
  time,
  boolean,
  integer,
  primaryKey,
  unique,
  index,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/* Tenancy root                                                               */
/* -------------------------------------------------------------------------- */

export const businesses = pgTable("business", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Australia/Sydney"),
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
    requestId: uuid("request_id")
      .notNull()
      .references(() => availabilityRequests.id, { onDelete: "cascade" }),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "cascade" }),
    available: boolean("available").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("availability_response_request_shift_unique").on(
      t.requestId,
      t.shiftId,
    ),
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
