import { z } from "zod";
import { SHIFT_COLOR_VALUES } from "@/lib/shift-colors";

/** Shared input validation. Every server action validates with these. */

export const staffSchema = z.object({
  name: z.string().trim().min(1, "Please enter a name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  // Optional free-text position label (Barista / Chef / Floor / Manager …).
  // Empty/absent normalises to null. Informational only — never gates rostering.
  role: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00");

/**
 * Optional shift-type colour: a bar hex from the fixed SHIFT_PALETTE, or null
 * when the owner leaves it unset (→ keyword-derived fallback). An empty/absent
 * value normalises to null; any other value must be a known palette colour.
 */
export const shiftColorSchema = z
  .union([z.string(), z.undefined(), z.null()])
  .transform((v) => (typeof v === "string" && v.length > 0 ? v : null))
  .refine((v) => v === null || SHIFT_COLOR_VALUES.includes(v), {
    message: "Pick a colour from the palette",
  });

/**
 * Allowed unpaid-break lengths (minutes) an owner can record on a timesheet
 * entry: none, 30 minutes, or 1 hour. Stored as integer minutes so a custom
 * value could be added later without a migration. NOT a payroll calculation —
 * the break just refines net worked hours.
 */
export const ALLOWED_BREAK_MINUTES = [0, 30, 60] as const;

export const breakMinutesSchema = z.coerce
  .number()
  .int()
  .refine((n) => (ALLOWED_BREAK_MINUTES as readonly number[]).includes(n), {
    message: "Pick a break of none, 30 minutes, or 1 hour",
  });

/**
 * A per-assignment schedule from the roster builder's editor: same-day times
 * plus an optional unpaid break. Shape only — the deep rules (span length,
 * break fits inside the times) live in the pure validateSchedule
 * (src/lib/assignment-schedule.ts), which the server action runs after this.
 */
export const assignmentScheduleSchema = z.object({
  shiftId: z.string().uuid(),
  staffMemberId: z.string().uuid(),
  startTime: hhmm,
  endTime: hhmm,
  breakMinutes: z.coerce.number().int().min(0).max(240),
  breakStart: z
    .union([hhmm, z.literal(""), z.null(), z.undefined()])
    .transform((v) => (v ? v : null)),
});

/**
 * A drag-and-drop move from the roster board. The target is either an exact
 * shift (dropped on an existing block) or a (staff, date) cell — the action
 * resolves the cell to a matching shift, cloning the source block onto the
 * date when none exists.
 */
export const assignmentMoveSchema = z.object({
  fromShiftId: z.string().uuid(),
  staffMemberId: z.string().uuid(),
  toStaffMemberId: z.string().uuid().nullable().optional(),
  toShiftId: z.string().uuid().nullable().optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

/** A (shift, staff) pair from the roster board (unassign, accept, clear). */
export const assignmentPairSchema = z.object({
  shiftId: z.string().uuid(),
  staffMemberId: z.string().uuid(),
});

/** An open-shift drop from the roster board: assign, optionally to a day. */
export const openShiftAssignSchema = z.object({
  shiftId: z.string().uuid(),
  staffMemberId: z.string().uuid(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

/**
 * One per-day time override: a start/end pair. An end at or before the start
 * means the shift finishes the NEXT day (overnight, M34); only identical
 * times are rejected (a zero-length shift is always a typo).
 */
export const dayTimeOverrideSchema = z
  .object({ start: hhmm, end: hhmm })
  .refine((o) => o.start !== o.end, {
    message: "A shift can't start and end at the same time",
    path: ["end"],
  });

/**
 * Optional per-weekday time overrides, keyed by ISO weekday ("1".."7"). Empty
 * or absent normalises to null (every day uses the type's default time).
 * NOTE: partialRecord, not record — zod v4 makes enum-keyed records
 * EXHAUSTIVE (all seven keys required), which would reject the normal
 * "only Friday differs" map.
 */
export const dayTimeOverridesSchema = z
  .union([
    z.partialRecord(
      z.enum(["1", "2", "3", "4", "5", "6", "7"]),
      dayTimeOverrideSchema,
    ),
    z.null(),
    z.undefined(),
  ])
  .transform((v) => (v && Object.keys(v).length > 0 ? v : null));

/**
 * Optional per-weekday STAFFING overrides, keyed by ISO weekday ("1".."7") →
 * how many people that day needs ("Friday needs 4"). Empty or absent
 * normalises to null (every day uses the type's default target). Mirrors
 * dayTimeOverridesSchema (incl. the partialRecord note above).
 */
export const dayStaffOverridesSchema = z
  .union([
    z.partialRecord(
      z.enum(["1", "2", "3", "4", "5", "6", "7"]),
      z.coerce.number().int().min(1).max(20),
    ),
    z.null(),
    z.undefined(),
  ])
  .transform((v) => (v && Object.keys(v).length > 0 ? v : null));

/**
 * How many people a shift needs — a staffing TARGET the builder flags
 * against, never a hard block. 1–20 covers any small-venue crew.
 */
export const requiredStaffSchema = z.coerce
  .number()
  .int()
  .min(1, "A shift needs at least one person")
  .max(20, "That's more people than a small venue rosters on one shift");

/** The builder's per-shift "needs N people" adjustment. */
export const shiftRequiredStaffSchema = z.object({
  shiftId: z.string().uuid(),
  requiredStaff: requiredStaffSchema,
});

export const templateSchema = z
  .object({
    label: z.string().trim().min(1, "Please enter a name").max(80),
    startTime: hhmm,
    endTime: hhmm,
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1, "Pick at least one day"),
    color: shiftColorSchema,
    dayTimeOverrides: dayTimeOverridesSchema,
    requiredStaff: requiredStaffSchema,
    dayStaffOverrides: dayStaffOverridesSchema,
  })
  // An end at or before the start = the shift finishes the NEXT day
  // (overnight, M34 — "6 pm – 2 am"). Only identical times are rejected.
  .refine((t) => t.startTime !== t.endTime, {
    message: "A shift can't start and end at the same time",
    path: ["endTime"],
  });

export const periodSchema = z
  .object({
    label: z.string().trim().min(1, "Please give this period a name").max(120),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date"),
  })
  .refine((p) => p.startDate <= p.endDate, {
    message: "End date can't be before the start date",
    path: ["endDate"],
  });

/** A four-digit kiosk PIN. */
export const pinSchema = z
  .string()
  .regex(/^\d{4}$/, "Enter a 4-digit PIN (numbers only)");

/* ----- Location / geofence ----- */

/** A latitude/longitude pair in decimal degrees (WGS84). */
export const coordinatesSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export type Coordinates = z.infer<typeof coordinatesSchema>;

/** Allowed geofence radii (metres) the owner can pick; 200 is the default. */
export const GEOFENCE_RADIUS_OPTIONS = [100, 200, 500] as const;
export const DEFAULT_GEOFENCE_RADIUS_M = 200;

export function parseGeofenceRadius(value: unknown): number | null {
  const n = Number(value);
  return (GEOFENCE_RADIUS_OPTIONS as readonly number[]).includes(n) ? n : null;
}

/** The owner-set shop location. Both coordinates and a chosen radius. */
export const businessLocationSchema = coordinatesSchema.extend({
  geofenceRadiusM: z
    .number()
    .refine((n) => parseGeofenceRadius(n) !== null, "Pick a valid radius"),
});

/* ----- Pay rates (stored number + label only; no wage calculation) ----- */

export const rateTypeSchema = z.enum(["flat", "award"]);
export type RateType = z.infer<typeof rateTypeSchema>;

/**
 * Per-employee hourly rate the owner types, in DOLLARS. We store cents.
 * Capped well above any realistic hourly rate to catch fat-finger input.
 */
export const payRateSchema = z.object({
  rateType: rateTypeSchema,
  // Dollars as typed; "" / absent means "clear the rate".
  rateDollars: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || /^\d{1,4}(\.\d{1,2})?$/.test(v),
      "Enter an amount like 28.50",
    ),
  rateLabel: z.string().trim().max(80).optional(),
});

/* ----- Leave requests (record only; no balances/accruals/award calc) ----- */

export const leaveTypeSchema = z.enum(["annual", "sick", "unpaid", "other"]);
export type LeaveType = z.infer<typeof leaveTypeSchema>;

/**
 * A leave request's fields, shared by staff submission and owner entry. Dates
 * are calendar dates ("YYYY-MM-DD"); the note is optional and length-capped.
 * The PIN (staff submission) is validated separately with `pinSchema`.
 */
export const leaveRequestSchema = z
  .object({
    leaveType: leaveTypeSchema,
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date"),
    note: z.string().trim().max(500).optional(),
  })
  .refine((l) => l.startDate <= l.endDate, {
    message: "End date can't be before the start date",
    path: ["endDate"],
  });

export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;

/* ----- Certifications (text + dates only; flagged, never enforced) ----- */

export const certTypeSchema = z.enum([
  "rsa",
  "rsg",
  "food_safety",
  "first_aid",
  "wwcc",
  "other",
]);
export type CertTypeInput = z.infer<typeof certTypeSchema>;

/**
 * A certification's fields. A label is REQUIRED when the type is `other`
 * (otherwise optional). Expiry is a calendar date; no document is uploaded.
 */
export const certificationSchema = z
  .object({
    certType: certTypeSchema,
    certLabel: z.string().trim().max(120).optional(),
    referenceNumber: z.string().trim().max(120).optional(),
    expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an expiry date"),
  })
  .refine(
    (c) => c.certType !== "other" || !!(c.certLabel && c.certLabel.length > 0),
    { message: "Enter a name for this certification", path: ["certLabel"] },
  );

export type CertificationInput = z.infer<typeof certificationSchema>;

/** Allowed reminder lead times (days before expiry) the owner can pick. */
export const CERT_LEAD_DAYS_OPTIONS = [30, 60, 90] as const;
export const DEFAULT_CERT_LEAD_DAYS = 30;

export function parseCertLeadDays(value: unknown): number | null {
  const n = Number(value);
  return (CERT_LEAD_DAYS_OPTIONS as readonly number[]).includes(n) ? n : null;
}

/** Cap on a clock-in/out photo once decoded from its data URL. */
export const MAX_CLOCK_PHOTO_BYTES = 500_000;

/**
 * A clock photo arrives as a base64 JPEG/PNG data URL from the kiosk camera.
 * Returns the decoded bytes + mime, or null if it's absent/oversized/malformed
 * (the photo is best-effort, so callers treat null as "no photo").
 */
export function parseClockPhoto(
  value: FormDataEntryValue | null,
): { mimeType: string; data: Buffer } | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const match = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(value);
  if (!match) return null;
  const data = Buffer.from(match[2]!, "base64");
  if (data.length === 0 || data.length > MAX_CLOCK_PHOTO_BYTES) return null;
  return { mimeType: match[1]!, data };
}

/* ----- Suppliers & items (inventory Part 1; tracking only, no ordering) --- */

/** ISO weekday numbers (1=Mon … 7=Sun), the order shown in the UI. */
export const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;

const weekdaySchema = z.coerce.number().int().min(1).max(7);

/**
 * A supplier's fields. Delivery days are ISO weekday numbers (may be empty).
 * `orderCutoffDaysBefore` is stored now for the Part 2 reminder job; it has no
 * effect in this build. Contact/email/phone/notes are optional.
 */
export const supplierSchema = z.object({
  name: z.string().trim().min(1, "Please enter a supplier name").max(120),
  contactName: z.string().trim().max(120).optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email")
    .max(200)
    .optional()
    .or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  deliveryDays: z.array(weekdaySchema).max(7),
  orderCutoffDaysBefore: z.coerce
    .number()
    .int()
    .min(0, "Use 0 or more days")
    .max(30, "That's too many days"),
  notes: z.string().trim().max(1000).optional(),
});

export type SupplierInput = z.infer<typeof supplierSchema>;

/**
 * An item / SKU's fields. Only the name is required; SKU code and unit are free
 * text. `supplierId` is an existing supplier's id or null (validated against the
 * business in the repo, never trusted from the client alone). `isActive` lets an
 * owner retire an item without deleting it.
 */
export const itemSchema = z.object({
  name: z.string().trim().min(1, "Please enter an item name").max(200),
  skuCode: z.string().trim().max(80).optional(),
  unit: z.string().trim().max(40).optional(),
  supplierId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

export type ItemInput = z.infer<typeof itemSchema>;

/* ----- Stock checks (inventory Part 2; flagged/reminders only) ----- */

/**
 * An item's stock status. A `safeParse` failure is how the staff form's "leave
 * unchanged" (empty) option and any bad value are skipped, so keep this a plain
 * enum with no coercion.
 */
export const stockStatusSchema = z.enum(["available", "low", "needs_order"]);
export type StockStatusInput = z.infer<typeof stockStatusSchema>;

/** Owner manual stock override: an item id plus a status (quantity optional). */
export const stockOverrideSchema = z.object({
  itemId: z.string().uuid(),
  status: stockStatusSchema,
  quantity: z.string().trim().max(40).optional(),
});

/* ----- Form builder (custom forms — Phase 1a: builder CRUD only) ----- */

/**
 * The v1 custom-form field types (closed set, mirrors the `form_field_type`
 * pgEnum). Exported so the client type selector and the server validation share
 * one source of truth.
 */
export const FORM_FIELD_TYPES = [
  "short_text",
  "long_text",
  "rating",
  "single_select",
  "yes_no",
] as const;

export const formFieldTypeSchema = z.enum(FORM_FIELD_TYPES);
export type FormFieldTypeInput = z.infer<typeof formFieldTypeSchema>;

/**
 * A single_select option. `id` is optional on input: existing options carry
 * their stable id (preserved on save), new options omit it and the repo
 * generates one server-side. `label` allows empty at parse so a half-filled
 * option on a NON-single_select field never blocks a save; emptiness is judged
 * in the single_select refinement below and blanks are dropped on transform.
 */
export const formFieldOptionSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().max(100),
});
export type FormFieldOptionInput = z.infer<typeof formFieldOptionSchema>;

/**
 * One field in a save payload. `id` is the existing field id OR a client temp
 * id (any string); the repo decides insert-vs-update by checking ownership, and
 * a temp/forged id is NEVER used as a primary key (inserts always DB-generate).
 *
 * Refinement + transform enforce the options rule: `single_select` needs at
 * least one non-empty option (the UI nudges 2+); every other type ignores
 * options entirely (forced to `[]`), so stray client options can't error or be
 * stored. single_select blanks are dropped, keeping stored options clean.
 */
export const formFieldSchema = z
  .object({
    id: z.string().optional(),
    label: z.string().trim().min(1, "Please give the field a label").max(100),
    type: formFieldTypeSchema,
    required: z.boolean().optional().default(false),
    options: z.array(formFieldOptionSchema).max(50).optional().default([]),
  })
  .superRefine((field, ctx) => {
    if (
      field.type === "single_select" &&
      field.options.filter((o) => o.label.length > 0).length < 1
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Add at least one option for a choice field",
      });
    }
  })
  .transform((field) => ({
    ...field,
    options:
      field.type === "single_select"
        ? field.options.filter((o) => o.label.length > 0)
        : [],
  }));
export type FormFieldInput = z.infer<typeof formFieldSchema>;

/**
 * Title-only payload for creating a form. A title is always supplied at
 * creation (no "Untitled" placeholder); it is editable thereafter via
 * `formSaveSchema`. Same title rule as the full save.
 */
export const createFormSchema = z.object({
  title: z.string().trim().min(1, "Please enter a form title").max(200),
});
export type CreateFormInput = z.infer<typeof createFormSchema>;

/**
 * The whole-form transactional save: title + optional description + the ordered
 * fields array. A zero-field form is valid (a draft mid-build). Positions are
 * derived from array order in the repo, not trusted from the client.
 */
export const formSaveSchema = z.object({
  title: z.string().trim().min(1, "Please enter a form title").max(200),
  description: z.string().trim().max(2000).optional(),
  fields: z.array(formFieldSchema).max(100, "That's too many fields"),
});
export type FormSaveInput = z.infer<typeof formSaveSchema>;

export type StaffInput = z.infer<typeof staffSchema>;
export type TemplateInput = z.infer<typeof templateSchema>;
export type PeriodInput = z.infer<typeof periodSchema>;
