/**
 * The NWS forecast zone and county ids for a point, from api.weather.gov /points. Only the county is used for matching events (NWS
 * renumbered zones over time, so today's zone id does not match old rows), and only when the Census match gave no county. Kept for a day.
 */
import { fetchJson, USER_AGENT, type FetchLike } from "./http";
import { LruCache } from "./lru";

export interface NwsAreaIds {
  /** Like WAZ558 */
  zone: string | null;
  /** Like WAC033 */
  county: string | null;
}

interface PointsReply {
  properties?: { forecastZone?: string | null; county?: string | null };
}

const ID = /\/([A-Z]{2}[ZC]\d{3})\/?$/;

/** "https://api.weather.gov/zones/forecast/WAZ558" -> "WAZ558"; anything else -> null. */
export function areaIdFromUrl(url: string | null | undefined): string | null {
  return typeof url === "string" ? (ID.exec(url)?.[1] ?? null) : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const cache = new LruCache<NwsAreaIds>(500, DAY_MS);

export function clearZoneCache(): void {
  cache.clear();
}

export async function fetchAreaIds(lat: number, lon: number, fetchFn: FetchLike, now: () => Date = () => new Date()): Promise<NwsAreaIds | null> {
  // About 100 m: a zone border can run through a city, so the cell is small.
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = cache.get(key, now().getTime());
  if (hit) return hit;
  const result = await fetchJson<PointsReply>(fetchFn, `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
    headers: { Accept: "application/geo+json", "User-Agent": USER_AGENT },
  });
  if (!result.ok) return null;
  const ids: NwsAreaIds = { zone: areaIdFromUrl(result.data.properties?.forecastZone), county: areaIdFromUrl(result.data.properties?.county) };
  if (!ids.zone && !ids.county) return null;
  cache.set(key, ids, now().getTime());
  return ids;
}
