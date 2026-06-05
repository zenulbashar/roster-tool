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
