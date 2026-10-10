/**
 * "Your street's flood trigger": a history-based signal, not a flood forecast.
 *
 * History: the distinct local dates with flood reports within 5 km of the address, and the rain on each: measured by the nearest
 * NOAA rain gauge first (lib/rain-gauge.ts), and only for dates no gauge read, the Open-Meteo archive at the address (ERA5
 * `precipitation_sum`, inches; the larger of the day and the day before). With 3 or more dates the
 * signal is the MEDIAN of those totals: "on days with flood reports here, the typical rain was X in". (The lowest total was tried
 * first and is noise: ERA5 is a point on a grid and misses short bursts and flooding from upstream, so one day reads 0.08 in.)
 *
 * Forecast: the National Weather Service's gridded `quantitativePrecipitation` for the next 3 local days, compared with the median:
 * below, near (within 20% either way) or above.
 *
 * The sample addresses read their rain history from a build-time snapshot (`knownRain`), so only the live forecast is fetched.
 * When Open-Meteo is rate limited or down, the rain comes from NASA POWER (MERRA-2) instead, and the trigger says so (`rainSource`).
 *
 * Every outside call has the usual 8 s timeout and degrades to a plain-language notice. Tests pass a fake fetch.
 */
import { BUSY_NOTICE, describeFailure, fetchJson, USER_AGENT, type FetchLike } from "./http";
import { withOpenMeteoKey } from "./open-meteo";
import { gridKey, LruCache } from "./lru";
import { fetchPowerRain } from "./nasa-power";
import { fetchGaugeRain, type GaugeRain } from "./rain-gauge";
import type { FloodTrigger, ForecastDay, NearbyFlood, TriggerDay, TriggerVerdict } from "./types";

/** Fewer flood dates than this and there is no honest trigger. */
export const MIN_FLOOD_DAYS = 3;
/** A forecast within this share of the typical flood-day rain, either way, counts as "near" it. */
export const NEAR_BAND = 0.2;
/** Days of forecast to compare, starting with today. */
export const FORECAST_DAYS = 3;

const MM_PER_INCH = 25.4;
const DAY_MS = 86_400_000;
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

// ---------------------------------------------------------------- history

/** The distinct local dates (YYYY-MM-DD, as written in each report's own timestamp) of the given flood reports. */
export function floodDates(reports: Array<Pick<NearbyFlood, "start">>): string[] {
  const dates = new Set<string>();
  for (const report of reports) {
    const date = report.start.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates.add(date);
  }
  return [...dates].sort();
}

export const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * The rain on each flood date: the larger of that day's total and the day before's (a storm often starts the evening before,
 * and reports are filed after midnight). A date whose own total is missing is left out.
 */
export function rainOnFloodDates(dates: string[], rainByDate: ReadonlyMap<string, number | null>): TriggerDay[] {
  const days: TriggerDay[] = [];
  for (const date of dates) {
    const same = rainByDate.get(date);
    if (typeof same !== "number") continue;
    const before = rainByDate.get(shiftDate(date, -1));
    days.push({ date, rainIn: round(typeof before === "number" ? Math.max(same, before) : same, 2) });
  }
  return days.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** The typical rain on a flood date: the median of the totals (the mean of the middle two when the count is even). Null with fewer than 3 dates. */
export function triggerOf(history: TriggerDay[]): number | null {
  if (history.length < MIN_FLOOD_DAYS) return null;
  const sorted = history.map((day) => day.rainIn).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, 2);
}

export interface ArchiveResponse {
  daily?: { time?: string[]; precipitation_sum?: Array<number | null> };
}

const RAIN_CACHE_MS = 6 * 60 * 60 * 1000;
const RAIN_CACHE_MAX = 200;
/** Past rain never changes, so a place's 0.05 degree cell and date range is reused for six hours (an LRU). */
const rainCache = new LruCache<Map<string, number | null>>(RAIN_CACHE_MAX, RAIN_CACHE_MS);

export function clearRainCache(): void {
  rainCache.clear();
}

/**
 * Open-Meteo's free tier counts a request as (days / 14) calls, at least 1, against 10,000 a day. One request spanning
 * 2015 to 2025 costs about 290; a request for a flood date and the day before costs 1. So the dates are fetched as short
 * ranges (nearby dates share one), unless one long range would cost less.
 */
