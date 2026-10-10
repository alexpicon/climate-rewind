/**
 * The NWS forecast for the next seven local days at a point: api.weather.gov /points, then the gridpoint (hourly numbers) and the
 * forecast periods (the NWS's own short words). Plus NWS HeatRisk for each of the seven days. Every call has the usual timeout and
 * degrades to a plain notice; tests pass a fake fetch.
 */
import { localDate, parseIsoDuration, shiftDate } from "../flood-trigger";
import { describeFailure, fetchJson, USER_AGENT, type FetchLike } from "../http";
import { heatRiskUrl, parseHeatRiskValue } from "../outlooks";
import type { DayForecast, DayOfficial } from "./types";

const HOUR_MS = 3_600_000;
export const WEEK_DAYS = 7;
/** A day needs this many forecast hours to count; the last day of the grid is often a partial one. */
export const MIN_HOURS = 6;

type Series = { uom?: string; values?: Array<{ validTime?: string; value?: number | null }> } | undefined;

const cToF = (c: number) => (c * 9) / 5 + 32;
const mmToIn = (mm: number) => mm / 25.4;
const kmhToMph = (k: number) => k / 1.609344;
const round = (n: number, places = 0) => Math.round(n * 10 ** places) / 10 ** places;

interface Slice {
  date: string;
  /** Hours of this period that fall on `date`. */
  hours: number;
  /** Hours in the whole period. */
  periodHours: number;
  value: number;
}

/** Splits each hourly-or-longer period of a grid series into the local days it covers. Hours outside `wanted` are skipped. */
function slices(series: Series, timeZone: string, wanted: readonly string[]): Slice[] {
  const out: Slice[] = [];
  for (const entry of series?.values ?? []) {
    if (typeof entry.value !== "number" || !entry.validTime) continue;
    const [start, duration] = entry.validTime.split("/");
    const startMs = Date.parse(start);
    const lengthMs = duration ? parseIsoDuration(duration) : null;
    if (!Number.isFinite(startMs) || !lengthMs) continue;
    const periodHours = Math.max(1, Math.round(lengthMs / HOUR_MS));
    const perDay = new Map<string, number>();
    for (let t = startMs; t < startMs + lengthMs; t += HOUR_MS) {
      const date = localDate(t, timeZone);
      if (wanted.includes(date)) perDay.set(date, (perDay.get(date) ?? 0) + 1);
    }
    for (const [date, hours] of perDay) out.push({ date, hours, periodHours, value: entry.value });
  }
  return out;
}

interface GridProps {
  temperature?: Series;
  apparentTemperature?: Series;
  probabilityOfPrecipitation?: Series;
  quantitativePrecipitation?: Series;
  snowfallAmount?: Series;
  windGust?: Series;
}

export interface PeriodWords {
  startTime?: string;
  isDaytime?: boolean;
  shortForecast?: string;
}

/**
 * Seven local days of forecast numbers from the gridpoint properties: high and low temperature, the highest feels-like, the highest
 * rain chance, total rain and snow (inches), the highest wind gust (mph). A day with fewer than MIN_HOURS hours is returned with
 * every number null (never counted as dry or calm).
 */
