/**
 * "What it meant here before" and the one line of climate context, for a notable day. Pure: the address's own records in, sentences out.
 * Only real records are used. When a record is missing the line is null, never filled in. A trend is claimed only when the Mann-Kendall
 * test on the yearly counts has p < 0.05 (lib/climate/trend.ts); otherwise the two decade averages are stated and nothing more.
 */
import { yearlyTrend } from "../climate/trend";
import { FLOOD_RADIUS_KM, TORNADO_RADIUS_KM } from "../constants";
import { ERO_LABEL, type EroLevel, type FloodRecord, type TornadoRecord } from "../outlook-types";
import { FEW_DAYS, recordKeyForLevel, tornadoKeyForPercent } from "../ui/ahead-text";
import { niceDate } from "../ui/text";
import type { AreaEvent } from "../ready/events";
import type { HeatDay, NearbyFlood, NearbyTornado } from "../types";
import type { DayForecast, DayOfficial, WeekHazard } from "./types";

export interface LocalRecord {
  /** Daily feels-like highs since 2000 (the Open-Meteo archive, NASA POWER heat index, or the saved sample record). Null: could not be read. */
  heatDays: HeatDay[] | null;
  floodRecord: FloodRecord | null;
  tornadoRecord: TornadoRecord | null;
  floods: NearbyFlood[];
  tornadoes: NearbyTornado[];
  events: AreaEvent[];
}

const FIRST_DECADE = [2000, 2009] as const;
const LAST_DECADE = [2016, 2025] as const;
/** A year needs this many days with a value to count in the yearly counts. */
const MIN_DAYS_IN_YEAR = 300;
/** Each decade needs this many usable years before its average is quoted. */
const MIN_YEARS_IN_DECADE = 8;

/** Days per year at or above a feels-like threshold, for each year that is nearly complete. */
export function yearlyCounts(days: readonly HeatDay[], thresholdF: number): Map<number, number> {
  const have = new Map<number, number>();
  const hot = new Map<number, number>();
  for (const day of days) {
    const year = Number(day.date.slice(0, 4));
    have.set(year, (have.get(year) ?? 0) + 1);
    if (day.feelsF >= thresholdF) hot.set(year, (hot.get(year) ?? 0) + 1);
  }
  const out = new Map<number, number>();
  for (const [year, n] of have) if (n >= MIN_DAYS_IN_YEAR) out.set(year, hot.get(year) ?? 0);
  return out;
}

function decadeAverage(counts: Map<number, number>, [from, to]: readonly [number, number]): number | null {
  const years = [...counts.keys()].filter((y) => y >= from && y <= to);
  if (years.length < MIN_YEARS_IN_DECADE) return null;
  return years.reduce((sum, y) => sum + (counts.get(y) ?? 0), 0) / years.length;
}

const perYear = (average: number): string => {
  if (average > 0 && average < 0.05) return "under 0.1 a year";
  return `${Math.round(average * 10) / 10} a year`;
};

export interface HeatClimate {
  first: number;
  last: number;
  /** "increasing" or "decreasing" only when the Mann-Kendall test on the yearly counts has p < 0.05. */
  trend: "increasing" | "decreasing" | "none";
}

/** Average days per year at or above the threshold in 2000-2009 and 2016-2025, plus whether the yearly counts show a significant trend. Null when the history is too thin. */
export function heatClimate(days: readonly HeatDay[], thresholdF: number): HeatClimate | null {
  const counts = yearlyCounts(days, thresholdF);
  const first = decadeAverage(counts, FIRST_DECADE);
  const last = decadeAverage(counts, LAST_DECADE);
  if (first === null || last === null) return null;
  const series = [...counts.keys()].sort((a, b) => a - b).map((y) => counts.get(y) as number);
  const trend = yearlyTrend(series);
  return { first, last, trend: trend?.verdict ?? "none" };
}

/** The line itself. Null when no day that hot happened in either decade (nothing to compare). */
export function heatClimateLine(days: readonly HeatDay[] | null, feelsF: number | null): string | null {
  if (!days || feelsF === null) return null;
  const threshold = Math.floor(feelsF);
  const climate = heatClimate(days, threshold);
  if (!climate || (climate.first === 0 && climate.last === 0)) return null;
  const base = `Days this hot (feels like ${threshold}°F or more) averaged ${perYear(climate.first)} here in ${FIRST_DECADE[0]}–${FIRST_DECADE[1]} and ${perYear(climate.last)} in ${LAST_DECADE[0]}–${LAST_DECADE[1]}.`;
  if (climate.trend === "none") return base;
  return `${base} Over all the years the counts show a clear ${climate.trend === "increasing" ? "upward" : "downward"} trend (Mann-Kendall test, p under 0.05).`;
}

