import { describe, it, expect } from "vitest";
import { haversineMeters, isWithinRadius } from "@/lib/geo";

describe("haversineMeters", () => {
  it("is zero for the same point", () => {
    const p = { lat: -33.8688, lng: 151.2093 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  it("matches a known short distance (~111m per 0.001° latitude)", () => {
    const a = { lat: -33.8688, lng: 151.2093 };
    const b = { lat: -33.8678, lng: 151.2093 }; // 0.001° north
    // One thousandth of a degree of latitude is ~111.2 m anywhere on Earth.
    expect(haversineMeters(a, b)).toBeGreaterThan(110);
    expect(haversineMeters(a, b)).toBeLessThan(113);
  });

  it("matches a known longer distance (~650m between two Sydney harbour points)", () => {
    const opera = { lat: -33.8568, lng: 151.2153 };
    const bridge = { lat: -33.8523, lng: 151.2108 };
    const d = haversineMeters(opera, bridge);
    expect(d).toBeGreaterThan(640);
    expect(d).toBeLessThan(660);
  });

  it("is symmetric", () => {
    const a = { lat: 10, lng: 20 };
    const b = { lat: 11, lng: 21 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe("isWithinRadius", () => {
  const center = { lat: -33.8688, lng: 151.2093 };

  it("is inside at the exact center", () => {
    expect(isWithinRadius(center, center, 200)).toBe(true);
  });

  it("is inside just within the radius and outside just beyond it", () => {
    // ~111m north of center.
    const near = { lat: -33.8678, lng: 151.2093 };
    expect(isWithinRadius(near, center, 200)).toBe(true);
    expect(isWithinRadius(near, center, 100)).toBe(false);
  });

  it("treats a point exactly on the boundary as inside (inclusive)", () => {
    const d = haversineMeters({ lat: -33.8678, lng: 151.2093 }, center);
    const onBoundary = { lat: -33.8678, lng: 151.2093 };
    expect(isWithinRadius(onBoundary, center, d)).toBe(true);
    // A hair smaller radius excludes it.
    expect(isWithinRadius(onBoundary, center, d - 0.001)).toBe(false);
  });

  it("blocks a clearly-distant point", () => {
    const faraway = { lat: -37.8136, lng: 144.9631 }; // Melbourne
    expect(isWithinRadius(faraway, center, 500)).toBe(false);
  });
});
