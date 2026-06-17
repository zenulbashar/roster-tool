import { describe, it, expect } from "vitest";
import {
  prefEnabled,
  relativeTime,
  formResponseTitle,
  NOTIFICATION_TYPES,
  NOTIFICATION_PREFS,
  type NotificationPrefs,
  type NotificationType,
} from "@/lib/notifications";

/** All-enabled prefs (the default), with selective overrides per test. */
function prefs(over: Partial<NotificationPrefs> = {}): NotificationPrefs {
  return {
    notifyLeaveRequested: true,
    notifyShiftOfferActivity: true,
    notifyStockNeedsOrder: true,
    notifyCertExpiring: true,
    notifyAvailabilityReply: true,
    notifyFormResponse: true,
    ...over,
  };
}

describe("notifications: prefEnabled", () => {
  it("is true for every type when all prefs are on (the default)", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(prefEnabled(prefs(), type)).toBe(true);
    }
  });

  it("is false only for the muted type", () => {
    const muted: NotificationType = "stock_needs_order";
    const p = prefs({ [NOTIFICATION_PREFS[muted].column]: false });
    expect(prefEnabled(p, muted)).toBe(false);
    for (const type of NOTIFICATION_TYPES) {
      if (type !== muted) expect(prefEnabled(p, type)).toBe(true);
    }
  });

  it("maps each type to a distinct preference column", () => {
    const columns = NOTIFICATION_TYPES.map((t) => NOTIFICATION_PREFS[t].column);
    expect(new Set(columns).size).toBe(NOTIFICATION_TYPES.length);
  });
});

describe("notifications: formResponseTitle", () => {
  it("is count + form title only — singular at 1, plural above (NO identity)", () => {
    expect(formResponseTitle(1, "Feedback")).toBe("1 new response to Feedback");
    expect(formResponseTitle(12, "Feedback")).toBe(
      "12 new responses to Feedback",
    );
    // The form's own title is the only free text; never any respondent name.
    expect(formResponseTitle(3, "Staff survey")).toBe(
      "3 new responses to Staff survey",
    );
  });
});

describe("notifications: relativeTime", () => {
  const now = new Date("2026-06-09T12:00:00Z");

  it("buckets recent times", () => {
    expect(relativeTime(new Date("2026-06-09T11:59:30Z"), now)).toBe(
      "just now",
    );
    expect(relativeTime(new Date("2026-06-09T11:55:00Z"), now)).toBe(
      "5 min ago",
    );
    expect(relativeTime(new Date("2026-06-09T09:00:00Z"), now)).toBe("3 h ago");
    expect(relativeTime(new Date("2026-06-07T12:00:00Z"), now)).toBe("2 d ago");
  });

  it("shows DD/MM once a week or more old", () => {
    expect(relativeTime(new Date("2026-06-01T12:00:00Z"), now)).toBe("01/06");
  });

  it("clamps future timestamps to 'just now'", () => {
    expect(relativeTime(new Date("2026-06-09T12:05:00Z"), now)).toBe(
      "just now",
    );
  });
});
