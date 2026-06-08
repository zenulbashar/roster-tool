import { describe, it, expect } from "vitest";
import {
  PHOTO_RETENTION_DAYS,
  parsePhotoRetentionDays,
  photoRetentionCutoff,
  isPhotoExpired,
} from "@/lib/retention";

const NOW = new Date("2026-06-08T03:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("parsePhotoRetentionDays", () => {
  it("accepts only the allowed periods", () => {
    for (const d of PHOTO_RETENTION_DAYS) {
      expect(parsePhotoRetentionDays(d)).toBe(d);
    }
  });
  it("rejects anything else", () => {
    for (const bad of [0, 1, 14, 60, 365, -7, 7.5, "7", null, undefined]) {
      expect(parsePhotoRetentionDays(bad)).toBeNull();
    }
  });
});

describe("photoRetentionCutoff", () => {
  it("is now minus retentionDays", () => {
    expect(photoRetentionCutoff(NOW, 7).toISOString()).toBe(
      "2026-06-01T03:00:00.000Z",
    );
    expect(photoRetentionCutoff(NOW, 30).toISOString()).toBe(
      "2026-05-09T03:00:00.000Z",
    );
    expect(photoRetentionCutoff(NOW, 90).toISOString()).toBe(
      "2026-03-10T03:00:00.000Z",
    );
  });
});

describe("isPhotoExpired", () => {
  it("expires entries clocked in strictly before the cutoff", () => {
    // Just over 7 days old -> expired.
    expect(isPhotoExpired(new Date(NOW.getTime() - 7 * DAY - 1), NOW, 7)).toBe(
      true,
    );
    // Exactly at the cutoff -> kept (strict comparison).
    expect(isPhotoExpired(new Date(NOW.getTime() - 7 * DAY), NOW, 7)).toBe(
      false,
    );
    // Just under 7 days old -> kept.
    expect(isPhotoExpired(new Date(NOW.getTime() - 7 * DAY + 1), NOW, 7)).toBe(
      false,
    );
  });

  it("respects the chosen retention period", () => {
    const tenDaysAgo = new Date(NOW.getTime() - 10 * DAY);
    expect(isPhotoExpired(tenDaysAgo, NOW, 7)).toBe(true);
    expect(isPhotoExpired(tenDaysAgo, NOW, 30)).toBe(false);
    expect(isPhotoExpired(tenDaysAgo, NOW, 90)).toBe(false);

    const sixtyDaysAgo = new Date(NOW.getTime() - 60 * DAY);
    expect(isPhotoExpired(sixtyDaysAgo, NOW, 30)).toBe(true);
    expect(isPhotoExpired(sixtyDaysAgo, NOW, 90)).toBe(false);
  });

  it("never expires future or just-created entries", () => {
    expect(isPhotoExpired(NOW, NOW, 7)).toBe(false);
    expect(isPhotoExpired(new Date(NOW.getTime() + DAY), NOW, 7)).toBe(false);
  });
});
