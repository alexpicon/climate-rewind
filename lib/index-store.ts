/**
 * Loads the static data files: per-state flood/tornado indexes (data/index/<ST>.json.gz,
 * produced by the pipeline) and optional regional heat grids (data/heat/<slug>.json).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { HeatGrid, StateIndex } from "./types";

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");

const STATE_CODE = /^[A-Z]{2}$/;
const SLUG = /^[a-z0-9-]{1,40}$/;

const indexCache = new Map<string, StateIndex>();
const heatCache = new Map<string, HeatGrid>();

export function clearDataCaches(): void {
  indexCache.clear();
  heatCache.clear();
}

function isStateIndex(value: unknown): value is StateIndex {
  const v = value as Partial<StateIndex> | null;
  return !!v && typeof v.state === "string" && Array.isArray(v.floods) && Array.isArray(v.tornadoes);
}

/**
 * The index for one state, cached in memory after the first read.
 * Returns null when the state has not been indexed (or the file is unreadable),
 * so the caller can say so honestly instead of failing.
 */
export async function loadStateIndex(state: string, dataDir: string = DEFAULT_DATA_DIR): Promise<StateIndex | null> {
  const code = state.toUpperCase();
  if (!STATE_CODE.test(code)) return null; // also keeps odd input out of the file path

  const key = `${dataDir}|${code}`;
  const cached = indexCache.get(key);
  if (cached) return cached;

  try {
    const compressed = await readFile(path.join(dataDir, "index", `${code}.json.gz`));
    const parsed: unknown = JSON.parse(gunzipSync(compressed).toString("utf8"));
    if (!isStateIndex(parsed)) return null;
    indexCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

/** A regional heat grid by slug (for example "nashville"), or null if there is none. */
export async function loadHeatGrid(slug: string, dataDir: string = DEFAULT_DATA_DIR): Promise<HeatGrid | null> {
  if (!SLUG.test(slug)) return null;

  const key = `${dataDir}|${slug}`;
  const cached = heatCache.get(key);
  if (cached) return cached;

  try {
    const grid = JSON.parse(await readFile(path.join(dataDir, "heat", `${slug}.json`), "utf8")) as HeatGrid;
    if (!Array.isArray(grid.days) || !Array.isArray(grid.cells)) return null;
    heatCache.set(key, grid);
    return grid;
  } catch {
    return null;
  }
}

/** "North Las Vegas" -> "north-las-vegas" */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
