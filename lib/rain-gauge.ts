/**
 * Rain on flood days, measured: NOAA's daily station records (GHCN-Daily, through NCEI's keyless Access Data Service), from the rain
 * gauges nearest the address. Reanalysis grids such as ERA5 smooth out a downpour (Nashville airport measured 5.75 in on Mar 27,
 * 2021; ERA5 had 1.18 in at the address), so a gauge is the better witness of the rain that came with a flood report.
 *
 * Stations: within GAUGE_RADIUS_KM, with a rain record covering at least MIN_COVERAGE percent of its days, the nearest MAX_STATIONS.
 * They include airports, cooperative observers and CoCoRaHS volunteers. Airport stations (ids "USW...") total the rain midnight to
 * midnight; the others are read each morning, so an evening storm is filed under the next day's date: each station's value for a
 * flood date is its largest total over the day before and the day itself (airports) or the day before to the day after (the rest).
 * The rain for the date is the MEDIAN of those values over every station that read it: a gauge read in the morning sometimes misses a
 * day and folds it into the next (Shelby Bottoms, Nashville: 0.00 on Mar 28, 2021, then 4.64), and the median keeps one such gauge
 * from deciding a date. Readings NOAA's quality checks flagged are left out. Server only; every call has the usual 8 s timeout and
 * never throws.
 */
import { haversineKm } from "./geo";
import { describeFailure, fetchJson, type FetchLike } from "./http";
import { gridKey, LruCache } from "./lru";
import type { TriggerDay } from "./types";

export const GAUGE_RADIUS_KM = 25;
export const MIN_COVERAGE = 70;
export const MAX_STATIONS = 5;

const SEARCH = "https://www.ncei.noaa.gov/access/services/search/v1/data";
const DATA = "https://www.ncei.noaa.gov/access/services/data/v1";
const DAY_MS = 86_400_000;

export interface GaugeStation {
  id: string;
  name: string;
  km: number;
}

interface SearchResponse {
  results?: Array<{
    stations?: Array<{ id?: string; name?: string; dataTypes?: Array<{ id?: string; coverage?: number; startDate?: string; endDate?: string }> }>;
    boundingPoints?: Array<{ coordinates?: [number, number] }>;
  }>;
}

type DataResponse = Array<{ STATION?: string; DATE?: string; PRCP?: string; PRCP_ATTRIBUTES?: string }>;

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** First-order (airport) stations total the day midnight to midnight; cooperative and volunteer gauges are read in the morning. */
export const readInTheMorning = (stationId: string) => !stationId.startsWith("USW");

/** The station search for rain gauges in a box around the address, over the given dates. */
export function searchUrl(lat: number, lon: number, from: string, to: string): string {
  const dLat = GAUGE_RADIUS_KM / 111;
  const dLon = GAUGE_RADIUS_KM / (111 * Math.cos((lat * Math.PI) / 180));
  const box = [lat + dLat, lon - dLon, lat - dLat, lon + dLon].map((v) => v.toFixed(3)).join(",");
  return `${SEARCH}?dataset=daily-summaries&bbox=${box}&startDate=${from}&endDate=${to}&dataTypes=PRCP&limit=100`;
}

/** The daily rain records of some stations, inches, over the given dates. */
export function dataUrl(stationIds: string[], from: string, to: string): string {
  return `${DATA}?dataset=daily-summaries&stations=${stationIds.join(",")}&startDate=${from}&endDate=${to}&dataTypes=PRCP&format=json&units=standard&includeAttributes=true`;
}

/** The usable stations in a search answer: rain records that cover the dates well, within the radius, nearest first. */
export function stationsFrom(body: SearchResponse, lat: number, lon: number, from: string, to: string): GaugeStation[] {
  const found: GaugeStation[] = [];
  for (const result of body.results ?? []) {
    const station = result.stations?.[0];
    const point = result.boundingPoints?.[0]?.coordinates;
    const rain = station?.dataTypes?.find((type) => type.id === "PRCP");
    if (!station?.id || !station.name || !point || !rain) continue;
    if ((rain.coverage ?? 0) < MIN_COVERAGE) continue;
    if ((rain.startDate ?? "") > `${to}T23:59:59` || (rain.endDate ?? "") < from) continue;
    const km = haversineKm([lat, lon], [point[1], point[0]]);
    if (km <= GAUGE_RADIUS_KM) found.push({ id: station.id, name: station.name, km: Math.round(km * 10) / 10 });
  }
  return found.sort((a, b) => a.km - b.km).slice(0, MAX_STATIONS);
}

