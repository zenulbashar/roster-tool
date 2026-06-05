import { eachDate, isoWeekday } from "@/lib/time";

export type TemplateLike = {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  weekdays: number[];
};

export type GeneratedShift = {
  templateId: string;
  date: string;
  label: string;
  startTime: string;
  endTime: string;
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
      .map((t) => ({
        templateId: t.id,
        date,
        label: t.label,
        startTime: t.startTime,
        endTime: t.endTime,
      }));
  });
}
