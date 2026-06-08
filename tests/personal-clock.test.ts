import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo } from "@/lib/tenant/repository";
import { resolvePersonalClockBusiness } from "@/lib/tenant/personal-clock-access";
import { isWithinRadius } from "@/lib/geo";
import { generateToken } from "@/lib/tokens";

/**
 * Integration coverage for the personal-phone clock-in plumbing: the separate
 * capability token resolves only its business, clock-in persists coordinates +
 * within_geofence, and the geofence decision blocks outside / allows inside.
 */
describe("personal-phone clock-in", () => {
  let businessA = "";
  let businessB = "";
  const shop = { lat: -33.8688, lng: 151.2093 };

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({
        name: "Geo Cafe A",
        latitude: shop.lat,
        longitude: shop.lng,
        geofenceRadiusM: 200,
      })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Geo Cafe B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
    await db.$client.end();
  });

  it("resolves the business by its personal-clock token, rejecting wrong/rotated tokens", async () => {
    const repo = createTenantRepo(businessA);
    const first = generateToken();
    await repo.updateBusinessSettings({
      personalClockTokenHash: first.tokenHash,
    });

    const resolved = await resolvePersonalClockBusiness(first.token);
    expect(resolved?.businessId).toBe(businessA);
    expect(resolved?.latitude).toBe(shop.lat);
    expect(resolved?.geofenceRadiusM).toBe(200);

    expect(await resolvePersonalClockBusiness("nope")).toBeNull();

    // Rotating revokes the old link.
    const second = generateToken();
    await repo.updateBusinessSettings({
      personalClockTokenHash: second.tokenHash,
    });
    expect(await resolvePersonalClockBusiness(first.token)).toBeNull();
    expect((await resolvePersonalClockBusiness(second.token))?.businessId).toBe(
      businessA,
    );
  });

  it("does NOT resolve the kiosk token as a personal-clock token", async () => {
    const repo = createTenantRepo(businessA);
    const kiosk = generateToken();
    await repo.updateBusinessSettings({ kioskTokenHash: kiosk.tokenHash });
    // The kiosk token must not unlock the GPS route.
    expect(await resolvePersonalClockBusiness(kiosk.token)).toBeNull();
  });

  it("blocks an outside fix and allows an inside fix (geofence decision)", () => {
    // ~111m north of the shop: inside 200m, outside 100m.
    const near = { lat: -33.8678, lng: 151.2093 };
    const faraway = { lat: -37.8136, lng: 144.9631 }; // Melbourne
    expect(isWithinRadius(near, shop, 200)).toBe(true);
    expect(isWithinRadius(faraway, shop, 200)).toBe(false);
  });

  it("persists coordinates and within_geofence on a personal clock-in", async () => {
    const repo = createTenantRepo(businessA);
    const staff = await repo.addStaff({ name: "Gus", email: "gus@a.test" });
    const entry = await repo.clockIn(staff.id, {
      at: new Date("2026-06-08T09:00:00Z"),
      lat: shop.lat,
      lng: shop.lng,
      withinGeofence: true,
    });
    expect(entry.clockInLat).toBe(shop.lat);
    expect(entry.clockInLng).toBe(shop.lng);
    expect(entry.withinGeofence).toBe(true);
  });

  it("leaves location null for a kiosk-style clock-in (no coords passed)", async () => {
    const repo = createTenantRepo(businessA);
    const staff = await repo.addStaff({ name: "Han", email: "han@a.test" });
    const entry = await repo.clockIn(staff.id);
    expect(entry.clockInLat).toBeNull();
    expect(entry.withinGeofence).toBeNull();
  });
});
