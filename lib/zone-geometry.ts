/**
 * Plain geometry for "is this point inside that forecast zone, and if not, how far is it". No dependencies, no network.
 *
 * A zone is a GeoJSON MultiPolygon: polygons -> rings (the first ring is the outline, the rest are holes) -> [lon, lat] points. Every
 * vertex is turned into kilometres east and north of the address (a flat map centred on it), which is accurate to a few metres over
 * the 15 km this is used for, and puts the address at (0, 0) so the tests below are all about the origin.
 */

export type Ring = ReadonlyArray<readonly [number, number]>;
/** One polygon: the outline first, then holes. */
export type PolygonCoords = ReadonlyArray<Ring>;
export type Bbox = readonly [minLon: number, minLat: number, maxLon: number, maxLat: number];

/** Kilometres in one degree of latitude (and of longitude at the equator) on a sphere of Earth's mean radius. */
export const KM_PER_DEGREE = 111.195;

const RAD = Math.PI / 180;

/** Degrees of longitude between two points, taken the short way round (so the date line does not break a zone). */
const lonDelta = (lon: number, lon0: number): number => ((((lon - lon0) % 360) + 540) % 360) - 180;

/** [lon, lat] as kilometres east and north of the origin point. */
function toKm(lon: number, lat: number, lat0: number, lon0: number): [number, number] {
  return [lonDelta(lon, lon0) * Math.cos(lat0 * RAD) * KM_PER_DEGREE, (lat - lat0) * KM_PER_DEGREE];
}

/** Even-odd ray casting on a ring already in kilometres around the origin: is (0, 0) inside it? */
function ringContainsOrigin(ring: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from the origin to the segment a-b, in the same unit as the points. */
function distanceToSegment(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx + -ay * dy) / lengthSq));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export interface PolygonProbe {
  /** True when the point is inside a polygon's outline and not inside one of its holes (or exactly on an edge). */
  inside: boolean;
  /** 0 when inside; otherwise the straight-line distance to the nearest edge, in km. */
  km: number;
}

/**
 * Is the point inside the (multi)polygon, and how far is its nearest edge? A point in a hole is outside, and its distance is to the
 * hole's edge. Malformed rings (fewer than 3 points) are skipped; with nothing usable the answer is "outside, infinitely far".
 */
export function probePolygons(lat: number, lon: number, polygons: ReadonlyArray<PolygonCoords>): PolygonProbe {
  let inside = false;
  let nearest = Infinity;
  for (const polygon of polygons) {
    let inOutline = false;
    let inHole = false;
    polygon.forEach((ring, index) => {
      if (ring.length < 3) return;
      const pts = ring.map(([x, y]) => toKm(x, y, lat, lon));
      if (ringContainsOrigin(pts)) {
        if (index === 0) inOutline = true;
        else inHole = true;
      }
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        nearest = Math.min(nearest, distanceToSegment(a[0], a[1], b[0], b[1]));
      }
    });
    if (inOutline && !inHole) inside = true;
  }
  if (inside || nearest < 1e-9) return { inside: true, km: 0 };
  return { inside: false, km: nearest };
}

/** Does the point sit inside the GeoJSON (multi)polygon? */
export function pointInPolygons(lat: number, lon: number, polygons: ReadonlyArray<PolygonCoords>): boolean {
  return probePolygons(lat, lon, polygons).inside;
}

/** Straight-line km from the point to the (multi)polygon: 0 inside, else to the nearest edge. Infinity for an empty shape. */
export function distanceToPolygonsKm(lat: number, lon: number, polygons: ReadonlyArray<PolygonCoords>): number {
  return probePolygons(lat, lon, polygons).km;
}

/** km from the point to a [minLon, minLat, maxLon, maxLat] box: 0 inside it. A lower bound for the distance to anything drawn inside the box. */
export function distanceToBboxKm(lat: number, lon: number, bbox: Bbox): number {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const dLat = Math.max(minLat - lat, 0, lat - maxLat) * KM_PER_DEGREE;
  // Longitude: measure to whichever side is nearer, the short way round.
  const toMin = lonDelta(minLon, lon);
  const toMax = lonDelta(maxLon, lon);
  const dLon = toMin <= 0 && toMax >= 0 ? 0 : Math.min(Math.abs(toMin), Math.abs(toMax)) * Math.cos(lat * RAD) * KM_PER_DEGREE;
  return Math.hypot(dLon, dLat);
}

/** GeoJSON Polygon or MultiPolygon -> the polygons inside it. Anything else (or garbage) -> null. */
export function polygonsOf(geometry: unknown): PolygonCoords[] | null {
  const g = geometry as { type?: unknown; coordinates?: unknown } | null;
  if (!g || typeof g !== "object" || !Array.isArray(g.coordinates)) return null;
  const valid = (polygon: unknown): polygon is PolygonCoords =>
    Array.isArray(polygon) && polygon.length > 0 && polygon.every((ring) => Array.isArray(ring) && ring.every((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])));
  if (g.type === "Polygon") return valid(g.coordinates) ? [g.coordinates] : null;
  if (g.type === "MultiPolygon") {
    const polygons = (g.coordinates as unknown[]).filter(valid);
    return polygons.length > 0 ? polygons : null;
  }
  return null;
}
