/**
 * Real AI outputs made ahead of time for the four sample addresses (data/samples/ai/<slug>.json, written by `npm run precompute-ai`), so a
 * click on a sample shows the brief, the story and the plan at once. Each part is the same checked answer a live request returns (every
 * sentence still cites a source), marked `precomputed: { at }` so the page says it was computed ahead of time and when.
 *
 * The brief is the one part that goes stale (it opens with the live alerts and the next three days), so the page shows it with its time and
 * asks for a fresh one right away; the story and the plan are history and stay as they are. Server only.
 * `MEMORIA_SAMPLE_AI=off` turns this off (the precompute run itself needs that, so it records live answers).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ReadyPayload } from "../ready/types";
import { haversineKm } from "../geo";
import type { AiAnswer, StoryAnswer } from "./types";

export interface SampleAiFile {
  slug: string;
  /** The sample address as typed on the landing page. */
  address: string;
  lat: number;
  lon: number;
  brief: AiAnswer | null;
  story: StoryAnswer | null;
  ready: ReadyPayload | null;
}

/** Within this distance of a sample, a plan request for a point is the sample's. */
export const SAMPLE_AI_RADIUS_M = 200;

const dir = () => process.env.MEMORIA_SAMPLE_AI_DIR ?? path.join(process.cwd(), "data", "samples", "ai");
const off = () => process.env.MEMORIA_SAMPLE_AI === "off";

let cached: { dir: string; files: SampleAiFile[] } | null = null;

export function clearSampleAiCache(): void {
  cached = null;
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function isSampleAiFile(value: unknown): value is SampleAiFile {
  const v = value as Partial<SampleAiFile> | null;
  return !!v && typeof v.slug === "string" && typeof v.address === "string" && isNumber(v.lat) && isNumber(v.lon);
}

export async function loadSampleAi(): Promise<SampleAiFile[]> {
  if (off()) return [];
  const where = dir();
  if (cached?.dir === where) return cached.files;
  const files: SampleAiFile[] = [];
  try {
    for (const name of (await readdir(where)).filter((f) => f.endsWith(".json")).sort()) {
      try {
        const parsed: unknown = JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ where, name), "utf8"));
        if (isSampleAiFile(parsed)) files.push(parsed);
      } catch {
        // an unreadable file is just not used
      }
    }
  } catch {
    // no folder: nothing was precomputed, every request is live
  }
  cached = { dir: where, files };
  return files;
}

/** "100 James Robertson Pkwy, Nashville, TN" however it is cased or spaced. */
const norm = (address: string) => address.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function sampleAiForAddress(address: string): Promise<SampleAiFile | null> {
  const wanted = norm(address);
  return (await loadSampleAi()).find((file) => norm(file.address) === wanted) ?? null;
}

export async function sampleAiForPoint(lat: number, lon: number): Promise<SampleAiFile | null> {
  const files = await loadSampleAi();
  return files.find((file) => haversineKm([lat, lon], [file.lat, file.lon]) * 1000 <= SAMPLE_AI_RADIUS_M) ?? null;
}