export function rainRanges(dates: string[]): Array<{ start: string; end: string }> {
  const sorted = [...dates].sort();
  const merged: Array<{ start: string; end: string }> = [];
  for (const date of sorted) {
    const range = { start: shiftDate(date, -1), end: date };
    const last = merged[merged.length - 1];
    // Ranges closer than a week apart share a request (cheaper than two).
    if (last && Date.parse(`${range.start}T00:00:00Z`) - Date.parse(`${last.end}T00:00:00Z`) <= 7 * DAY_MS) last.end = range.end > last.end ? range.end : last.end;
    else merged.push(range);
  }
  const days = (r: { start: string; end: string }) => Math.round((Date.parse(`${r.end}T00:00:00Z`) - Date.parse(`${r.start}T00:00:00Z`)) / DAY_MS) + 1;
  const cost = (rs: Array<{ start: string; end: string }>) => rs.reduce((sum, r) => sum + Math.max(1, Math.ceil(days(r) / 14)), 0);
  if (merged.length === 0) return merged;
  const single = [{ start: merged[0].start, end: merged[merged.length - 1].end }];
  return cost(single) <= cost(merged) ? single : merged;
}

/** Where a set of rain totals came from. */
export type RainOrigin = "era5" | "nasa-power" | "mixed";

/**
 * Daily rain totals (inches) at a point for the days around the given flood dates: Open-Meteo (ERA5) first. Any range it cannot
 * give (a 429, a timeout, no data) is asked of NASA POWER in ONE request spanning those ranges. `origin` says which was used.
 */
export async function fetchRainForDates(
  lat: number,
  lon: number,
  dates: string[],
  fetchFn: FetchLike,
  now: () => Date = () => new Date(),
): Promise<{ rain: Map<string, number | null> | null; notice?: string; origin?: RainOrigin }> {
  const ranges = rainRanges(dates);
  const results = await Promise.all(ranges.map((range) => fetchDailyRain(lat, lon, range.start, range.end, fetchFn, now)));
  if (results.length === 0) return { rain: null, notice: "The Open-Meteo weather archive had no rainfall records for this address." };

  const rain = new Map<string, number | null>();
  const missing = ranges.filter((_range, i) => !results[i].rain);
  for (const r of results) for (const [date, inches] of r.rain ?? []) rain.set(date, inches);
  if (missing.length === 0) return { rain, origin: "era5" };

  const first = missing.map((range) => range.start).sort()[0];
  const last = missing.map((range) => range.end).sort().at(-1) as string;
  const power = await fetchPowerRain(lat, lon, first, last, fetchFn, now);
  const reason = results.find((r) => !r.rain)?.notice ?? "The Open-Meteo weather archive had no rainfall records for this address.";
  if (!power.value) return { rain: null, notice: reason === BUSY_NOTICE ? reason : `${reason} The fallback did not work either: ${power.notice}` };
  for (const range of missing) {
    for (let day = range.start; day <= range.end; day = shiftDate(day, 1)) rain.set(day, power.value.get(day) ?? null);
  }
  return { rain, origin: missing.length === ranges.length ? "nasa-power" : "mixed" };
}

/** The archive request for a point and a range of dates: one daily variable, inches, ERA5, local dates. */
export function rainArchiveUrl(lat: number, lon: number, startDate: string, endDate: string, places = 4): string {
  return withOpenMeteoKey(
    "https://archive-api.open-meteo.com/v1/archive" +
    `?latitude=${lat.toFixed(places)}&longitude=${lon.toFixed(places)}&start_date=${startDate}&end_date=${endDate}` +
    "&daily=precipitation_sum&precipitation_unit=inch&models=era5&timezone=auto"
  );
}

/** Date to inches from an archive reply (null where the archive has no total). */
export function rainFromArchive(data: ArchiveResponse): Map<string, number | null> {
  const dates = data.daily?.time ?? [];
  const totals = data.daily?.precipitation_sum ?? [];
  const rain = new Map<string, number | null>();
  dates.forEach((date, i) => rain.set(date, typeof totals[i] === "number" ? (totals[i] as number) : null));
  return rain;
}

/** Daily rain totals (inches) at a point from the Open-Meteo archive (ERA5), for a range of dates. */
export async function fetchDailyRain(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
  fetchFn: FetchLike,
  now: () => Date = () => new Date(),
): Promise<{ rain: Map<string, number | null> | null; notice?: string }> {
  const cell = gridKey(lat, lon);
  const key = `${cell.key},${startDate},${endDate}`;
  const cached = rainCache.get(key, now().getTime());
  if (cached) return { rain: cached };

  const result = await fetchJson<ArchiveResponse>(fetchFn, rainArchiveUrl(cell.lat, cell.lon, startDate, endDate, 2));
  if (!result.ok) return { rain: null, notice: describeFailure("The Open-Meteo weather archive", result) };

  const rain = rainFromArchive(result.data);
  if (rain.size === 0) return { rain: null, notice: "The Open-Meteo weather archive had no rainfall records for this address." };

  rainCache.set(key, rain, now().getTime());
  return { rain };
}

