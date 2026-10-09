/**
 * The wettest and windiest days on record at an address, 2000 through last year: one Open-Meteo archive request (daily rain total and
 * strongest 10 m gust), or NASA POWER (rain and strongest 10 m wind) when Open-Meteo is rate limited or down. The hottest day is the
 * heat summary's own. These are reanalysis values for a grid cell of 10 to 50 km, not a gauge at the address, and the page says so.
 *
 * Like the heat history, the answer is past weather: a 0.05 degree cell is reused for six hours. Sample addresses can read a snapshot.
 */
import { describeFailure, fetchJson, type FetchLike } from "./http";
import { gridKey, LruCache } from "./lru";
import { powerUrl, rainFromPower } from "./nasa-power";
import type { Sourced } from "./sources";
import type { AddressExtremes, HeatDay } from "./types";

const FIRST_YEAR = 2000;
const MPS_TO_MPH = 2.236936;
const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new LruCache<Omit<AddressExtremes, "hottest">>(100, CACHE_MS);

export function clearExtremesCache(): void {
  cache.clear();
}

export type DayExtremes = Omit<AddressExtremes, "hottest">;

interface ArchiveReply {
  daily?: { time?: string[]; precipitation_sum?: Array<number | null>; wind_gusts_10m_max?: Array<number | null> };
}

export function extremesArchiveUrl(lat: number, lon: number, lastYear: number): string {
  return (
    "https://archive-api.open-meteo.com/v1/archive" +
    `?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&start_date=${FIRST_YEAR}-01-01&end_date=${lastYear}-12-31` +
    "&daily=precipitation_sum,wind_gusts_10m_max&precipitation_unit=inch&wind_speed_unit=mph&timezone=auto"
  );
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** The largest value of a series, with its date. The first date wins a tie. Null when the series has no number. */
export function peakOf(dates: readonly string[], values: ReadonlyArray<number | null | undefined>): { date: string; value: number } | null {
  let best: { date: string; value: number } | null = null;
  dates.forEach((date, i) => {
    const value = values[i];
    if (isNumber(value) && (!best || value > best.value)) best = { date, value };
  });
  return best;
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/** Wettest and windiest days from an Open-Meteo archive reply. */
export function extremesFromArchive(data: ArchiveReply): DayExtremes | null {
  const dates = data.daily?.time ?? [];
  const wet = peakOf(dates, data.daily?.precipitation_sum ?? []);
  const wind = peakOf(dates, data.daily?.wind_gusts_10m_max ?? []);
  if (!wet && !wind) return null;
  return {
    wettest: wet && wet.value > 0 ? { date: wet.date, inches: round(wet.value, 2) } : null,
    windiest: wind ? { date: wind.date, mph: Math.round(wind.value), measure: "gust" } : null,
    source: "open-meteo",
  };
}

interface PowerReply {
  properties?: { parameter?: Record<string, Record<string, number> | undefined> };
}

/** Wettest and windiest days from a NASA POWER reply (PRECTOTCORR in mm, WS10M_MAX in m/s). */
export function extremesFromPower(data: PowerReply): DayExtremes | null {
  const rain = rainFromPower(data);
  const wet = peakOf([...rain.keys()], [...rain.values()]);
  const speeds = data.properties?.parameter?.WS10M_MAX ?? {};
  const keys = Object.keys(speeds).sort();
  const wind = peakOf(
    keys.map((k) => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`),
    keys.map((k) => (speeds[k] >= 0 ? speeds[k] : null)),
  );
  if (!wet && !wind) return null;
  return {
    wettest: wet && wet.value > 0 ? { date: wet.date, inches: round(wet.value, 2) } : null,
    windiest: wind ? { date: wind.date, mph: Math.round(wind.value * MPS_TO_MPH), measure: "wind" } : null,
    source: "nasa-power",
  };
}

/**
 * Wettest and windiest days at a point. Open-Meteo first; NASA POWER when it fails. Both failing is a plain notice and null.
 */
export async function fetchDayExtremes(lat: number, lon: number, fetchFn: FetchLike, now: () => Date = () => new Date()): Promise<Sourced<DayExtremes>> {
  const lastYear = now().getUTCFullYear() - 1;
  const cell = gridKey(lat, lon);
  const key = `${cell.key},${lastYear}`;
  const hit = cache.get(key, now().getTime());
  if (hit) return { value: hit };

  const result = await fetchJson<ArchiveReply>(fetchFn, extremesArchiveUrl(cell.lat, cell.lon, lastYear));
  const fromMeteo = result.ok ? extremesFromArchive(result.data) : null;
  if (fromMeteo) {
    cache.set(key, fromMeteo, now().getTime());
    return { value: fromMeteo };
  }

  const power = await fetchJson<PowerReply>(fetchFn, powerUrl(cell.lat, cell.lon, ["PRECTOTCORR", "WS10M_MAX"], `${FIRST_YEAR}-01-01`, `${lastYear}-12-31`));
  const fromPower = power.ok ? extremesFromPower(power.data) : null;
  if (fromPower) {
    cache.set(key, fromPower, now().getTime());
    return { value: fromPower };
  }
  const why = result.ok ? "The Open-Meteo weather archive had no rain or wind data for this address." : describeFailure("The Open-Meteo weather archive", result);
  return { value: null, notice: `${why} The fallback did not work either.` };
}

/** Joins the day extremes with the heat summary's hottest day. Null when there is nothing at all to show. */
export function joinExtremes(days: DayExtremes | null, hottest: HeatDay | null): AddressExtremes | null {
  if (!days && !hottest) return null;
  return { wettest: days?.wettest ?? null, windiest: days?.windiest ?? null, hottest, source: days?.source ?? "open-meteo" };
}
