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

export type StaffInput = z.infer<typeof staffSchema>;
export type TemplateInput = z.infer<typeof templateSchema>;
export type PeriodInput = z.infer<typeof periodSchema>;
