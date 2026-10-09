/**
 * What the NWS radars' own algorithms flagged during a storm replay: hail detections (with the estimated largest hail) and tornado
 * vortex signatures (strong rotation). From NOAA NCEI's Severe Weather Data Inventory, the NEXRAD Level-III "nx3hail" and "nx3tvs"
 * products: keyless, public, and fetched per replay night. These are computer detections on radar data, not confirmed hail or
 * tornadoes; the page says so. Server only.
 */
import { describeFailure, fetchJson, type FetchLike } from "./http";
import { LruCache } from "./lru";

const SWDI = "https://www.ncei.noaa.gov/swdiws/json";

/** A replay window longer than this is refused (a storm night is a few hours). */
export const MAX_WINDOW_MS = 24 * 60 * 60_000;
/** Hail detections below this probability are left out: the algorithm flags many weak cells. */
export const MIN_HAIL_PROB = 50;

export interface HailSignature {
  /** UTC milliseconds of the radar scan. */
  t: number;
  lat: number;
  lon: number;
  /** The algorithm's estimate of the largest hailstone, in inches. */
  maxIn: number;
  /** Probability of any hail, and of severe hail (1 inch or more), in percent. */
  prob: number;
  severeProb: number;
  radar: string;
}

export interface VortexSignature {
  t: number;
  lat: number;
  lon: number;
  /** "TVS", or "ETVS" (an elevated one, seen aloft). */
  kind: string;
  /** The rotation's strength: maximum shear (1/1000 s) and the velocity difference across it (knots). */
  shear: number;
  deltaV: number;
  radar: string;
}

export interface RadarSignatures {
  hail: HailSignature[];
  vortex: VortexSignature[];
  /** Why a part is missing, in plain words; absent when both came back. */
  notice?: string;
}

export interface SignatureQuery {
  bounds: [number, number, number, number];
  startMs: number;
  endMs: number;
}

interface SwdiResponse {
  result?: Array<Record<string, string>>;
}

/** "202103280305" for the service's date range (UTC, to the minute). */
export function swdiTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace(/[-T:]/g, "");
}

/** "POINT (-87.2000988 35.8346955)" as [lat, lon], or null. */
export function pointOf(shape: string | undefined): [number, number] | null {
  const match = /POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec(shape ?? "");
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
}

/** Reads a query string's bbox, start and end (ISO) into a query, or null if anything is out of bounds. */
export function parseSignatureQuery(params: URLSearchParams): SignatureQuery | null {
  const bounds = (params.get("bbox") ?? "").split(",").map(Number);
  const startMs = Date.parse(params.get("start") ?? "");
  const endMs = Date.parse(params.get("end") ?? "");
  if (bounds.length !== 4 || bounds.some((v) => !Number.isFinite(v))) return null;
  const [west, south, east, north] = bounds;
  const inUs = west >= -180 && east <= -60 && south >= 15 && north <= 72 && west < east && south < north && east - west <= 8 && north - south <= 8;
  if (!inUs || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || endMs - startMs > MAX_WINDOW_MS) return null;
  return { bounds: [west, south, east, north], startMs, endMs };
}

const url = (dataset: string, query: SignatureQuery) =>
  `${SWDI}/${dataset}/${swdiTime(query.startMs)}:${swdiTime(query.endMs + 60_000)}?bbox=${query.bounds.map((v) => v.toFixed(3)).join(",")}`;

const num = (value: string | undefined) => Number(value ?? NaN);

function inWindow(t: number, query: SignatureQuery): boolean {
  return Number.isFinite(t) && t >= query.startMs && t <= query.endMs;
}

const cache = new LruCache<RadarSignatures>(200, 24 * 60 * 60_000);

/** Both products for one replay night. Never throws: a failed part is empty, with a notice. Complete answers are cached a day. */
export async function fetchRadarSignatures(query: SignatureQuery, fetchFn: FetchLike = fetch): Promise<RadarSignatures> {
  const key = `${query.bounds.join(",")}|${query.startMs}|${query.endMs}`;
  const hit = cache.get(key, Date.now());
  if (hit) return hit;

  const [hailRes, tvsRes] = await Promise.all([fetchJson<SwdiResponse>(fetchFn, url("nx3hail", query)), fetchJson<SwdiResponse>(fetchFn, url("nx3tvs", query))]);
  const notices: string[] = [];

  const hail: HailSignature[] = [];
  if (hailRes.ok) {
    for (const row of hailRes.data.result ?? []) {
      const point = pointOf(row.SHAPE);
      const t = Date.parse(row.ZTIME ?? "");
      if (!point || !inWindow(t, query) || num(row.PROB) < MIN_HAIL_PROB) continue;
      hail.push({ t, lat: point[0], lon: point[1], maxIn: num(row.MAXSIZE) || 0, prob: num(row.PROB), severeProb: num(row.SEVPROB) || 0, radar: row.WSR_ID ?? "" });
    }
  } else {
    notices.push(describeFailure("NOAA's radar hail detections", hailRes));
  }

  const vortex: VortexSignature[] = [];
  if (tvsRes.ok) {
    for (const row of tvsRes.data.result ?? []) {
      const point = pointOf(row.SHAPE);
      const t = Date.parse(row.ZTIME ?? "");
      if (!point || !inWindow(t, query)) continue;
      vortex.push({ t, lat: point[0], lon: point[1], kind: row.CELL_TYPE ?? "TVS", shear: num(row.MAX_SHEAR) || 0, deltaV: num(row.MXDV) || 0, radar: row.WSR_ID ?? "" });
    }
  } else {
    notices.push(describeFailure("NOAA's radar rotation detections", tvsRes));
  }

  hail.sort((a, b) => a.t - b.t);
  vortex.sort((a, b) => a.t - b.t);
  const result: RadarSignatures = notices.length ? { hail, vortex, notice: notices.join(" ") } : { hail, vortex };
  if (!result.notice) cache.set(key, result, Date.now());
  return result;
}
