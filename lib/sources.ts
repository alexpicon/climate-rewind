/**
 * The live external sources: Census geocoder, FEMA NFHL, NWS alerts, Open-Meteo (with NASA POWER as its fallback).
 * Each call takes an injectable fetch (so tests never touch the network), has an
 * 8 s timeout, and degrades to `null` plus a plain-language notice.
 */
import { describeFailure, fetchJson, USER_AGENT, type FetchLike } from "./http";
import { gridKey, LruCache } from "./lru";
import { fetchPowerHeat } from "./nasa-power";
import type { AlertGeometry, FemaZone, HeatDay, HeatSource, LiveAlert, LiveAlerts, LookupAddress } from "./types";

export class LookupError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LookupError";
  }
}

export interface Sourced<T> {
  value: T | null;
  notice?: string;
  /** Which service the value came from, when a fallback exists (heat: Open-Meteo, or NASA POWER when Open-Meteo failed). */
  source?: HeatSource;
}

// ---------------------------------------------------------------- Census

interface CensusResponse {
  result?: {
    addressMatches?: Array<{
      matchedAddress: string;
      coordinates: { x: number; y: number };
      addressComponents?: { state?: string; city?: string };
      geographies?: { Counties?: Array<{ NAME?: string }> };
    }>;
  };
}

const MAX_ADDRESS_LENGTH = 200;

/** Characters that never belong in a street address: markup, braces, pipes, backslashes, backticks and control characters. */
const NOT_ADDRESS_CHARS = /[<>{}|\\`\u0000-\u001f\u007f]/;
export const NOT_AN_ADDRESS = "That doesn't look like a street address. Type the house number, street, city and state, like 100 James Robertson Pkwy, Nashville, TN.";

/**
 * Match a typed address with the US Census geocoder. The oneline endpoint only
 * returns street-address matches, so a bare city or ZIP comes back empty.
 * Throws a LookupError with a message that is safe to show.
 */
export async function geocodeAddress(input: string, fetchFn: FetchLike): Promise<LookupAddress> {
  const address = input.trim();
  if (!address) throw new LookupError(400, "Type a street address, like 100 James Robertson Pkwy, Nashville, TN.");
  if (address.length > MAX_ADDRESS_LENGTH) throw new LookupError(400, "That address is too long. Try just the street, city and state.");
  // Markup or other junk is the visitor's input, not our failure: say so plainly (400) before asking the Census anything.
  if (NOT_ADDRESS_CHARS.test(address) || !/[A-Za-z0-9]/.test(address)) throw new LookupError(400, NOT_AN_ADDRESS);

  const url =
    "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress" +
    `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`;
  let result = await fetchJson<CensusResponse>(fetchFn, url);
  // The Census geocoder now and then fails fast (a dropped connection, a 5xx) and answers a second later. One retry, only for those
  // quick failures: a timeout is not retried, so the wait never doubles.
  if (!result.ok && (result.reason === "network" || (result.reason === "http" && (result.status ?? 0) >= 500))) result = await fetchJson<CensusResponse>(fetchFn, url);

  if (!result.ok) {
    // The Census refusing the request itself (a 4xx) means it did not like the text; a timeout, a 5xx or no network is on its side.
    if (result.reason === "http" && result.status !== undefined && result.status >= 400 && result.status < 500 && result.status !== 429) throw new LookupError(400, NOT_AN_ADDRESS);
    throw new LookupError(502, `${describeFailure("The US Census address service", result)} Please try again in a moment.`);
  }

  const match = result.data.result?.addressMatches?.[0];
  if (!match) {
    throw new LookupError(
      404,
      "The Census could not match that to a street address. Include the house number, street, city and state.",
    );
  }

  const county = match.geographies?.Counties?.[0]?.NAME ?? null;
  return {
    input: address,
    matched: match.matchedAddress,
    lat: match.coordinates.y,
    lon: match.coordinates.x,
    state: (match.addressComponents?.state ?? "").toUpperCase(),
    county: county ? county.replace(/ County$/, "") : null,
    city: match.addressComponents?.city ?? null,
  };
}

// ---------------------------------------------------------------- FEMA

interface FemaResponse {
  features?: Array<{ attributes?: { FLD_ZONE?: string; ZONE_SUBTY?: string; SFHA_TF?: string } }>;
}

/** FEMA National Flood Hazard Layer (layer 28, flood hazard zones) at a point. */
export async function fetchFemaZone(lat: number, lon: number, fetchFn: FetchLike): Promise<Sourced<FemaZone>> {
  const url =
    "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query" +
    `?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    "&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF&returnGeometry=false&f=json";
  const result = await fetchJson<FemaResponse>(fetchFn, url);

  if (!result.ok) return { value: null, notice: describeFailure("FEMA's flood map service", result) };

  const attributes = result.data.features?.[0]?.attributes;
  if (!attributes?.FLD_ZONE) {
    return { value: null, notice: "FEMA has no mapped flood zone at this address." };
  }
  return {
    value: {
      zone: attributes.FLD_ZONE,
      subtype: attributes.ZONE_SUBTY ?? "",
      sfha: attributes.SFHA_TF === "T",
    },
  };
}

// ---------------------------------------------------------------- NWS alerts

