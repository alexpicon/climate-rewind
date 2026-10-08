/**
 * Official outlooks at a point, for "Your street's next 72 hours".
 *
 *   Flood    WPC Excessive Rainfall Outlook, Days 1 to 3        (Iowa Environmental Mesonet api/1/nws/outlook_by_point.json)
 *   Tornado  SPC tornado probability Days 1 and 2, and the Day 3 any-severe probability (same API)
 *   Heat     NWS HeatRisk (experimental), Days 1 to 3           (mapservices.weather.noaa.gov ArcGIS ImageServer identify)
 *            and the NWS forecast feels-like highs              (api.weather.gov gridpoint apparentTemperature)
 *
 * These are the agencies' products read at the address, nothing more. The local track record (lib/outlook-record.ts) only counts
 * how past days with the same outlook turned out here. Every call has the usual 8 s timeout and degrades to a plain notice;
 * tests pass a fake fetch.
 */
import { localDate, parseIsoDuration, shiftDate } from "./flood-trigger";
import { describeFailure, fetchJson, USER_AGENT, type FetchLike } from "./http";
import { LruCache } from "./lru";
import {
  findOutlookRecord,
  loadOutlookRecords,
  rankFeels,
  type OutlookRecordFile,
} from "./outlook-record";
import type {
  EroLevel,
  FloodOutlookDay,
  HeatForecastDay,
  HeatRiskDay,
  OutlookPayload,
  TornadoOutlookDay,
} from "./outlook-types";

const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------- IEM outlook_by_point

interface IemRow {
  day?: number | string;
  outlook_type?: string;
  threshold?: string;
  category?: string;
}

interface IemReply {
  data?: IemRow[];
}

const ERO_ORDER: EroLevel[] = ["none", "MRGL", "SLGT", "ENH", "MDT", "HIGH"];

/**
 * The NWS outlook day starts at 12Z. "Day 1" is the day whose period (12Z to 12Z) contains `now`, so its calendar date is the
 * UTC date of (now minus 12 hours). Days 2 and 3 follow.
 */
export function outlookDates(now: Date): [string, string, string] {
  const day1 = new Date(now.getTime() - 12 * HOUR_MS).toISOString().slice(0, 10);
  return [day1, shiftDate(day1, 1), shiftDate(day1, 2)];
}

/**
 * Reads IEM's rows for a point into three flood days and three tornado days. IEM returns only the products whose polygons
 * contain the point, so a day with no row is a day with no risk area here. ERO rows are `E` with a categorical threshold;
 * SPC rows are `C`, where `TORNADO` (Days 1, 2) and `ANY SEVERE` (Day 3) carry a probability in the threshold ("0.05").
 */
export function parseIemOutlooks(rows: IemRow[], now: Date): { flood: FloodOutlookDay[]; tornado: TornadoOutlookDay[] } {
  const dates = outlookDates(now);
  const flood: FloodOutlookDay[] = [];
  const tornado: TornadoOutlookDay[] = [];
  ([1, 2, 3] as const).forEach((day, i) => {
    let level: EroLevel = "none";
    let percent = 0;
    const kind = day === 3 ? "severe" : "tornado";
    for (const row of rows) {
      if (Number(row.day) !== day) continue;
      if (row.outlook_type === "E" && row.category === "CATEGORICAL") {
        const found = ERO_ORDER.find((candidate) => candidate === row.threshold);
        if (found && ERO_ORDER.indexOf(found) > ERO_ORDER.indexOf(level)) level = found;
      }
      const wantedCategory = day === 3 ? "ANY SEVERE" : "TORNADO";
      if (row.outlook_type === "C" && row.category === wantedCategory) {
        const probability = Math.round(Number(row.threshold) * 100);
        if (Number.isFinite(probability) && probability > percent) percent = probability;
      }
    }
    flood.push({ day, date: dates[i], level });
    tornado.push({ day, date: dates[i], kind, percent });
  });
  return { flood, tornado };
}

