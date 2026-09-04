/**
 * Postgres error classification for application code.
 *
 * drizzle-orm (≥ 0.36) wraps a failed query in `DrizzleQueryError` and keeps
 * the driver's error as `cause`, so the SQLSTATE lives one level down —
 * checking `err.code` alone silently stopped matching when the ORM started
 * wrapping. This walks the cause chain (bounded), so callers see the same
 * answer whether the error is raw, wrapped once, or re-wrapped by a
 * transaction.
 */
const MAX_DEPTH = 5;

/** The SQLSTATE code of a database error, wherever the driver error sits. */
export function pgErrorCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < MAX_DEPTH && current; depth++) {
    if (typeof current === "object") {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return null;
}

/** `unique_violation` — a UNIQUE constraint or unique index refused the row. */
export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23505";
}

/** `foreign_key_violation` — the referenced row is gone (or never existed). */
export function isForeignKeyViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23503";
}
