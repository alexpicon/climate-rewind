/**
 * Many NWS alerts (a Flood Watch, a Heat Advisory) have no polygon: they are issued for whole forecast zones or counties, and the alert
 * feed's geometry is null. For the map, the zone or county that holds the address (the one named in the alert's own `affectedZones`) is
 * drawn instead, labelled as the zone, never as the alert's whole reach. A polygon-bearing alert is drawn from the live lookup as it is.
 */
import { describeFailure, fetchJson, USER_AGENT, type FetchLike } from "./http";
import { LruCache } from "./lru";
import type { AlertGeometry } from "./types";

export interface AlertZone {
  /** The NWS zone id, like TNZ027 or TNC037. */
  id: string;
  name: string;
  /** The alerts in force for it. */
  events: string[];
  geometry: AlertGeometry;
}

interface AlertsReply {
  features?: Array<{ geometry?: unknown; properties?: { event?: string; affectedZones?: string[] } }>;
}
interface PointsReply {
  properties?: { forecastZone?: string; county?: string };
}
interface ZoneReply {
  geometry?: AlertGeometry | null;
  properties?: { id?: string; name?: string };
}

const HEADERS = { Accept: "application/geo+json", "User-Agent": USER_AGENT };
const NWS = "https://api.weather.gov/";
/** An outline does not change from one day to the next. */
const zones = new LruCache<AlertZone | null>(80, 24 * 60 * 60_000);

export function clearAlertZoneCache(): void {
  zones.clear();
}

const isNwsZoneUrl = (url: unknown): url is string => typeof url === "string" && /^https:\/\/api\.weather\.gov\/zones\/(forecast|county)\/[A-Z]{2}[CZ]\d{3}$/.test(url);
const isShape = (g: unknown): g is AlertGeometry => {
  const geometry = g as { type?: string; coordinates?: unknown } | null;
  return !!geometry && (geometry.type === "Polygon" || geometry.type === "MultiPolygon") && Array.isArray(geometry.coordinates);
};

/** The zone outlines to draw for the alerts at a point that have no polygon of their own. Never throws; empty when there is nothing to draw. */
export async function fetchAlertZones(lat: number, lon: number, fetchFn: FetchLike, now: () => Date = () => new Date()): Promise<{ zones: AlertZone[]; notice?: string }> {
  const alerts = await fetchJson<AlertsReply>(fetchFn, `${NWS}alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: HEADERS });
  if (!alerts.ok) return { zones: [], notice: describeFailure("The National Weather Service alert feed", alerts) };
  const bare = (alerts.data.features ?? []).filter((f) => !isShape(f.geometry));
  if (bare.length === 0) return { zones: [] };

  const points = await fetchJson<PointsReply>(fetchFn, `${NWS}points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: HEADERS });
  if (!points.ok) return { zones: [], notice: describeFailure("The National Weather Service forecast", points) };
  const mine = [points.data.properties?.forecastZone, points.data.properties?.county].filter(isNwsZoneUrl);

  // Which of the address's zone and county each alert names (the alert's own list decides, not a guess).
  const wanted = new Map<string, Set<string>>();
  for (const alert of bare) {
    const named = (alert.properties?.affectedZones ?? []).filter((z) => mine.includes(z));
    for (const url of named.slice(0, 1)) wanted.set(url, (wanted.get(url) ?? new Set()).add(alert.properties?.event ?? "Alert"));
  }
  const out: AlertZone[] = [];
  await Promise.all(
    [...wanted].slice(0, 3).map(async ([url, events]) => {
      let zone = zones.get(url, now().getTime());
      if (zone === undefined) {
        const got = await fetchJson<ZoneReply>(fetchFn, url, { headers: HEADERS });
        zone = got.ok && isShape(got.data.geometry) ? { id: got.data.properties?.id ?? url.slice(-6), name: got.data.properties?.name ?? "", events: [], geometry: got.data.geometry } : null;
        if (got.ok) zones.set(url, zone, now().getTime());
      }
      if (zone) out.push({ ...zone, events: [...events] });
    }),
  );
  return { zones: out };
}