interface NwsAlertsResponse {
  features?: Array<{
    id?: string;
    geometry?: AlertGeometry | null;
    properties?: {
      event?: string;
      headline?: string | null;
      ends?: string | null;
      expires?: string | null;
      severity?: string | null;
      urgency?: string | null;
      parameters?: { eventMotionDescription?: string[] };
    };
  }>;
}

/** Active alerts at a point from api.weather.gov. An empty list is a real "all quiet". */
export async function fetchActiveAlerts(
  lat: number,
  lon: number,
  fetchFn: FetchLike,
  now: () => Date = () => new Date(),
): Promise<Sourced<LiveAlerts>> {
  const url = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;
  const result = await fetchJson<NwsAlertsResponse>(fetchFn, url, {
    headers: { Accept: "application/geo+json", "User-Agent": USER_AGENT },
  });

  if (!result.ok) return { value: null, notice: describeFailure("The National Weather Service alert feed", result) };

  const alerts: LiveAlert[] = (result.data.features ?? []).map((feature, i) => {
    const p = feature.properties ?? {};
    return {
      id: feature.id ?? `alert-${i}`,
      event: p.event ?? "Alert",
      headline: p.headline ?? "",
      ends: p.ends ?? p.expires ?? null,
      polygon: feature.geometry ?? null,
      motion: p.parameters?.eventMotionDescription?.[0] ?? null,
      severity: p.severity ?? null,
      urgency: p.urgency ?? null,
    };
  });
  return { value: { checkedAt: now().toISOString(), alerts } };
}

// ---------------------------------------------------------------- Open-Meteo heat

export interface OpenMeteoResponse {
  daily?: { time?: string[]; apparent_temperature_max?: Array<number | null> };
}

export const HEAT_THRESHOLD_F = 100;
const HEAT_FIRST_YEAR = 2000;

/**
 * The archive is past data, so repeat lookups near the same spot reuse it for six hours (an LRU, 100 places). The key is the
 * 0.05 degree cell (about 5 km; the archive's own grid is 10 to 25 km) and the request is made for the cell's centre, so every
 * address in a cell gets the same answer. This keeps us well inside Open-Meteo's free daily limit. The sample addresses do not
 * come through here at all: they read a build-time snapshot (lib/samples.ts).
 */
const HEAT_CACHE_MS = 6 * 60 * 60 * 1000;
const HEAT_CACHE_MAX = 100;
const heatCache = new LruCache<HeatDay[]>(HEAT_CACHE_MAX, HEAT_CACHE_MS);

export function clearHeatCache(): void {
  heatCache.clear();
}

/** The archive request for a point: daily feels-like highs, first year through the end of last year, Fahrenheit, local dates. */
export function heatArchiveUrl(lat: number, lon: number, lastYear: number, places = 4): string {
  return (
    "https://archive-api.open-meteo.com/v1/archive" +
    `?latitude=${lat.toFixed(places)}&longitude=${lon.toFixed(places)}` +
    `&start_date=${HEAT_FIRST_YEAR}-01-01&end_date=${lastYear}-12-31` +
    "&daily=apparent_temperature_max&temperature_unit=fahrenheit&timezone=auto"
  );
}

/** The days with a number, from an archive reply. */
export function heatDaysFromArchive(data: OpenMeteoResponse): HeatDay[] {
  const dates = data.daily?.time ?? [];
  const highs = data.daily?.apparent_temperature_max ?? [];
  const days: HeatDay[] = [];
  dates.forEach((date, i) => {
    const feelsF = highs[i];
    if (typeof feelsF === "number") days.push({ date, feelsF });
  });
  return days;
}

/**
 * Daily feels-like highs from the Open-Meteo archive, first year through the end of last year. One variable only: the cost is the 26 years,
 * not the columns. When Open-Meteo is rate limited (429) or otherwise fails, the highs come from NASA POWER instead (a heat index, not
 * the same measure), and the answer says so in `source`. Only when both fail is there a notice.
 */
export async function fetchDailyFeelsLike(
  lat: number,
  lon: number,
  fetchFn: FetchLike,
  now: () => Date = () => new Date(),
): Promise<Sourced<HeatDay[]>> {
  const lastYear = now().getUTCFullYear() - 1;
  const cell = gridKey(lat, lon);
  const cacheKey = `${cell.key},${lastYear}`;
  const cached = heatCache.get(cacheKey, now().getTime());
  if (cached) return { value: cached, source: "open-meteo" };

  const result = await fetchJson<OpenMeteoResponse>(fetchFn, heatArchiveUrl(cell.lat, cell.lon, lastYear, 2));
  const days = result.ok ? heatDaysFromArchive(result.data) : [];
  if (days.length > 0) {
    heatCache.set(cacheKey, days, now().getTime());
    return { value: days, source: "open-meteo" };
  }

  const notice = result.ok
    ? "The Open-Meteo weather archive had no temperature data for this address."
    : describeFailure("The Open-Meteo weather archive", result);
  const power = await fetchPowerHeat(lat, lon, fetchFn, now);
  if (power.value) return { value: power.value, source: "nasa-power" };
  // Both failed: Open-Meteo's reason leads (it is the primary source), and the fallback's follows.
  return { value: null, notice: `${notice} The fallback did not work either: ${power.notice}` };
}
