/**
 * Has the AI detective produced any real result yet? The landing page and "How it works" only say the detective
 * moved pins once this is true, so the wording flips by itself when the pipeline merges real rows into data/index.
 * Server only (reads the index files); the answer is computed once per server process.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { loadStateIndex } from "./index-store";
import type { StateIndex } from "./types";

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");

/** True when any flood row carries a real detective verdict. Hand-built fixtures never count. */
export function indexHasDetective(index: StateIndex | null): boolean {
  return !!index && !index.fixture && index.floods.some((row) => row.detective !== null);
}

/** What the detective has actually done in the data: reports it read, reports it re-filed, and the state files that hold results. */
export interface DetectiveCounts {
  /** Flood reports with a detective verdict (placed or unknown). */
  ran: number;
  /** Of those, the ones it re-filed (verdict placed, with a placed point). */
  placed: number;
  /** State files that hold at least one result. */
  states: number;
}

export const NO_DETECTIVE_RESULTS: DetectiveCounts = { ran: 0, placed: 0, states: 0 };

/** Counts one state's rows. A hand-built fixture counts as nothing. */
export function countDetective(index: StateIndex | null): DetectiveCounts {
  if (!index || index.fixture) return NO_DETECTIVE_RESULTS;
  let ran = 0;
  let placed = 0;
  for (const row of index.floods) {
    if (row.detective === null) continue;
    ran += 1;
    if (row.detective.verdict === "placed" && row.placed !== null) placed += 1;
  }
  return { ran, placed, states: ran > 0 ? 1 : 0 };
}

const cache = new Map<string, Promise<DetectiveCounts>>();

export function clearDetectiveStatusCache(): void {
  cache.clear();
}

/** The detective's real results across every state file, computed once per server process. */
export function detectiveCounts(dataDir: string = DEFAULT_DATA_DIR): Promise<DetectiveCounts> {
  let answer = cache.get(dataDir);
  if (!answer) {
    answer = scan(dataDir);
    cache.set(dataDir, answer);
  }
  return answer;
}

export async function detectiveHasRun(dataDir: string = DEFAULT_DATA_DIR): Promise<boolean> {
  return (await detectiveCounts(dataDir)).ran > 0;
}

async function scan(dataDir: string): Promise<DetectiveCounts> {
  const total = { ...NO_DETECTIVE_RESULTS };
  try {
    const files = await readdir(path.join(dataDir, "index"));
    for (const file of files) {
      const match = /^([A-Z]{2})\.json\.gz$/.exec(file);
      if (!match) continue;
      const one = countDetective(await loadStateIndex(match[1], dataDir));
      total.ran += one.ran;
      total.placed += one.placed;
      total.states += one.states;
    }
  } catch {
    // No data folder or an unreadable file: say the honest thing, that no result is known.
    return NO_DETECTIVE_RESULTS;
  }
  return total;
}
