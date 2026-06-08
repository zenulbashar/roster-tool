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
