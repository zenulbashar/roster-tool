import { formatDateTime } from "@/lib/time";
import { humanizeAction } from "./events";

/**
 * Plain-language lines for an audit event — the timesheet history panel and
 * the owner's activity page. Pure: takes the stored event, returns text.
 */

export interface DescribableEvent {
  action: string;
  entity: string | null;
  args: unknown;
  before: unknown;
  after: unknown;
  outcome: "ok" | "error";
  error: string | null;
  actorLabel: string;
  actorType: "owner" | "admin" | "staff" | "system";
  impersonatorUserId: string | null;
  createdAt: Date;
}

const TIMESHEET_ACTIONS: Record<string, string> = {
  updateEntry: "Edited the times",
  setEntryApproved: "Changed approval",
  deleteEntry: "Deleted the entry",
  restoreEntry: "Restored the entry",
  clockOut: "Clocked out",
};

function field(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object"
    ? (obj as Record<string, unknown>)[key]
    : undefined;
}

function fmtInstant(value: unknown, tz: string): string {
  if (typeof value !== "string" && !(value instanceof Date)) return "—";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : formatDateTime(d, tz);
}

/** Who did it, for display: "jane@cafe.test" / "Priya (Zale IT)". */
export function describeActor(e: DescribableEvent): string {
  if (e.actorType === "admin" || e.impersonatorUserId) {
    return `${e.actorLabel} (Zale IT)`;
  }
  if (e.actorType === "system") return "Roster (automatic)";
  return e.actorLabel;
}

/**
 * One timesheet event as "what changed": the headline verb plus the
 * before → after of the fields that moved (clock in, clock out, break,
 * approval, deleted/restored). Unknown shapes fall back to the verb.
 */
export function describeTimesheetEvent(
  e: DescribableEvent,
  tz: string,
): { headline: string; changes: string[]; when: string; who: string } {
  const headline = TIMESHEET_ACTIONS[e.action] ?? humanizeAction(e.action);
  const when = formatDateTime(e.createdAt, tz);
  const who = describeActor(e);
  if (e.outcome === "error") {
    return { headline: `${headline} — failed`, changes: [], when, who };
  }
  const changes: string[] = [];
  const before = e.before;
  const after = e.after;

  if (e.action === "setEntryApproved") {
    const approved = Array.isArray(e.args) ? e.args[1] : undefined;
    changes.push(
      approved === true
        ? "Approved for payroll"
        : approved === false
          ? "Approval removed"
          : "Approval changed",
    );
    return { headline, changes, when, who };
  }

  if (before && after) {
    const b = field(before, "clockInAt");
    const a = field(after, "clockInAt");
    if (b !== undefined && a !== undefined && String(b) !== String(a)) {
      changes.push(`Clock in: ${fmtInstant(b, tz)} → ${fmtInstant(a, tz)}`);
    }
    const bo = field(before, "clockOutAt");
    const ao = field(after, "clockOutAt");
    if (bo !== undefined && ao !== undefined && String(bo) !== String(ao)) {
      changes.push(`Clock out: ${fmtInstant(bo, tz)} → ${fmtInstant(ao, tz)}`);
    }
    const bb = field(before, "breakMinutes");
    const ab = field(after, "breakMinutes");
    if (bb !== undefined && ab !== undefined && bb !== ab) {
      changes.push(`Break: ${String(bb)} min → ${String(ab)} min`);
    }
  }
  if (e.action === "updateEntry" && changes.length === 0) {
    changes.push("Saved with no changes");
  }
  return { headline, changes, when, who };
}

/** A generic one-liner for the activity page. */
export function describeEvent(e: DescribableEvent): string {
  const verb = TIMESHEET_ACTIONS[e.action] ?? humanizeAction(e.action);
  const what = e.entity ? ` · ${e.entity.replaceAll("_", " ")}` : "";
  return e.outcome === "error" ? `${verb}${what} — failed` : `${verb}${what}`;
}