// ---------------------------------------------------------------- official forecast

interface PointsResponse {
  properties?: { forecastGridData?: string; timeZone?: string };
}

interface GridResponse {
  properties?: {
    updateTime?: string;
    quantitativePrecipitation?: { uom?: string; values?: Array<{ validTime?: string; value?: number | null }> };
  };
}

/** "PT6H", "PT1H30M", "P1D" to milliseconds. Null for anything else. */
export function parseIsoDuration(text: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(text);
  if (!match || text === "P" || text === "PT") return null;
  return (Number(match[1] ?? 0) * 24 * 60 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)) * 60_000;
}

/** The local calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

const SLICE_MS = 15 * 60_000;

/**
 * Sums the NWS grid's rain periods (millimetres, each over its own validTime like "2026-10-08T12:00:00+00:00/PT6H") into
 * inches per local day for the next `count` days, starting with today. A period that crosses midnight is split by time.
 * A day the grid does not cover at all is left out, never counted as dry.
 */
export function forecastByLocalDay(
  values: Array<{ validTime?: string; value?: number | null }>,
  timeZone: string,
  now: Date,
  count: number = FORECAST_DAYS,
): ForecastDay[] {
  const today = localDate(now.getTime(), timeZone);
  const wanted = Array.from({ length: count }, (_, i) => shiftDate(today, i));
  const totalsMm = new Map<string, number>();
  for (const entry of values) {
    if (typeof entry.value !== "number" || !entry.validTime) continue;
    const [start, duration] = entry.validTime.split("/");
    const startMs = Date.parse(start);
    const lengthMs = duration ? parseIsoDuration(duration) : null;
    if (!Number.isFinite(startMs) || !lengthMs) continue;
    const slices = Math.max(1, Math.round(lengthMs / SLICE_MS));
    const perSlice = entry.value / slices;
    for (let i = 0; i < slices; i += 1) {
      const date = localDate(startMs + (i + 0.5) * (lengthMs / slices), timeZone);
      if (wanted.includes(date)) totalsMm.set(date, (totalsMm.get(date) ?? 0) + perSlice);
    }
  }
  return wanted.filter((date) => totalsMm.has(date)).map((date) => ({ date, inches: round((totalsMm.get(date) ?? 0) / MM_PER_INCH, 2) }));
}

/** The wettest forecast day against the typical flood-day rain. below: under 80% of it. near: within 20% either way. above: over 120% of it. */
export function compareForecast(peakIn: number, typicalIn: number): TriggerVerdict {
  // The small allowance keeps values that sit exactly on an edge (2.4 * 1.2) from flipping on floating point.
  if (peakIn > typicalIn * (1 + NEAR_BAND) + 1e-9) return "above";
  if (peakIn + 1e-9 >= typicalIn * (1 - NEAR_BAND)) return "near";
  return "below";
}

const NWS_HEADERS = { Accept: "application/geo+json", "User-Agent": USER_AGENT };

