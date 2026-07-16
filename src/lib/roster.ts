import { eachDate, isoWeekday } from "@/lib/time";

export type TemplateLike = {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  weekdays: number[];
  /**
   * Optional per-weekday time overrides, keyed by ISO weekday ("1".."7"). A day
   * present here uses its own start/end; any other day uses the default
   * startTime/endTime above.
   */
  dayTimeOverrides?: Record<string, { start: string; end: string }> | null;
  /** How many people each instance of this shift needs (default 1). */
  requiredStaff?: number;
};

export type GeneratedShift = {
  templateId: string;
  date: string;
  label: string;
  startTime: string;
  endTime: string;
  requiredStaff: number;
};

/**
 * Expand a business's shift templates into concrete shifts across every day in
 * a roster period. A template contributes a shift on a given day only if that
 * day's ISO weekday is in its `weekdays`. Pure and order-stable so it's easy to
 * test and reason about.
 */
export function expandTemplatesToShifts(
  period: { startDate: string; endDate: string },
  templates: TemplateLike[],
): GeneratedShift[] {
  return eachDate(period.startDate, period.endDate).flatMap((date) => {
    const wd = isoWeekday(date);
    return templates
      .filter((t) => t.weekdays.includes(wd))
      .map((t) => {
        // Use this weekday's override if the type has one, else the default.
        const override = t.dayTimeOverrides?.[String(wd)];
        return {
          templateId: t.id,
          date,
          label: t.label,
          startTime: override?.start ?? t.startTime,
          endTime: override?.end ?? t.endTime,
          // Snapshot the staffing target (like label/times) so later template
          // edits don't rewrite existing rosters.
          requiredStaff: t.requiredStaff ?? 1,
        };
      });
  });
}
