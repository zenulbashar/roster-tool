/**
 * Pure presentation logic for the owner responses view (Phase 1c). No DB: the
 * tenant-scoped repo runs the SQL aggregation (counts, distributions, recent
 * text) and these functions shape it into per-field summaries and per-response
 * detail. READ-ONLY — no writes, no labour/award logic.
 *
 * SNAPSHOT REALITY: answers carry their own `field_label` + `field_type`
 * captured at submit, and `field_id` is null once a field is deleted. Summaries
 * therefore group by `field_id` WHEN PRESENT and fall back to the
 * `(field_label, field_type)` snapshot otherwise, so a deleted/renamed field
 * still presents correctly.
 *
 * The value column to read per type lives in ONE place — `displayAnswer` — and
 * the aggregator agrees with it: `rating` → `value_number`, everything else →
 * `value_text` (single_select/yes_no store the chosen LABEL).
 */
import type { FormFieldTypeInput } from "@/lib/validation";

export type FieldType = FormFieldTypeInput;

/** A stored answer (snapshot self-describing). */
export type StoredAnswer = {
  fieldId: string | null;
  fieldLabel: string;
  fieldType: FieldType;
  valueText: string | null;
  valueNumber: number | null;
};

/** The form's CURRENT fields (drives summary order + live labels). */
export type LiveField = {
  id: string;
  label: string;
  type: FieldType;
  position: number;
};

export type SummaryAggregateRow = {
  fieldId: string | null;
  fieldLabel: string;
  fieldType: FieldType;
  valueText: string | null;
  valueNumber: number | null;
  count: number;
};

export type RecentTextRow = {
  fieldId: string | null;
  fieldLabel: string;
  fieldType: FieldType;
  valueText: string | null;
};

type Base = {
  key: string;
  fieldId: string | null;
  label: string;
  type: FieldType;
  /** True when this field no longer exists on the live form (snapshot group). */
  deleted: boolean;
};

export type RatingSummary = Base & {
  kind: "rating";
  count: number;
  average: number | null; // null when no ratings yet
  distribution: { value: number; count: number }[]; // value 1..5
};
export type TallySummary = Base & {
  kind: "tally";
  count: number;
  tally: { value: string; count: number }[]; // desc by count
};
export type TextSummary = Base & {
  kind: "text";
  recent: string[];
};
export type FieldSummary = RatingSummary | TallySummary | TextSummary;

/**
 * The single source of truth for which stored column a field type renders from:
 * `rating` → numeric, everything else → text. Used by the per-response detail
 * (and any other answer rendering) so it can never drift from the aggregator.
 */
export function displayAnswer(answer: StoredAnswer): string | number | null {
  return answer.fieldType === "rating" ? answer.valueNumber : answer.valueText;
}

/** Group key: live field id when present, else the snapshot (label, type). */
function groupKey(
  fieldId: string | null,
  fieldLabel: string,
  fieldType: FieldType,
): string {
  return fieldId ?? `snap:${fieldLabel}:${fieldType}`;
}

function ratingSummary(base: Base, rows: SummaryAggregateRow[]): RatingSummary {
  const distribution = [1, 2, 3, 4, 5].map((value) => ({
    value,
    count: rows
      .filter((r) => r.valueNumber === value)
      .reduce((n, r) => n + r.count, 0),
  }));
  const count = distribution.reduce((n, d) => n + d.count, 0);
  const weighted = distribution.reduce((n, d) => n + d.value * d.count, 0);
  const average = count > 0 ? Math.round((weighted / count) * 100) / 100 : null;
  return { ...base, kind: "rating", count, average, distribution };
}

