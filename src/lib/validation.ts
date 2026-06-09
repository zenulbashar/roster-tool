import { z } from "zod";

/** Shared input validation. Every server action validates with these. */

export const staffSchema = z.object({
  name: z.string().trim().min(1, "Please enter a name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
});

const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00");

export const templateSchema = z
  .object({
    label: z.string().trim().min(1, "Please enter a name").max(80),
    startTime: hhmm,
    endTime: hhmm,
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1, "Pick at least one day"),
  })
  .refine((t) => t.startTime < t.endTime, {
    message: "End time must be after start time",
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

export type StaffInput = z.infer<typeof staffSchema>;
export type TemplateInput = z.infer<typeof templateSchema>;
export type PeriodInput = z.infer<typeof periodSchema>;
