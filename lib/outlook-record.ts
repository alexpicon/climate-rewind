/**
 * The local track record for the sample addresses: data/outlook-record/<slug>.json, written by scripts/outlook-record.py.
 * It counts how the official outlooks have played out at the address. Server only (reads files).
 *
 * Like the sample snapshots, a record applies when the matched point is within 200 m of the sample address.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { haversineKm } from "./geo";
import { SNAPSHOT_RADIUS_M } from "./samples";
import type { FloodRecord, HeatRank, TornadoRecord } from "./outlook-types";

export interface OutlookRecordFile {
  slug: string;
  address: string;
  lat: number;
  lon: number;
  built: string;
  flood: FloodRecord;
  tornado: TornadoRecord;
  /** Daily feels-like highs (F) since `start`, one per day, null where the archive had none. Null: not captured yet. */
  heat: { source: string; start: string; feelsF: Array<number | null> } | null;
  sources: string[];
}

const recordDir = () => process.env.MEMORIA_OUTLOOK_RECORD_DIR ?? path.join(process.cwd(), "data", "outlook-record");

const cache = new Map<string, OutlookRecordFile[]>();

export function clearOutlookRecordCache(): void {
  cache.clear();
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isCount = (value: unknown): boolean => {
  const v = value as { days?: unknown; hitDays?: unknown } | null;
  return !!v && isNumber(v.days) && isNumber(v.hitDays) && v.hitDays <= v.days;
};
const allCounts = (value: unknown, keys: string[]): boolean => {
  const v = value as Record<string, unknown> | null;
  return !!v && typeof v === "object" && keys.every((key) => isCount(v[key]));
};

export function isOutlookRecord(value: unknown): value is OutlookRecordFile {
  const v = value as Partial<OutlookRecordFile> | null;
  if (!v || typeof v.slug !== "string" || !isNumber(v.lat) || !isNumber(v.lon)) return false;
  const flood = v.flood as Partial<FloodRecord> | undefined;
  const tornado = v.tornado as Partial<TornadoRecord> | undefined;
  if (!flood || !isNumber(flood.days) || !allCounts(flood.byCategory, ["none", "MRGL", "SLGT", "MDT", "HIGH"])) return false;
  if (!allCounts(flood.sinceRedefinition, ["none", "MRGL", "SLGT", "MDT", "HIGH"])) return false;
  if (!tornado || !isNumber(tornado.days) || !allCounts(tornado.byProbability, ["none", "2", "5", "10+"])) return false;
  const heat = v.heat;
  if (heat != null && !(typeof heat.start === "string" && Array.isArray(heat.feelsF) && heat.feelsF.length > 365)) return false;
  return true;
}

/** Every readable record in data/outlook-record (or MEMORIA_OUTLOOK_RECORD_DIR). A malformed file is skipped, never fatal. */
export async function loadOutlookRecords(dir: string = recordDir()): Promise<OutlookRecordFile[]> {
  const cached = cache.get(dir);
  if (cached) return cached;
  const found: OutlookRecordFile[] = [];
  try {
    for (const name of (await readdir(/*turbopackIgnore: true*/ dir)).sort()) {
      if (!/^[a-z0-9-]+\.json$/.test(name)) continue;
      try {
        const parsed: unknown = JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ dir, name), "utf8"));
        if (isOutlookRecord(parsed)) found.push(parsed);
      } catch {
        // skip this file
      }
    }
  } catch {
    // no folder: no records
  }
  cache.set(dir, found);
  return found;
}

/** The record for a matched point: the closest one within 200 m, else null. */
export function findOutlookRecord(lat: number, lon: number, records: readonly OutlookRecordFile[]): OutlookRecordFile | null {
  let best: OutlookRecordFile | null = null;
  let bestKm = SNAPSHOT_RADIUS_M / 1000;
  for (const record of records) {
    const km = haversineKm([lat, lon], [record.lat, record.lon]);
    if (km <= bestKm) {
      best = record;
      bestKm = km;
    }
  }
  return best;
}

// ---------------------------------------------------------------- heat rank

const DAY_MS = 86_400_000;
/** "Same time of year" means within this many days of the calendar date, in every year of the history. */
export const SEASON_HALF_WINDOW_DAYS = 7;

const toTenths = (value: number) => Math.round(value * 10);

/**
 * Where a forecast feels-like high would rank among this address's own daily highs since the history began: how many days
 * were this hot or hotter, out of how many, over all days and over days within a week of the same calendar date.
 * A day counts when it is at least as high as the forecast (compared to 0.1 F). Null if the history is empty.
 */
export function rankFeels(heat: { start: string; feelsF: ReadonlyArray<number | null> }, date: string, feelsF: number): HeatRank | null {
  const startMs = Date.parse(`${heat.start}T00:00:00Z`);
  const target = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(target)) return null;
  const wanted = toTenths(feelsF);

  let allAtLeast = 0;
  let allTotal = 0;
  for (const value of heat.feelsF) {
    if (typeof value !== "number") continue;
    allTotal += 1;
    if (toTenths(value) >= wanted) allAtLeast += 1;
  }
  if (allTotal === 0) return null;

  const month = new Date(target).getUTCMonth();
  const day = new Date(target).getUTCDate();
  const firstYear = new Date(startMs).getUTCFullYear();
  const lastYear = new Date(startMs + (heat.feelsF.length - 1) * DAY_MS).getUTCFullYear();
  let seasonAtLeast = 0;
  let seasonTotal = 0;
  for (let year = firstYear; year <= lastYear; year += 1) {
    for (let offset = -SEASON_HALF_WINDOW_DAYS; offset <= SEASON_HALF_WINDOW_DAYS; offset += 1) {
      const index = Math.round((Date.UTC(year, month, day + offset) - startMs) / DAY_MS);
      const value = heat.feelsF[index];
      if (index < 0 || typeof value !== "number") continue;
      seasonTotal += 1;
      if (toTenths(value) >= wanted) seasonAtLeast += 1;
    }
  }
  return { allAtLeast, allTotal, seasonAtLeast, seasonTotal, since: firstYear };
}