function tallySummary(base: Base, rows: SummaryAggregateRow[]): TallySummary {
  // Merge counts by value (a renamed field keeps one field_id but its answers
  // may carry different snapshot labels across edits).
  const byValue = new Map<string, number>();
  for (const r of rows) {
    const v = r.valueText ?? "";
    byValue.set(v, (byValue.get(v) ?? 0) + r.count);
  }
  const tally = [...byValue.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const count = tally.reduce((n, t) => n + t.count, 0);
  return { ...base, kind: "tally", count, tally };
}

function textSummary(base: Base, rows: RecentTextRow[]): TextSummary {
  const recent = rows
    .map((r) => r.valueText)
    .filter((v): v is string => v !== null);
  return { ...base, kind: "text", recent };
}

/**
 * Build the ordered per-field summaries. Live fields come first in their
 * position order (so a field with zero responses still shows, e.g. "no ratings
 * yet"); deleted fields that still have answers are appended, labelled from the
 * snapshot and flagged `deleted`.
 */
export function buildFormSummary(
  liveFields: LiveField[],
  aggregateRows: SummaryAggregateRow[],
  recentText: RecentTextRow[],
): FieldSummary[] {
  const liveIds = new Set(liveFields.map((f) => f.id));

  // Bucket data by group key.
  const aggByKey = new Map<string, SummaryAggregateRow[]>();
  for (const r of aggregateRows) {
    const k = groupKey(r.fieldId, r.fieldLabel, r.fieldType);
    const arr = aggByKey.get(k);
    if (arr) arr.push(r);
    else aggByKey.set(k, [r]);
  }
  const textByKey = new Map<string, RecentTextRow[]>();
  for (const r of recentText) {
    const k = groupKey(r.fieldId, r.fieldLabel, r.fieldType);
    const arr = textByKey.get(k);
    if (arr) arr.push(r);
    else textByKey.set(k, [r]);
  }

  const out: FieldSummary[] = [];

  // 1) Live fields in position order.
  for (const f of [...liveFields].sort((a, b) => a.position - b.position)) {
    const base: Base = {
      key: f.id,
      fieldId: f.id,
      label: f.label,
      type: f.type,
      deleted: false,
    };
    if (f.type === "rating") {
      out.push(ratingSummary(base, aggByKey.get(f.id) ?? []));
    } else if (f.type === "single_select" || f.type === "yes_no") {
      out.push(tallySummary(base, aggByKey.get(f.id) ?? []));
    } else {
      out.push(textSummary(base, textByKey.get(f.id) ?? []));
    }
  }

  // 2) Orphan groups (data whose key isn't a live field id) — deleted fields.
  const orphanKeys = new Set<string>();
  for (const k of aggByKey.keys()) if (!liveIds.has(k)) orphanKeys.add(k);
  for (const k of textByKey.keys()) if (!liveIds.has(k)) orphanKeys.add(k);

  const orphans: FieldSummary[] = [];
  for (const k of orphanKeys) {
    const sample = (aggByKey.get(k) ?? textByKey.get(k))![0]!;
    const base: Base = {
      key: k,
      fieldId: sample.fieldId,
      label: sample.fieldLabel,
      type: sample.fieldType,
      deleted: true,
    };
    if (sample.fieldType === "rating") {
      orphans.push(ratingSummary(base, aggByKey.get(k) ?? []));
    } else if (
      sample.fieldType === "single_select" ||
      sample.fieldType === "yes_no"
    ) {
      orphans.push(tallySummary(base, aggByKey.get(k) ?? []));
    } else {
      orphans.push(textSummary(base, textByKey.get(k) ?? []));
    }
  }
  orphans.sort((a, b) => a.label.localeCompare(b.label));

  return [...out, ...orphans];
}

export type DetailRow = {
  label: string;
  type: FieldType;
  value: string | number | null;
  deleted: boolean;
};

/**
 * One response's answers as ordered detail rows: live fields first (in position
 * order), then any answers to since-deleted fields. Labels/values come from the
 * answer SNAPSHOT (via `displayAnswer`) so historical responses stay correct.
 */
export function buildResponseDetail(
  liveFields: LiveField[],
  answers: StoredAnswer[],
): DetailRow[] {
  const liveOrder = new Map(liveFields.map((f) => [f.id, f.position]));
  const row = (a: StoredAnswer): DetailRow => ({
    label: a.fieldLabel,
    type: a.fieldType,
    value: displayAnswer(a),
    deleted: a.fieldId === null || !liveOrder.has(a.fieldId),
  });
  const live = answers
    .filter((a) => a.fieldId !== null && liveOrder.has(a.fieldId))
    .sort((a, b) => liveOrder.get(a.fieldId!)! - liveOrder.get(b.fieldId!)!)
    .map(row);
  const orphan = answers
    .filter((a) => a.fieldId === null || !liveOrder.has(a.fieldId))
    .map(row);
  return [...live, ...orphan];
}