export function iemUrl(lat: number, lon: number): string {
  return `https://mesonet.agron.iastate.edu/api/1/nws/outlook_by_point.json?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
}

async function fetchIem(lat: number, lon: number, fetchFn: FetchLike, now: Date) {
  const result = await fetchJson<IemReply>(fetchFn, iemUrl(lat, lon), { headers: { "User-Agent": USER_AGENT } });
  if (!result.ok) return { value: null, notice: describeFailure("The Iowa Environmental Mesonet outlook service", result) };
  if (!Array.isArray(result.data.data)) {
    return { value: null, notice: "The Iowa Environmental Mesonet outlook service sent a reply we could not read." };
  }
  return { value: parseIemOutlooks(result.data.data, now) };
}

// ---------------------------------------------------------------- HeatRisk

interface IdentifyReply {
  value?: string | number | null;
}

/** The ArcGIS identify request for one HeatRisk day: the pixel under the point at 12Z of that date. */
export function heatRiskUrl(lat: number, lon: number, date: string): string {
  const geometry = encodeURIComponent(JSON.stringify({ x: Number(lon.toFixed(4)), y: Number(lat.toFixed(4)), spatialReference: { wkid: 4326 } }));
  const time = Date.parse(`${date}T12:00:00Z`);
  return (
    "https://mapservices.weather.noaa.gov/experimental/rest/services/NWS_HeatRisk/ImageServer/identify" +
    `?geometry=${geometry}&geometryType=esriGeometryPoint&time=${time}&returnGeometry=false&returnCatalogItems=false&f=json`
  );
}

/** "3" to 3. "NoData", empty, or anything outside 0 to 4 to null. */
export function parseHeatRiskValue(value: unknown): HeatRiskDay["level"] {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 4 ? (n as HeatRiskDay["level"]) : null;
}

async function fetchHeatRisk(lat: number, lon: number, fetchFn: FetchLike, now: Date): Promise<{ value: HeatRiskDay[] | null; notice?: string }> {
  const dates = outlookDates(now);
  const results = await Promise.all(dates.map((date) => fetchJson<IdentifyReply>(fetchFn, heatRiskUrl(lat, lon, date))));
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok && results.every((r) => !r.ok)) return { value: null, notice: describeFailure("The NWS HeatRisk service", failed) };
  const days: HeatRiskDay[] = results.map((r, i) => ({
    day: (i + 1) as 1 | 2 | 3,
    date: dates[i],
    level: r.ok ? parseHeatRiskValue(r.data.value) : null,
  }));
  if (days.every((d) => d.level === null)) return { value: null, notice: "The NWS HeatRisk service has no value at this address." };
  return { value: days };
}

// ---------------------------------------------------------------- NWS feels-like forecast

interface PointsReply {
  properties?: { forecastGridData?: string; timeZone?: string };
}

interface GridReply {
  properties?: { apparentTemperature?: { uom?: string; values?: Array<{ validTime?: string; value?: number | null }> } };
}

const celsiusToF = (c: number) => (c * 9) / 5 + 32;
/** A forecast day needs this many hourly values to count (so an evening-only "today" is not mistaken for the day's high). */
const MIN_HOURS_PER_DAY = 18;

/** Daily maximum of the hourly apparent temperature (C in, F out) for the next `count` local days. A day with too few hours is left out. */
export function feelsLikeByLocalDay(
  values: Array<{ validTime?: string; value?: number | null }>,
  timeZone: string,
  now: Date,
  count = 3,
): Array<{ date: string; feelsF: number }> {
  const today = localDate(now.getTime(), timeZone);
  const wanted = Array.from({ length: count }, (_, i) => shiftDate(today, i));
  const max = new Map<string, number>();
  const hours = new Map<string, number>();
  for (const entry of values) {
    if (typeof entry.value !== "number" || !entry.validTime) continue;
    const [start, duration] = entry.validTime.split("/");
    const startMs = Date.parse(start);
    const lengthMs = duration ? parseIsoDuration(duration) : null;
    if (!Number.isFinite(startMs) || !lengthMs) continue;
    for (let t = startMs; t < startMs + lengthMs; t += HOUR_MS) {
      const date = localDate(t, timeZone);
      if (!wanted.includes(date)) continue;
      hours.set(date, (hours.get(date) ?? 0) + 1);
      max.set(date, Math.max(max.get(date) ?? -Infinity, entry.value));
    }
  }
  return wanted
    .filter((date) => (hours.get(date) ?? 0) >= MIN_HOURS_PER_DAY)
    .map((date) => ({ date, feelsF: Math.round(celsiusToF(max.get(date) as number) * 10) / 10 }));
}

const NWS_HEADERS = { Accept: "application/geo+json", "User-Agent": USER_AGENT };

async function fetchFeelsForecast(lat: number, lon: number, fetchFn: FetchLike, now: Date): Promise<{ value: Array<{ date: string; feelsF: number }> | null; notice?: string }> {
  const points = await fetchJson<PointsReply>(fetchFn, `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: NWS_HEADERS });
  if (!points.ok) return { value: null, notice: describeFailure("The National Weather Service forecast", points) };
  const gridUrl = points.data.properties?.forecastGridData;
  const timeZone = points.data.properties?.timeZone;
  if (!gridUrl || !timeZone || !gridUrl.startsWith("https://api.weather.gov/")) {
    return { value: null, notice: "The National Weather Service has no forecast for this address." };
  }
  const grid = await fetchJson<GridReply>(fetchFn, gridUrl, { headers: NWS_HEADERS });
  if (!grid.ok) return { value: null, notice: describeFailure("The National Weather Service forecast", grid) };
  const apparent = grid.data.properties?.apparentTemperature;
  if (!apparent?.values || apparent.uom !== "wmoUnit:degC") {
    return { value: null, notice: "The National Weather Service forecast did not include feels-like temperatures for this address." };
  }
  try {
    const days = feelsLikeByLocalDay(apparent.values, timeZone, now);
    return days.length ? { value: days } : { value: null, notice: "The National Weather Service forecast did not cover the next 3 days." };
  } catch {
    return { value: null, notice: "The National Weather Service forecast sent a time zone we could not read." };
  }
}

