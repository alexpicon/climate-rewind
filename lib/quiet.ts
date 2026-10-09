/**
 * "Quieter than X% of places we sampled": where an address sits among random points of its state, measured by the same thing the
 * app counts for an address (distinct flood reports within 5 km). The points and their counts are made offline by
 * scripts/quiet-percentiles.ts and kept in data/quiet-percentiles.json (a histogram per state), so a lookup reads one small file.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { QuietPlacement } from "./types";

export interface QuietFile {
  built: string;
  /** In words: how the points were drawn and what was counted. Shown on the page. */
  method: string;
  radiusKm: number;
  states: Record<string, { points: number; /** report count -> number of points with exactly that many */ hist: Record<string, number> }>;
}

const quietFile = () => process.env.MEMORIA_QUIET_FILE ?? path.join(process.cwd(), "data", "quiet-percentiles.json");

let cached: { file: string; value: QuietFile | null } | null = null;

export function clearQuietCache(): void {
  cached = null;
}

function isQuietFile(value: unknown): value is QuietFile {
  const v = value as Partial<QuietFile> | null;
  return !!v && typeof v === "object" && typeof v.states === "object" && v.states !== null;
}

/** The percentile file, or null if it has not been built (the page then just leaves the comparison out). */
export async function loadQuietFile(file: string = quietFile()): Promise<QuietFile | null> {
  if (cached?.file === file) return cached.value;
  let value: QuietFile | null = null;
  try {
    const parsed: unknown = JSON.parse(await readFile(/*turbopackIgnore: true*/ file, "utf8"));
    value = isQuietFile(parsed) ? parsed : null;
  } catch {
    value = null;
  }
  cached = { file, value };
  return value;
}

/**
 * Places an address with `count` flood reports within 5 km among the sampled points of every indexed state, pooled (each state
 * contributes its own ~500 points, so no state outweighs another). Pooled, because a state's own record can be thin: Washington's
 * sample is mostly zeros, which says more about how few reports the state files than about the address.
 * `quieterThanPct` is the share of points with MORE reports (rounded down, so it is never overstated); `samePct` is the share with
 * exactly as many. Null when there is no sample or it is too small to say anything.
 */
export function placeInQuiet(file: QuietFile | null, state: string, count: number): QuietPlacement | null {
  const entries = Object.values(file?.states ?? {}).filter((entry) => entry && entry.points > 0 && entry.hist);
  const sample = entries.reduce((sum, entry) => sum + entry.points, 0);
  if (sample < 50) return null;
  let more = 0;
  let same = 0;
  let none = 0;
  for (const entry of entries) {
    none += entry.hist["0"] ?? 0;
    for (const [key, points] of Object.entries(entry.hist)) {
      const reports = Number(key);
      if (!Number.isFinite(reports) || !(points > 0)) continue;
      if (reports > count) more += points;
      else if (reports === count) same += points;
    }
  }
  return {
    state: state.toUpperCase(),
    count,
    quieterThanPct: Math.floor((100 * more) / sample),
    samePct: Math.round((100 * same) / sample),
    nonePct: Math.round((100 * none) / sample),
    sample,
    states: entries.length,
  };
}