export function weekFromGrid(grid: GridProps, periods: readonly PeriodWords[], timeZone: string, now: Date, count = WEEK_DAYS): DayForecast[] {
  const today = localDate(now.getTime(), timeZone);
  const wanted = Array.from({ length: count }, (_, i) => shiftDate(today, i));

  const hoursOf = new Map<string, number>();
  const temps = slices(grid.temperature, timeZone, wanted);
  for (const s of temps) hoursOf.set(s.date, (hoursOf.get(s.date) ?? 0) + s.hours);

  const maxOf = (series: Series, convert: (n: number) => number) => {
    const m = new Map<string, number>();
    for (const s of slices(series, timeZone, wanted)) m.set(s.date, Math.max(m.get(s.date) ?? -Infinity, convert(s.value)));
    return m;
  };
  const minOf = (series: Series, convert: (n: number) => number) => {
    const m = new Map<string, number>();
    for (const s of slices(series, timeZone, wanted)) m.set(s.date, Math.min(m.get(s.date) ?? Infinity, convert(s.value)));
    return m;
  };
  /** Totals: a period's amount is shared out by the hours that fall on each day. */
  const sumOf = (series: Series, convert: (n: number) => number) => {
    const m = new Map<string, number>();
    for (const s of slices(series, timeZone, wanted)) m.set(s.date, (m.get(s.date) ?? 0) + (convert(s.value) * s.hours) / s.periodHours);
    return m;
  };

  const high = maxOf(grid.temperature, cToF);
  const low = minOf(grid.temperature, cToF);
  const feels = maxOf(grid.apparentTemperature, cToF);
  const pop = maxOf(grid.probabilityOfPrecipitation, (n) => n);
  const gust = maxOf(grid.windGust, kmhToMph);
  const rain = sumOf(grid.quantitativePrecipitation, mmToIn);
  const snow = sumOf(grid.snowfallAmount, mmToIn);

  // The NWS words for the day: the daytime period that starts on that date; for tonight (no daytime period left), the night one.
  const words = new Map<string, string>();
  for (const p of periods) {
    const date = p.startTime?.slice(0, 10);
    if (!date || !p.shortForecast) continue;
    if (!words.has(date) || p.isDaytime) words.set(date, p.shortForecast);
  }

  return wanted.map((date) => {
    const covered = (hoursOf.get(date) ?? 0) >= MIN_HOURS;
    const pick = (m: Map<string, number>, places = 0): number | null => (covered && m.has(date) ? round(m.get(date) as number, places) : null);
    return {
      date,
      highF: pick(high),
      lowF: pick(low),
      feelsF: pick(feels),
      rainChance: pick(pop),
      rainIn: pick(rain, 2),
      snowIn: pick(snow, 1),
      gustMph: pick(gust),
      words: covered ? (words.get(date) ?? null) : null,
    };
  });
}

// ---------------------------------------------------------------- the calls

const NWS_HEADERS = { Accept: "application/geo+json", "User-Agent": USER_AGENT };
const NWS = "https://api.weather.gov/";

interface PointsReply {
  properties?: { forecast?: string; forecastGridData?: string; timeZone?: string };
}

export async function fetchWeekForecast(lat: number, lon: number, fetchFn: FetchLike, now: Date): Promise<{ value: { days: DayForecast[]; timeZone: string } | null; notice?: string }> {
  const points = await fetchJson<PointsReply>(fetchFn, `${NWS}points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: NWS_HEADERS });
  if (!points.ok) return { value: null, notice: describeFailure("The National Weather Service forecast", points) };
  const { forecast, forecastGridData: gridUrl, timeZone } = points.data.properties ?? {};
  if (!gridUrl || !timeZone || !gridUrl.startsWith(NWS)) return { value: null, notice: "The National Weather Service has no forecast for this address." };

  const [grid, periods] = await Promise.all([
    fetchJson<{ properties?: GridProps }>(fetchFn, gridUrl, { headers: NWS_HEADERS }),
    forecast && forecast.startsWith(NWS) ? fetchJson<{ properties?: { periods?: PeriodWords[] } }>(fetchFn, forecast, { headers: NWS_HEADERS }) : Promise.resolve(null),
  ]);
  if (!grid.ok) return { value: null, notice: describeFailure("The National Weather Service forecast", grid) };
  if (!grid.data.properties) return { value: null, notice: "The National Weather Service forecast sent a reply we could not read." };
  try {
    const words = periods && periods.ok ? (periods.data.properties?.periods ?? []) : [];
    return { value: { days: weekFromGrid(grid.data.properties, words, timeZone, now), timeZone } };
  } catch {
    return { value: null, notice: "The National Weather Service forecast sent a time zone we could not read." };
  }
}

/** NWS HeatRisk (experimental) for each of the seven days; NoData (past the end of the product) is null. */
export async function fetchWeekHeatRisk(lat: number, lon: number, dates: readonly string[], fetchFn: FetchLike): Promise<{ value: Array<DayOfficial["heatRisk"]> | null; notice?: string }> {
  const results = await Promise.all(dates.map((date) => fetchJson<{ value?: string | number | null }>(fetchFn, heatRiskUrl(lat, lon, date))));
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok && results.every((r) => !r.ok)) return { value: null, notice: describeFailure("The NWS HeatRisk service", failed) };
  const levels = results.map((r) => (r.ok ? parseHeatRiskValue(r.data.value) : null));
  return levels.every((l) => l === null) ? { value: null, notice: "The NWS HeatRisk service has no value at this address." } : { value: levels };
}