// ---------------------------------------------------------------- the whole picture

export interface OutlookDeps {
  fetch: FetchLike;
  now: () => Date;
  loadRecords: () => Promise<OutlookRecordFile[]>;
}

export const defaultOutlookDeps: OutlookDeps = {
  fetch: (url, init) => fetch(url, init),
  now: () => new Date(),
  loadRecords: loadOutlookRecords,
};

const OUTLOOK_CACHE_MS = 10 * 60_000;
/** The agencies update a few times a day; the same place within ten minutes reuses the answer (shared by the page and the AI brief). */
const outlookCache = new LruCache<OutlookPayload>(100, OUTLOOK_CACHE_MS);

export function clearOutlookCache(): void {
  outlookCache.clear();
}

export const NO_RECORD_NOTICE = "The local track record is built for the four sample addresses so far. This address shows the official outlooks only.";

/** Everything for one address: the three official outlooks, plus the local record when this is a sample address. */
export async function buildOutlook(lat: number, lon: number, deps: OutlookDeps = defaultOutlookDeps): Promise<OutlookPayload> {
  const nowDate = deps.now();
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = outlookCache.get(key, nowDate.getTime());
  if (cached) return cached;

  const [iem, risk, feels, records] = await Promise.all([
    fetchIem(lat, lon, deps.fetch, nowDate),
    fetchHeatRisk(lat, lon, deps.fetch, nowDate),
    fetchFeelsForecast(lat, lon, deps.fetch, nowDate),
    deps.loadRecords().catch(() => []),
  ]);
  const record = findOutlookRecord(lat, lon, records);
  const heatHistory = record?.heat ?? null;

  const forecast: HeatForecastDay[] | null = feels.value
    ? feels.value.map((day) => ({ date: day.date, feelsF: day.feelsF, rank: heatHistory ? rankFeels(heatHistory, day.date, day.feelsF) : null }))
    : null;

  const payload: OutlookPayload = {
    checkedAt: nowDate.toISOString(),
    recordSlug: record?.slug ?? null,
    flood: { days: iem.value?.flood ?? null, record: record?.flood ?? null, ...(iem.notice ? { notice: iem.notice } : {}) },
    tornado: { days: iem.value?.tornado ?? null, record: record?.tornado ?? null, ...(iem.notice ? { notice: iem.notice } : {}) },
    heat: {
      risk: risk.value,
      forecast,
      hasHistory: !!heatHistory,
      notices: {
        ...(risk.notice ? { risk: risk.notice } : {}),
        ...(feels.notice ? { forecast: feels.notice } : {}),
        ...(record && !heatHistory ? { history: "This address's feels-like history is not saved yet, so there is no ranking." } : {}),
      },
    },
    recordNotice: record ? null : NO_RECORD_NOTICE,
  };

  // Only a complete answer is reused: a failed source should be tried again on the next look.
  if (iem.value && !feels.notice && !risk.notice) outlookCache.set(key, payload, nowDate.getTime());
  return payload;
}
