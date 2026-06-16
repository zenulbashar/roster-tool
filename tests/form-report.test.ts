import { describe, it, expect } from "vitest";
import {
  buildFormSummary,
  buildResponseDetail,
  displayAnswer,
  type LiveField,
  type SummaryAggregateRow,
  type RecentTextRow,
  type StoredAnswer,
  type RatingSummary,
  type TallySummary,
  type TextSummary,
} from "@/lib/form-report";

const liveFields: LiveField[] = [
  { id: "f-name", label: "Your name", type: "short_text", position: 0 },
  { id: "f-size", label: "Size", type: "single_select", position: 1 },
  { id: "f-stars", label: "Stars", type: "rating", position: 2 },
];

describe("displayAnswer", () => {
  it("reads value_number for rating, value_text otherwise", () => {
    expect(
      displayAnswer({
        fieldId: "f-stars",
        fieldLabel: "Stars",
        fieldType: "rating",
        valueText: null,
        valueNumber: 4,
      }),
    ).toBe(4);
    expect(
      displayAnswer({
        fieldId: "f-size",
        fieldLabel: "Size",
        fieldType: "single_select",
        valueText: "Large",
        valueNumber: null,
      }),
    ).toBe("Large");
  });
});

describe("buildFormSummary", () => {
  it("computes rating average + distribution and a select tally", () => {
    const agg: SummaryAggregateRow[] = [
      // Stars: 5,5,3  → avg 4.33, dist counts
      {
        fieldId: "f-stars",
        fieldLabel: "Stars",
        fieldType: "rating",
        valueText: null,
        valueNumber: 5,
        count: 2,
      },
      {
        fieldId: "f-stars",
        fieldLabel: "Stars",
        fieldType: "rating",
        valueText: null,
        valueNumber: 3,
        count: 1,
      },
      // Size: Large×2, Small×1
      {
        fieldId: "f-size",
        fieldLabel: "Size",
        fieldType: "single_select",
        valueText: "Large",
        valueNumber: null,
        count: 2,
      },
      {
        fieldId: "f-size",
        fieldLabel: "Size",
        fieldType: "single_select",
        valueText: "Small",
        valueNumber: null,
        count: 1,
      },
    ];
    const text: RecentTextRow[] = [
      {
        fieldId: "f-name",
        fieldLabel: "Your name",
        fieldType: "short_text",
        valueText: "Ada",
      },
      {
        fieldId: "f-name",
        fieldLabel: "Your name",
        fieldType: "short_text",
        valueText: "Grace",
      },
    ];

    const summary = buildFormSummary(liveFields, agg, text);
    expect(summary.map((s) => s.label)).toEqual(["Your name", "Size", "Stars"]);

    const name = summary[0] as TextSummary;
    expect(name.kind).toBe("text");
    expect(name.recent).toEqual(["Ada", "Grace"]);

    const size = summary[1] as TallySummary;
    expect(size.kind).toBe("tally");
    expect(size.count).toBe(3);
    expect(size.tally).toEqual([
      { value: "Large", count: 2 },
      { value: "Small", count: 1 },
    ]);

    const stars = summary[2] as RatingSummary;
    expect(stars.kind).toBe("rating");
    expect(stars.count).toBe(3);
    expect(stars.average).toBe(4.33);
    expect(stars.distribution).toEqual([
      { value: 1, count: 0 },
      { value: 2, count: 0 },
      { value: 3, count: 1 },
      { value: 4, count: 0 },
      { value: 5, count: 2 },
    ]);
  });

  it("shows 'no ratings yet' (count 0, null average) for a field with no answers", () => {
    const summary = buildFormSummary(liveFields, [], []);
    const stars = summary.find((s) => s.label === "Stars") as RatingSummary;
    expect(stars.count).toBe(0);
    expect(stars.average).toBeNull();
    expect(stars.distribution.every((d) => d.count === 0)).toBe(true);
    const size = summary.find((s) => s.label === "Size") as TallySummary;
    expect(size.tally).toEqual([]);
  });

  it("appends a since-deleted field as a snapshot group flagged deleted", () => {
    const agg: SummaryAggregateRow[] = [
      // field_id null → deleted field, grouped by snapshot label+type
      {
        fieldId: null,
        fieldLabel: "Old question",
        fieldType: "yes_no",
        valueText: "Yes",
        valueNumber: null,
        count: 3,
      },
      {
        fieldId: null,
        fieldLabel: "Old question",
        fieldType: "yes_no",
        valueText: "No",
        valueNumber: null,
        count: 1,
      },
    ];
    const summary = buildFormSummary(liveFields, agg, []);
    const deleted = summary.find(
      (s) => s.label === "Old question",
    ) as TallySummary;
    expect(deleted).toBeDefined();
    expect(deleted.deleted).toBe(true);
    expect(deleted.fieldId).toBeNull();
    expect(deleted.tally).toEqual([
      { value: "Yes", count: 3 },
      { value: "No", count: 1 },
    ]);
    // Deleted groups come after the live fields.
    expect(summary[summary.length - 1]!.label).toBe("Old question");
  });
});

describe("buildResponseDetail", () => {
  it("orders by live field position and renders from the snapshot", () => {
    const answers: StoredAnswer[] = [
      {
        fieldId: "f-stars",
        fieldLabel: "Stars",
        fieldType: "rating",
        valueText: null,
        valueNumber: 5,
      },
      {
        fieldId: "f-name",
        fieldLabel: "Your name",
        fieldType: "short_text",
        valueText: "Ada",
        valueNumber: null,
      },
      {
        fieldId: "f-size",
        fieldLabel: "Size",
        fieldType: "single_select",
        valueText: "Large",
        valueNumber: null,
      },
    ];
    const detail = buildResponseDetail(liveFields, answers);
    expect(detail.map((d) => d.label)).toEqual(["Your name", "Size", "Stars"]);
    expect(detail.map((d) => d.value)).toEqual(["Ada", "Large", 5]);
    expect(detail.every((d) => d.deleted === false)).toBe(true);
  });

  it("keeps an answer to a since-deleted field, appended and flagged", () => {
    const answers: StoredAnswer[] = [
      {
        fieldId: "f-name",
        fieldLabel: "Your name",
        fieldType: "short_text",
        valueText: "Ada",
        valueNumber: null,
      },
      {
        fieldId: null,
        fieldLabel: "Removed",
        fieldType: "long_text",
        valueText: "gone but kept",
        valueNumber: null,
      },
    ];
    const detail = buildResponseDetail(liveFields, answers);
    expect(detail.map((d) => d.label)).toEqual(["Your name", "Removed"]);
    expect(detail[1]).toMatchObject({
      label: "Removed",
      value: "gone but kept",
      deleted: true,
    });
  });
});
