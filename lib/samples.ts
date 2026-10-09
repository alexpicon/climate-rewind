/**
 * Build-time snapshots of the slow outside data for the sample addresses (data/samples/<slug>.json).
 *
 * Open-Meteo's free archive has a daily allowance that a 26-year heat request alone eats 680 calls of. Judges click the same
 * four samples many times, so the heat summary and the rain on each flood date for those addresses are saved ahead of time by
 * `npm run snapshot-samples` and read from disk. A lookup uses a snapshot only when the matched point is within 200 m of the
 * sample; everything else (alerts, the NWS forecast, FEMA, any other address) stays live.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { haversineKm } from "./geo";
import type { HeatDay, HeatSummary } from "./types";

/** A lookup within this distance of a sample address uses that sample's snapshot. */
export const SNAPSHOT_RADIUS_M = 200;

export interface SampleSnapshot {
  slug: string;
  /** The sample address as typed on the landing page. */
  address: string;
  /** Where the Census geocoder put it when the snapshot was made. */
  lat: number;
  lon: number;
  /** ISO time the file was written. */
  built: string;
  /** The heat summary (same shape as a live lookup, minus the regional slug), or null if not captured yet. */
  heat: (Omit<HeatSummary, "regionalSlug"> & { source: string }) | null;
  /**
   * Daily rain (inches, ERA5 via Open-Meteo) for each flood date within 5 km and the day before it, keyed by local date.
   * A null value is a day the archive had no total for. Null part: not captured (or not needed: fewer than 3 flood dates).
   */
  rain: { byDate: Record<string, number | null>; source: string; seeded?: boolean } | null;
  /** The wettest and windiest days (additive, optional): when present a sample address needs no archive call for them. */
  extremes?: { wettest: { date: string; inches: number } | null; windiest: { date: string; mph: number; measure: "gust" | "wind" } | null; source: string } | null;
}

const samplesDir = () => process.env.MEMORIA_SAMPLES_DIR ?? path.join(process.cwd(), "data", "samples");

const cache = new Map<string, SampleSnapshot[]>();

export function clearSnapshotCache(): void {
  cache.clear();
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function isHeatDays(value: unknown): value is HeatDay[] {
  return Array.isArray(value) && value.every((d) => d && typeof d.date === "string" && isNumber(d.feelsF));
}

export function isSnapshot(value: unknown): value is SampleSnapshot {
  const v = value as Partial<SampleSnapshot> | null;
  if (!v || typeof v.slug !== "string" || !isNumber(v.lat) || !isNumber(v.lon)) return false;
  const heat = v.heat;
  if (heat != null && !(typeof heat.byYear === "object" && heat.byYear && isNumber(heat.hottest?.feelsF) && isHeatDays(heat.worstWeek?.daily) && heat.worstWeek.daily.length > 0)) return false;
  const rain = v.rain;
  if (rain != null && !(typeof rain.byDate === "object" && rain.byDate)) return false;
  return true;
}

/** Every readable snapshot in data/samples (or MEMORIA_SAMPLES_DIR). An unreadable or malformed file is skipped, never fatal. */
export async function loadSampleSnapshots(dir: string = samplesDir()): Promise<SampleSnapshot[]> {
  const cached = cache.get(dir);
  if (cached) return cached;
  const found: SampleSnapshot[] = [];
  try {
    // The folder is data/samples (shipped with /api/lookup, see next.config.ts) or a test folder named by MEMORIA_SAMPLES_DIR.
    for (const name of (await readdir(/*turbopackIgnore: true*/ dir)).sort()) {
      if (!/^[a-z0-9-]+\.json$/.test(name)) continue;
      try {
        const parsed: unknown = JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ dir, name), "utf8"));
        if (isSnapshot(parsed)) found.push(parsed);
      } catch {
        // skip this file
      }
    }
  } catch {
    // no samples directory: nothing is precomputed
  }
  cache.set(dir, found);
  return found;
}

/** The snapshot for a matched point: the closest one within 200 m, else null. */
export function findSnapshot(lat: number, lon: number, snapshots: readonly SampleSnapshot[]): SampleSnapshot | null {
  let best: SampleSnapshot | null = null;
  let bestKm = SNAPSHOT_RADIUS_M / 1000;
  for (const snapshot of snapshots) {
    const km = haversineKm([lat, lon], [snapshot.lat, snapshot.lon]);
    if (km <= bestKm) {
      best = snapshot;
      bestKm = km;
    }
  }
  return best;
}
