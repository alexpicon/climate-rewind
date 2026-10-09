/**
 * The four sample addresses' numbers, computed ahead of time by scripts/projections-samples.ts and saved in
 * data/projections/<slug>.json. Read from disk at run time (folder named by MEMORIA_PROJECTIONS_DIR in tests). Server only.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { FuturePayload } from "./types";

const dir = () => process.env.MEMORIA_PROJECTIONS_DIR ?? path.join(process.cwd(), "data", "projections");

const cache = new Map<string, FuturePayload[]>();

export function clearFutureSampleCache(): void {
  cache.clear();
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function isFuturePayload(value: unknown): value is FuturePayload {
  const v = value as Partial<FuturePayload> | null;
  return !!v && typeof v.slug === "string" && isNumber(v.lat) && isNumber(v.lon) && typeof v.built === "string" && typeof v.notices === "object" && "observed" in v && "projected" in v;
}

export async function loadFutureSamples(folder: string = dir()): Promise<FuturePayload[]> {
  const hit = cache.get(folder);
  if (hit) return hit;
  const found: FuturePayload[] = [];
  try {
    for (const name of (await readdir(/*turbopackIgnore: true*/ folder)).sort()) {
      if (!/^[a-z0-9-]+\.json$/.test(name)) continue;
      try {
        const parsed: unknown = JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ folder, name), "utf8"));
        if (isFuturePayload(parsed)) found.push(parsed);
      } catch {
        // skip a bad file
      }
    }
  } catch {
    // no folder: nothing precomputed
  }
  // An empty answer is not kept, so files that appear later (a fresh checkout, a script run) are found without a restart.
  if (found.length > 0) cache.set(folder, found);
  return found;
}