/** The latest day in the history at or above the threshold. */
export function lastAtLeast(days: readonly HeatDay[], thresholdF: number): string | null {
  let latest: string | null = null;
  for (const day of days) if (day.feelsF >= thresholdF && (latest === null || day.date > latest)) latest = day.date;
  return latest;
}

function heatBefore(days: readonly HeatDay[] | null, feelsF: number | null): string | null {
  if (!days || days.length === 0 || feelsF === null) return null;
  const threshold = Math.floor(feelsF);
  const since = days.reduce((first, d) => (d.date < first ? d.date : first), days[0].date).slice(0, 4);
  const last = lastAtLeast(days, threshold);
  return last ? `The last time it felt like ${threshold}°F or more here was ${niceDate(last)}.` : `Our records since ${since} show no day when it felt like ${threshold}°F or more here.`;
}

const latest = <T extends { start: string }>(rows: readonly T[]): T | undefined => rows.reduce<T | undefined>((best, row) => (!best || row.start > best.start ? row : best), undefined);

const FLOOD_EVENT = new Set(["Flash Flood", "Flood", "Coastal Flood", "Lakeshore Flood", "Heavy Rain"]);
const STORM_EVENT = new Set(["Tornado", "Thunderstorm Wind", "Hail"]);
const WIND_EVENT = new Set(["High Wind", "Strong Wind", "Thunderstorm Wind"]);

const tidyType = (type: string) => type.toLowerCase();

function floodBefore(ero: DayOfficial["ero"], record: FloodRecord | null, floods: readonly NearbyFlood[], events: readonly AreaEvent[]): string | null {
  if (record && ero && ero !== "none") {
    const key = recordKeyForLevel(ero as EroLevel);
    const count = record.byCategory[key];
    if (count && count.days > 0) {
      return `On ${count.hitDays} of ${count.days} past ${ERO_LABEL[key]}-risk days here, flooding was reported within ${record.radiusKm} km.${count.days < FEW_DAYS ? " That is too few days to say much." : ""}`;
    }
  }
  const lastReport = latest(floods);
  if (lastReport) return `The most recent NWS flood report within ${FLOOD_RADIUS_KM} km of here was on ${niceDate(lastReport.start)}.`;
  const lastEvent = latest(events.filter((e) => FLOOD_EVENT.has(e.type)));
  return lastEvent ? `The most recent flooding the NWS recorded for this area was a ${tidyType(lastEvent.type)} on ${niceDate(lastEvent.start)}.` : null;
}

function stormBefore(spc: DayOfficial["spc"], record: TornadoRecord | null, tornadoes: readonly NearbyTornado[], events: readonly AreaEvent[]): string | null {
  if (record && spc && spc.kind === "tornado") {
    const key = tornadoKeyForPercent(spc.percent);
    const count = record.byProbability[key];
    if (key !== "none" && count && count.days > 0) {
      const gave = key === "10+" ? "10% or more" : `${key}%`;
      return `On ${count.hitDays} of ${count.days} past days with a ${gave} tornado outlook here, a tornado track passed within ${record.radiusMi} miles.${count.days < FEW_DAYS ? " That is too few days to say much." : ""}`;
    }
  }
  const lastTornado = latest(tornadoes);
  if (lastTornado) return `The most recent tornado within ${TORNADO_RADIUS_KM} km of here was ${lastTornado.ef ? `an ${lastTornado.ef}` : "one"} on ${niceDate(lastTornado.start)}, passing ${lastTornado.minDistanceKm} km away.`;
  const lastEvent = latest(events.filter((e) => STORM_EVENT.has(e.type)));
  return lastEvent ? `The most recent ${tidyType(lastEvent.type)} the NWS recorded for this area was on ${niceDate(lastEvent.start)}.` : null;
}

function windBefore(events: readonly AreaEvent[]): string | null {
  const last = latest(events.filter((e) => WIND_EVENT.has(e.type)));
  return last ? `The most recent ${tidyType(last.type)} the NWS recorded for this area was on ${niceDate(last.start)}.` : null;
}

/** What this kind of day meant here before, or null when the records hold nothing. Never invents a record. */
export function beforeLine(hazard: Pick<WeekHazard, "kind">, forecast: DayForecast, official: DayOfficial, record: LocalRecord): string | null {
  switch (hazard.kind) {
    case "heat":
      return heatBefore(record.heatDays, forecast.feelsF);
    case "flood":
      return floodBefore(official.ero, record.floodRecord, record.floods, record.events);
    case "storm":
      return stormBefore(official.spc, record.tornadoRecord, record.tornadoes, record.events);
    case "wind":
      return windBefore(record.events);
  }
}

