import type { Coord } from "./types";

const EARTH_RADIUS_KM = 6371;
const RAD = Math.PI / 180;
const KM_PER_DEGREE = 111.32;

/** Great-circle distance between two [lat, lon] points, in km. */
export function haversineKm(a: Coord, b: Coord): number {
  const dLat = (b[0] - a[0]) * RAD;
  const dLon = (b[1] - a[1]) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export interface SegmentHit {
  km: number;
  /** Closest point on the segment, [lat, lon]. */
  nearest: Coord;
}

/**
 * Shortest distance from `point` to the segment a-b, and where it lands.
 * Uses a local flat projection centred on the point, which is accurate to well
 * under 1% for the tens of kilometres we deal with.
 */
export function segmentDistance(point: Coord, a: Coord, b: Coord): SegmentHit {
  const kmPerLon = KM_PER_DEGREE * Math.cos(point[0] * RAD);
  const toXY = (p: Coord): [number, number] => [(p[1] - point[1]) * kmPerLon, (p[0] - point[0]) * KM_PER_DEGREE];

  const [ax, ay] = toXY(a);
  const [bx, by] = toXY(b);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  // The point is the origin of the projection, so we project (0, 0) onto a-b.
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / lengthSq));
  const nx = ax + t * dx;
  const ny = ay + t * dy;

  return {
    km: Math.hypot(nx, ny),
    nearest: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
  };
}

export function distanceToSegmentKm(point: Coord, a: Coord, b: Coord): number {
  return segmentDistance(point, a, b).km;
}

const DIRECTIONS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"] as const;

/** Initial compass bearing from a to b, in degrees clockwise from north. */
export function bearingDeg(a: Coord, b: Coord): number {
  const dLon = (b[1] - a[1]) * RAD;
  const y = Math.sin(dLon) * Math.cos(b[0] * RAD);
  const x = Math.cos(a[0] * RAD) * Math.sin(b[0] * RAD) - Math.sin(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** "north", "southeast", ... for a bearing in degrees. */
export function bearingWord(degrees: number): string {
  return DIRECTIONS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

/** "north", "southeast", ... for the direction from a to b. */
export function compassWord(a: Coord, b: Coord): string {
  return bearingWord(bearingDeg(a, b));
}

/** Bounding box [west, south, east, north] that contains a circle of radiusKm around a point. */
export function boxAround(center: Coord, radiusKm: number): [number, number, number, number] {
  const dLat = radiusKm / 110.57;
  const dLon = radiusKm / (KM_PER_DEGREE * Math.cos(center[0] * RAD));
  return [center[1] - dLon, center[0] - dLat, center[1] + dLon, center[0] + dLat];
}
