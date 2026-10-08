/**
 * Reads the files behind the AI jobs list: the briefing test result (data/ai-eval/brief.json, written by scripts/eval-brief.ts)
 * and the damage mapper's output (data/damage/<ST>.json). Server only.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describeJobs, isBriefEval, type AiJob, type BriefEval } from "./ai-jobs";
import { detectiveCounts as readDetectiveCounts } from "./detective-status";

const dataDir = () => process.env.MEMORIA_DATA_DIR ?? path.join(process.cwd(), "data");

export async function loadBriefEval(dir: string = dataDir()): Promise<BriefEval | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ dir, "ai-eval", "brief.json"), "utf8"));
    return isBriefEval(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** How many damage places the damage mapper has pinned, across every state file. 0 when it has not run. */
export async function countDamagePlaces(dir: string = dataDir()): Promise<number> {
  let total = 0;
  try {
    for (const name of await readdir(/*turbopackIgnore: true*/ path.join(dir, "damage"))) {
      if (!/^[A-Z]{2}\.json$/.test(name)) continue;
      try {
        const rows: unknown = JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ dir, "damage", name), "utf8"));
        if (Array.isArray(rows)) total += rows.length;
      } catch {
        // skip an unreadable file
      }
    }
  } catch {
    // no folder
  }
  return total;
}

export async function loadAiJobs(detectiveRan: boolean, dir: string = dataDir()): Promise<AiJob[]> {
  const [briefEval, damagePlaces, detectiveCounts] = await Promise.all([loadBriefEval(dir), countDamagePlaces(dir), readDetectiveCounts(dir)]);
  return describeJobs({ detectiveRan, damagePlaces, briefEval, detectiveCounts });
}
