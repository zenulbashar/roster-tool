/**
 * Geofencing maths for personal-phone clock-in. Pure functions, no I/O — every
 * branch is testable. Coordinates are decimal degrees (WGS84); distances are in
 * metres. Used only to confirm a staff member is at the shop when they clock in
 * from their own phone; location is read once at the tap (no tracking).
 */

export type Coordinates = { lat: number; lng: number };

/** Mean Earth radius in metres (spherical approximation). */
const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance between two points in metres (Haversine formula).
 * Accurate to well within the tens-of-metres geofence radii we use.
 */
export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether `point` is within `radiusM` metres of `center` (inclusive of the
 * boundary). A point exactly on the radius counts as inside.
 */
export function isWithinRadius(
  point: Coordinates,
  center: Coordinates,
  radiusM: number,
): boolean {
  return haversineMeters(point, center) <= radiusM;
}
