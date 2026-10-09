/**
 * The official outlook areas for the map on "Next 72 hours": the WPC Excessive Rainfall Outlook (Days 1 to 3) and the SPC convective
 * outlook, categorical (Days 1 to 3), as the agencies' own polygons. They come from the NWS ArcGIS services at
 * mapservices.weather.noaa.gov (the same host the HeatRisk reading already uses), generalized to about 1 km so a whole country is a few KB.
 * General thunderstorm areas are left out (they cover half the map and are not a risk category). Nothing here is our forecast.
 *
 * Why not IEM: its spc_outlook.geojson needs the issuance cycle of each product, and it has no WPC polygon feed; these services are the
 * agencies' own and answer in one call per day.
 */
import { describeFailure, fetchJson, USER_AGENT, type FetchLike } from "./http";
import { LruCache } from "./lru";
import type { Features } from "./features";

export type OutlookKind = "flood" | "storm";
export type OutlookLevel = "MRGL" | "SLGT" | "ENH" | "MDT" | "HIGH";
export const LEVEL_ORDER: readonly OutlookLevel[] = ["MRGL", "SLGT", "ENH", "MDT", "HIGH"];

export interface OutlookProduct {
  kind: OutlookKind;
  day: 1 | 2 | 3;
  /** When the agency issued it, ISO (UTC), if the service said. */
  issued: string | null;
  /** The period it is valid for, as the agency writes it ("12Z 10/09/26 - 12Z 10/10/26"). */
  valid: string | null;
}

export interface OutlookAreas {
  checkedAt: string;
  /** Polygons with {kind, day, level}. Lower levels first, so a higher one draws on top. */
  areas: Features;
  products: OutlookProduct[];
  notice?: string;
}

const BASE = "https://mapservices.weather.noaa.gov/vector/rest/services";
/** [kind, day, service path, layer id, fields]. SPC layers 1, 9, 17 are the categorical outlooks of Days 1 to 3; WPC layers 0 to 2 are the ERO. */
const SOURCES: ReadonlyArray<{ kind: OutlookKind; day: 1 | 2 | 3; path: string; fields: string }> = [
  { kind: "storm", day: 1, path: "outlooks/SPC_wx_outlks/MapServer/1", fields: "label,issue,valid,expire" },
  { kind: "storm", day: 2, path: "outlooks/SPC_wx_outlks/MapServer/9", fields: "label,issue,valid,expire" },
  { kind: "storm", day: 3, path: "outlooks/SPC_wx_outlks/MapServer/17", fields: "label,issue,valid,expire" },
  { kind: "flood", day: 1, path: "hazards/wpc_precip_hazards/MapServer/0", fields: "outlook,issue_time,valid_time" },
  { kind: "flood", day: 2, path: "hazards/wpc_precip_hazards/MapServer/1", fields: "outlook,issue_time,valid_time" },
  { kind: "flood", day: 3, path: "hazards/wpc_precip_hazards/MapServer/2", fields: "outlook,issue_time,valid_time" },
];

export const outlookAreasUrl = (path: string, fields: string): string =>
  `${BASE}/${path}/query?where=1%3D1&outFields=${encodeURIComponent(fields)}&outSR=4326&maxAllowableOffset=0.01&f=geojson`;

interface ArcFeature {
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown } | null;
}
interface ArcReply {
  features?: ArcFeature[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** SPC writes times as YYYYMMDDHHMM (UTC); WPC as "YYYY-MM-DD HH:MM:SS" (UTC, its valid_time is in Z). */
export function agencyTimeToIso(raw: string | null): string | null {
  if (!raw) return null;
  const spc = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(raw);
  if (spc) return `${spc[1]}-${spc[2]}-${spc[3]}T${spc[4]}:${spc[5]}:00Z`;
  const wpc = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):\d{2}$/.exec(raw);
  return wpc ? `${wpc[1]}T${wpc[2]}:00Z` : null;
}

/** "Slight (At Least 15%)" -> SLGT; SPC labels are already the short code. TSTM and anything unknown -> null (not drawn). */
export function levelOf(kind: OutlookKind, properties: Record<string, unknown>): OutlookLevel | null {
  const raw = str(kind === "flood" ? properties.outlook : properties.label);
  if (!raw) return null;
  const head = raw.trim().split(/[\s(]/)[0].toUpperCase();
  const byWord: Record<string, OutlookLevel> = { MARGINAL: "MRGL", SLIGHT: "SLGT", ENHANCED: "ENH", MODERATE: "MDT", HIGH: "HIGH" };
  const level = (byWord[head] ?? head) as OutlookLevel;
  return LEVEL_ORDER.includes(level) ? level : null;
}

/** One agency layer as map polygons and its product line. A polygon without a usable shape is skipped. */
export function parseOutlookLayer(kind: OutlookKind, day: 1 | 2 | 3, reply: ArcReply): { features: Features["features"]; product: OutlookProduct } {
  const features: Features["features"] = [];
  let issued: string | null = null;
  let valid: string | null = null;
  for (const f of reply.features ?? []) {
    const p = f.properties ?? {};
    issued ??= agencyTimeToIso(str(kind === "flood" ? p.issue_time : p.issue));
    valid ??= str(kind === "flood" ? p.valid_time : null) ?? (str(p.valid) && str(p.expire) ? `${str(p.valid)} to ${str(p.expire)}` : null);
    const level = levelOf(kind, p);
    const g = f.geometry;
    if (!level || !g || (g.type !== "Polygon" && g.type !== "MultiPolygon") || !Array.isArray(g.coordinates)) continue;
    features.push({ type: "Feature", properties: { kind, day, level }, geometry: { type: g.type, coordinates: g.coordinates } });
  }
  return { features, product: { kind, day, issued, valid } };
}

const CACHE_MS = 10 * 60_000;
const cache = new LruCache<OutlookAreas>(2, CACHE_MS);
export function clearOutlookAreasCache(): void {
  cache.clear();
}

/** Every day's areas, nationwide. A layer that does not answer is left out and said so; only a complete answer is reused for ten minutes. */
export async function fetchOutlookAreas(fetchFn: FetchLike, now: () => Date = () => new Date()): Promise<OutlookAreas> {
  const hit = cache.get("all", now().getTime());
  if (hit) return hit;
  const replies = await Promise.all(SOURCES.map((s) => fetchJson<ArcReply>(fetchFn, outlookAreasUrl(s.path, s.fields), { headers: { "User-Agent": USER_AGENT } })));
  const features: Features["features"] = [];
  const products: OutlookProduct[] = [];
  let failed = 0;
  let lastFailure: string | undefined;
  replies.forEach((reply, i) => {
    const s = SOURCES[i];
    if (!reply.ok) {
      failed += 1;
      lastFailure = describeFailure("The National Weather Service outlook map service", reply);
      return;
    }
    const parsed = parseOutlookLayer(s.kind, s.day, reply.data);
    features.push(...parsed.features);
    products.push(parsed.product);
  });
  features.sort((a, b) => LEVEL_ORDER.indexOf(a.properties.level as OutlookLevel) - LEVEL_ORDER.indexOf(b.properties.level as OutlookLevel));
  const result: OutlookAreas = {
    checkedAt: now().toISOString(),
    areas: { type: "FeatureCollection", features },
    products,
    ...(failed ? { notice: failed === SOURCES.length ? (lastFailure ?? "The outlook map service did not answer.") : `${failed} of the 6 outlook layers did not answer, so some days are missing from the map.` } : {}),
  };
  if (!failed) cache.set("all", result, now().getTime());
  return result;
}
