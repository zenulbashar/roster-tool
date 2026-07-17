import { describe, it, expect } from "vitest";
import {
  offerTransition,
  timesOverlap,
  claimEligibility,
  isActiveOfferStatus,
  type OfferStatus,
} from "@/lib/shift-offer";

describe("offerTransition", () => {
  it("allows the four valid transitions", () => {
    expect(offerTransition("open", "claim")).toBe("claimed");
    expect(offerTransition("claimed", "approve")).toBe("approved");
    expect(offerTransition("claimed", "deny")).toBe("denied");
    expect(offerTransition("open", "withdraw")).toBe("withdrawn");
  });

  it("rejects invalid transitions", () => {
    // Can't approve/deny an unclaimed offer.
    expect(offerTransition("open", "approve")).toBeNull();
    expect(offerTransition("open", "deny")).toBeNull();
    // Can't claim/withdraw an already-claimed offer.
    expect(offerTransition("claimed", "claim")).toBeNull();
    expect(offerTransition("claimed", "withdraw")).toBeNull();
    // Can't act on a finalised offer.
    for (const s of ["approved", "denied", "withdrawn"] as OfferStatus[]) {
      expect(offerTransition(s, "claim")).toBeNull();
      expect(offerTransition(s, "approve")).toBeNull();
      expect(offerTransition(s, "deny")).toBeNull();
      expect(offerTransition(s, "withdraw")).toBeNull();
    }
  });

  it("classifies active statuses", () => {
    expect(isActiveOfferStatus("open")).toBe(true);
    expect(isActiveOfferStatus("claimed")).toBe(true);
    expect(isActiveOfferStatus("approved")).toBe(false);
    expect(isActiveOfferStatus("denied")).toBe(false);
    expect(isActiveOfferStatus("withdrawn")).toBe(false);
  });
});

describe("timesOverlap", () => {
  it("detects overlapping ranges", () => {
    expect(timesOverlap("09:00", "12:00", "11:00", "14:00")).toBe(true);
    expect(timesOverlap("09:00:00", "17:00:00", "12:00:00", "13:00:00")).toBe(
      true,
    );
  });

  it("does not count touching ends as overlap", () => {
    expect(timesOverlap("09:00", "12:00", "12:00", "15:00")).toBe(false);
    expect(timesOverlap("12:00", "15:00", "09:00", "12:00")).toBe(false);
  });

  it("is false for disjoint ranges", () => {
    expect(timesOverlap("09:00", "11:00", "13:00", "15:00")).toBe(false);
  });

  it("is overnight-aware: an end at/before the start wraps to the next day", () => {
    // 18:00–02:00 runs into 22:00–06:00.
    expect(timesOverlap("18:00", "02:00", "22:00", "06:00")).toBe(true);
    // …but not into the same day's morning.
    expect(timesOverlap("18:00", "02:00", "08:00", "14:00")).toBe(false);
    // A day shift ending exactly when the night shift starts doesn't clash.
    expect(timesOverlap("10:00", "18:00", "18:00", "02:00")).toBe(false);
  });
});

describe("claimEligibility", () => {
  const base = {
    offerStatus: "open" as OfferStatus,
    offeredByStaffId: "ava",
    claimerStaffId: "ben",
    alreadyAssignedToShift: false,
  };

  it("allows a clean claim", () => {
    expect(claimEligibility(base).ok).toBe(true);
  });

  it("blocks claiming a non-open offer", () => {
    expect(claimEligibility({ ...base, offerStatus: "claimed" }).ok).toBe(
      false,
    );
  });

  it("blocks claiming your own released shift", () => {
    expect(claimEligibility({ ...base, claimerStaffId: "ava" }).ok).toBe(false);
  });

  it("blocks claiming a shift you're already on", () => {
    expect(claimEligibility({ ...base, alreadyAssignedToShift: true }).ok).toBe(
      false,
    );
  });
});