/** The official forecast (rain per local day, next 3 days) at a point: api.weather.gov points, then its gridded data. */
export async function fetchForecastRain(
  lat: number,
  lon: number,
  fetchFn: FetchLike,
  now: () => Date = () => new Date(),
): Promise<{ days: ForecastDay[] | null; updated: string | null; notice?: string }> {
  const points = await fetchJson<PointsResponse>(fetchFn, `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: NWS_HEADERS });
  if (!points.ok) return { days: null, updated: null, notice: describeFailure("The National Weather Service forecast", points) };

  const gridUrl = points.data.properties?.forecastGridData;
  const timeZone = points.data.properties?.timeZone;
  // Only ever follow the link to the NWS's own API.
  if (!gridUrl || !timeZone || !gridUrl.startsWith("https://api.weather.gov/")) {
    return { days: null, updated: null, notice: "The National Weather Service has no rain forecast for this address." };
  }

  const grid = await fetchJson<GridResponse>(fetchFn, gridUrl, { headers: NWS_HEADERS });
  if (!grid.ok) return { days: null, updated: null, notice: describeFailure("The National Weather Service forecast", grid) };

  const rain = grid.data.properties?.quantitativePrecipitation;
  if (!rain?.values || rain.uom !== "wmoUnit:mm") {
    return { days: null, updated: null, notice: "The National Weather Service forecast did not include rainfall amounts for this address." };
  }
  let days: ForecastDay[];
  try {
    days = forecastByLocalDay(rain.values, timeZone, now());
  } catch {
    return { days: null, updated: null, notice: "The National Weather Service forecast sent a time zone we could not read." };
  }
  if (days.length === 0) return { days: null, updated: null, notice: "The National Weather Service forecast did not cover the next 3 days." };
  return { days, updated: grid.data.properties?.updateTime ?? null };
}

// ---------------------------------------------------------------- the whole signal

const NOTHING_TO_FETCH: { rain: Map<string, number | null> | null; notice?: string; origin?: RainOrigin } = { rain: new Map() };

export interface TriggerDeps {
  fetch: FetchLike;
  now: () => Date;
  /**
   * Daily rain already known for this address (a build-time snapshot, see lib/samples.ts), keyed by date. A flood date counts as
   * covered when both it and the day before it are present; only the other dates are fetched.
   */
  knownRain?: Readonly<Record<string, number | null>>;
  /** False skips the rain gauges (gridded rain only). Default: gauges first. */
  gauges?: boolean;
}

/**
 * Builds the flood trigger for an address from the flood reports within 5 km.
 * Fewer than 3 flood dates: no network calls, "insufficient". Otherwise the rain history (from the snapshot where there is one) and
 * the forecast are fetched in parallel.
 */
export async function buildFloodTrigger(
  address: { lat: number; lon: number },
  reports: Array<Pick<NearbyFlood, "start">>,
  deps: TriggerDeps,
): Promise<FloodTrigger> {
  const dates = floodDates(reports);
  const base: FloodTrigger = { status: "insufficient", floodDays: dates.length, triggerIn: null, history: [], forecast: null, notices: {} };
  if (dates.length < MIN_FLOOD_DAYS) return base;

  const forecastCall = fetchForecastRain(address.lat, address.lon, deps.fetch, deps.now);
  const noGauges: GaugeRain = { days: [] };
  const gauge = deps.gauges === false ? noGauges : await fetchGaugeRain(address.lat, address.lon, dates, deps.fetch, deps.now().getTime()).catch(() => noGauges);
  const measured = new Set(gauge.days.map((day) => day.date));
  // Gridded rain only for the dates no gauge read: the snapshot where there is one, else the archive (and its fallback).
  const rest = dates.filter((date) => !measured.has(date));
  const known = deps.knownRain ?? {};
  const has = (date: string) => Object.hasOwn(known, date);
  const missing = rest.filter((date) => !(has(date) && has(shiftDate(date, -1))));
  const [archive, forecast] = await Promise.all([
    missing.length ? fetchRainForDates(address.lat, address.lon, missing, deps.fetch, deps.now) : Promise.resolve(NOTHING_TO_FETCH),
    forecastCall,
  ]);

  if (!archive.rain && gauge.days.length === 0) return { ...base, status: "unavailable", notices: { history: archive.notice } };
  const rain = new Map<string, number | null>(Object.entries(known));
  for (const [date, inches] of archive.rain ?? []) rain.set(date, inches);
  const history = [...gauge.days, ...rainOnFloodDates(rest, rain)].sort((a, b) => (a.date < b.date ? -1 : 1));
  const triggerIn = triggerOf(history);
  if (triggerIn === null) {
    return { ...base, notices: { history: "The rainfall records did not cover enough of the flood dates for this address." } };
  }

  const result: FloodTrigger = { ...base, status: "ready", triggerIn, history, notices: {} };
  // Gridded rain from the snapshot (or a fetch) is ERA5; if any of it came from NASA POWER, say so.
  if (archive.origin === "nasa-power" || archive.origin === "mixed") {
    const hadEra5 = archive.origin === "mixed" || rest.some((date) => has(date) && has(shiftDate(date, -1)));
    result.rainSource = hadEra5 ? "mixed" : "nasa-power";
  }
  if (!forecast.days) {
    result.notices.forecast = forecast.notice;
    return result;
  }
  const peak = forecast.days.reduce((best, day) => (day.inches > best.inches ? day : best), forecast.days[0]);
  result.forecast = { days: forecast.days, peak, verdict: compareForecast(peak.inches, triggerIn), updated: forecast.updated };
  return result;
}
