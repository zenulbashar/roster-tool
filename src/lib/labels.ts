/** Friendly, non-technical labels for roster period status. */
export const PERIOD_STATUS_LABEL: Record<string, string> = {
  draft: "Not started",
  collecting: "Asking for availability",
  building: "Building roster",
  published: "Published",
};

export function periodStatusLabel(status: string): string {
  return PERIOD_STATUS_LABEL[status] ?? status;
}

/**
 * Label for the roster-builder call-to-action. Once a roster is published it's
 * already built and emailed, so "Build the roster" is misleading — show an
 * "edit" wording instead. The destination is unchanged either way.
 */
export function rosterActionLabel(status: string): string {
  return status === "published" ? "Edit roster" : "Build the roster";
}

/** Verb prefix for the builder page heading ("Build:"/"Edit:" + label). */
export function rosterBuildVerb(status: string): string {
  return status === "published" ? "Edit" : "Build";
}

/** Friendly label for a leave type, used in the owner UI and decision emails. */
export const LEAVE_TYPE_LABEL: Record<string, string> = {
  annual: "Annual leave",
  sick: "Sick leave",
  unpaid: "Unpaid leave",
  other: "Leave",
};

export function leaveTypeLabel(type: string): string {
  return LEAVE_TYPE_LABEL[type] ?? "Leave";
}

/**
 * Short labels for ISO weekday numbers (1=Mon … 7=Sun), the convention used by
 * `shift_template.weekdays` and `supplier.delivery_days`.
 */
export const WEEKDAY_SHORT_LABEL: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

/** A sorted "Mon, Wed, Fri" summary of ISO weekday numbers (empty → "—"). */
export function weekdaysLabel(days: number[]): string {
  if (!days || days.length === 0) return "—";
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_SHORT_LABEL[d] ?? String(d))
    .join(", ");
}

/** Friendly labels for an item's stock status (owner UI + staff form). */
export const STOCK_STATUS_LABEL: Record<string, string> = {
  available: "In stock",
  low: "Running low",
  needs_order: "Needs ordering",
};

export function stockStatusLabel(status: string | null | undefined): string {
  if (!status) return "Not checked yet";
  return STOCK_STATUS_LABEL[status] ?? status;
}

/** Friendly label for a certification type. */
export const CERT_TYPE_LABEL: Record<string, string> = {
  rsa: "RSA",
  rsg: "RSG",
  food_safety: "Food Safety",
  first_aid: "First Aid",
  wwcc: "Working with Children Check",
  other: "Other",
};

export function certTypeLabel(type: string): string {
  return CERT_TYPE_LABEL[type] ?? "Certification";
}

/**
 * How a certification reads in the UI/email. For `other` the free label is the
 * name; otherwise the type name, with the optional label appended.
 */
export function certDisplayLabel(
  type: string,
  label: string | null | undefined,
): string {
  const trimmed = label?.trim();
  if (type === "other")
    return trimmed && trimmed.length > 0 ? trimmed : "Other";
  return trimmed && trimmed.length > 0
    ? `${certTypeLabel(type)} — ${trimmed}`
    : certTypeLabel(type);
}