/**
 * Station id to (date to inches). Rows without a number are left out, and so are readings with a quality flag (the second field of
 * GHCN's "measurement,quality,source,time" attributes): NOAA's own checks failed them.
 */
export function readingsFrom(rows: DataResponse): Map<string, Map<string, number>> {
  const byStation = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const inches = Number(row.PRCP);
    if (!row.STATION || !row.DATE || row.PRCP === undefined || row.PRCP === "" || !Number.isFinite(inches)) continue;
    if ((row.PRCP_ATTRIBUTES ?? "").split(",")[1]?.trim()) continue;
    if (!byStation.has(row.STATION)) byStation.set(row.STATION, new Map());
    byStation.get(row.STATION)!.set(row.DATE.slice(0, 10), inches);
  }
  return byStation;
}

/** The median of some values (the mean of the middle two when the count is even). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The rain on each flood date: the median, over the stations that read it, of each station's largest daily total in its window around
 * the date. A station counts for a date only if it has the reading that would hold that evening's rain (the day itself for an airport,
 * the next morning's for the rest). `station` and `stationKm` name the nearest station that counted, `gauges` how many did. Dates no
 * station read are left out.
 */
export function gaugeRainOnDates(dates: string[], stations: GaugeStation[], readings: ReadonlyMap<string, ReadonlyMap<string, number>>): TriggerDay[] {
  const days: TriggerDay[] = [];
  for (const date of dates) {
    const counted: Array<{ station: GaugeStation; inches: number }> = [];
    for (const station of stations) {
      const own = readings.get(station.id);
      if (!own) continue;
      const morning = readInTheMorning(station.id);
      if (!own.has(morning ? shift(date, 1) : date)) continue;
      const window = morning ? [shift(date, -1), date, shift(date, 1)] : [shift(date, -1), date];
      const values = window.map((day) => own.get(day)).filter((v): v is number => typeof v === "number");
      counted.push({ station, inches: Math.max(...values) });
    }
    if (counted.length === 0) continue;
    const nearest = counted[0].station;
    days.push({ date, rainIn: Math.round(median(counted.map((c) => c.inches)) * 100) / 100, station: nearest.name, stationKm: nearest.km, gauges: counted.length });
  }
  return days;
}

export interface GaugeRain {
  /** The flood dates a gauge read, with the station. */
  days: TriggerDay[];
  notice?: string;
}

const cache = new LruCache<GaugeRain>(200, 6 * 60 * 60 * 1000);

export function clearGaugeCache(): void {
  cache.clear();
}

/** Measured rain on the flood dates near a point. Never throws; on any failure the days are empty with a plain notice. */
export async function fetchGaugeRain(lat: number, lon: number, dates: string[], fetchFn: FetchLike, nowMs: number = Date.now()): Promise<GaugeRain> {
  if (dates.length === 0) return { days: [] };
  const sorted = [...dates].sort();
  const from = shift(sorted[0], -1);
  const to = shift(sorted[sorted.length - 1], 1);
  const key = `${gridKey(lat, lon).key}|${sorted.join(",")}`;
  const hit = cache.get(key, nowMs);
  if (hit) return hit;

  const search = await fetchJson<SearchResponse>(fetchFn, searchUrl(lat, lon, from, to));
  if (!search.ok) return { days: [], notice: describeFailure("NOAA's station records", search) };
  const stations = stationsFrom(search.data, lat, lon, from, to);
  if (stations.length === 0) {
    const none: GaugeRain = { days: [], notice: `No NOAA rain gauge with a good record is within ${GAUGE_RADIUS_KM} km of this address.` };
    cache.set(key, none, nowMs);
    return none;
  }
  const data = await fetchJson<DataResponse>(fetchFn, dataUrl(stations.map((s) => s.id), from, to));
  if (!data.ok || !Array.isArray(data.data)) return { days: [], notice: data.ok ? "NOAA's station records sent a reply we could not read." : describeFailure("NOAA's station records", data) };
  const result: GaugeRain = { days: gaugeRainOnDates(sorted, stations, readingsFrom(data.data)) };
  cache.set(key, result, nowMs);
  return result;
}
