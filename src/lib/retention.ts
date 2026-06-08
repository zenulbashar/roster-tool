/**
 * Clock-in photo retention policy.
 *
 * Photo retention is ALWAYS on; the owner only chooses how long photos are
 * kept. The daily retention job deletes `clock_photo` rows whose parent
 * timesheet entry's clock-in is older than the cutoff — never the timesheet
 * entry itself (hours are preserved). All maths is in UTC.
 */

/** The only retention periods an owner may pick, in days. */
export const PHOTO_RETENTION_DAYS = [7, 30, 90] as const;

export type PhotoRetentionDays = (typeof PHOTO_RETENTION_DAYS)[number];

/** Default applied to new businesses and the DB column default. */
export const DEFAULT_PHOTO_RETENTION_DAYS: PhotoRetentionDays = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Narrow an arbitrary number to an allowed retention period, else null. */
export function parsePhotoRetentionDays(
  value: unknown,
): PhotoRetentionDays | null {
  return PHOTO_RETENTION_DAYS.includes(value as PhotoRetentionDays)
    ? (value as PhotoRetentionDays)
    : null;
}

/**
 * The instant before which photos are expired. A photo whose entry clocked in
 * strictly before this is past retention. Equivalent to `now - retentionDays`.
 */
export function photoRetentionCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * MS_PER_DAY);
}

/**
 * Whether a photo for an entry clocked in at `clockInAt` is past retention as
 * of `now`. A photo exactly at the cutoff is still kept (strict comparison).
 */
export function isPhotoExpired(
  clockInAt: Date,
  now: Date,
  retentionDays: number,
): boolean {
  return (
    clockInAt.getTime() < photoRetentionCutoff(now, retentionDays).getTime()
  );
}
