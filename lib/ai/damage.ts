/**
 * The tornado damage mapper's output (data/damage/<ST>.json, written by the pipeline): a JSON array of placed rows
 *   { tornadoId, place, phrase, ef, lat, lon, matchType, confidence }
 * Server only. A missing, empty or malformed file just means "the damage mapper has no result here yet".
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { haversineKm } from "../geo";
import type { Coord } from "../types";

export interface DamageRow {
  tornadoId: string;
  place: string;
  phrase: string;
  ef: string | null;
  lat: number;
  lon: number;
  matchType: string | null;
  confidence: string | null;
}

const damageDir = () => process.env.MEMORIA_DAMAGE_DIR ?? path.join(process.cwd(), "data", "damage");

const isRow = (value: unknown): value is DamageRow => {
  const v = value as Partial<DamageRow> | null;
  return !!v && typeof v.tornadoId === "string" && typeof v.place === "string" && typeof v.phrase === "string" && Number.isFinite(v.lat) && Number.isFinite(v.lon);
};

const cache = new Map<string, DamageRow[]>();

export function clearDamageCache(): void {
  cache.clear();
}

/** Every placed damage row for a state. [] if there is no file, it is empty, or it cannot be read. */
export async function loadDamageRows(state: string, dir: string = damageDir()): Promise<DamageRow[]> {
  const code = state.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return [];
  const key = `${dir}|${code}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let rows: DamageRow[] = [];
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ dir, `${code}.json`), "utf8"));
    if (Array.isArray(parsed)) rows = parsed.filter(isRow);
  } catch {
    // none yet
  }
  cache.set(key, rows);
  return rows;
}

/** The mapped damage places for the given tornadoes, nearest to the address first, within `maxKm`. */
export function damageNear(rows: readonly DamageRow[], tornadoIds: ReadonlySet<string>, origin: Coord, maxKm = 15, limit = 6): Array<DamageRow & { distanceKm: number }> {
  return rows
    .filter((row) => tornadoIds.has(row.tornadoId))
    .map((row) => ({ ...row, distanceKm: haversineKm(origin, [row.lat, row.lon]) }))
    .filter((row) => row.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}
