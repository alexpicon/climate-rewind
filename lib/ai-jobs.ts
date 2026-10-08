/**
 * The AI jobs the site does, with the number each has earned or the word "pending". Pure and client-safe (the file readers are in ai-jobs-server.ts).
 * The landing page lists them; "How it works" shows each with its number. Nothing here is a claim the data does not back:
 * a job with no measurement says "pending".
 */
import type { DetectiveCounts } from "./detective-status";
import { FORECAST_SPIKE } from "./forecast-spike";

/**
 * The damage mapper's test on 5 hand-labelled NWS surveys (Koda, pipeline/RUN-2026-10-08.md, Round 2). A test keeps these equal to that file.
 * "Pinned" counts the labelled places whose extracted place got a point on the map; a separate 10-pin spot-check found all 10 on the named place and the track.
 */
export const DAMAGE_EVAL = { surveys: 5, labelled: 72, pinned: 45, precision: 0.98, recall: 0.86, spotChecked: 10, spotCorrect: 10 } as const;

export type AiJobStatus = "measured" | "pilot" | "pending";

export interface AiJob {
  id: "detective" | "damage" | "briefing" | "forecaster";
  name: string;
  /** One plain line: what the AI does. */
  does: string;
  status: AiJobStatus;
  /** The measured number in words, or null when pending. */
  number: string | null;
  /** The caveat that goes with it. */
  detail: string;
  /** What the real run on this site's data did, in counts, or null when there is none. Not a score. */
  result?: string | null;
}

export interface BriefEval {
  ranAt: string;
  model: string;
  questions: number;
  addresses: number;
  sentencesWritten: number;
  sentencesVerified: number;
  /** 0 to 100. */
  passPercent: number;
  /** Dropped sentences by reason. */
  dropped: Record<string, number>;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function isBriefEval(v: unknown): v is BriefEval {
  const e = v as Partial<BriefEval> | null;
  return !!e && isNum(e.sentencesWritten) && isNum(e.sentencesVerified) && isNum(e.passPercent) && isNum(e.questions) && typeof e.ranAt === "string" && !!e.dropped && typeof e.dropped === "object";
}

export function describeJobs(input: { detectiveRan: boolean; damagePlaces: number; briefEval: BriefEval | null; detectiveCounts?: DetectiveCounts }): AiJob[] {
  const { detectiveRan, damagePlaces, briefEval, detectiveCounts } = input;
  const real = detectiveRan && detectiveCounts && detectiveCounts.ran > 0 ? detectiveCounts : null;
  const spike = FORECAST_SPIKE;
  const advance = spike.bars.find((b) => b.id === "advance")!;
  const hindsight = spike.bars.find((b) => b.id === "hindsight")!;
  return [
    {
      id: "detective",
      name: "The flood detective",
      does: "Reads each National Weather Service flood report and re-files a misplaced pin at the street the words name, or says it doesn’t know.",
      status: "pilot",
      number: "Wrong pins more than 5 km off: 36% without AI, 8% with the pilot detective.",
      detail: `A pilot on 100 records, not the pre-registered re-test, which is pending.${detectiveRan ? " Real placements are in the data now." : " It has not run on this data yet."}`,
      result: real
        ? `Real run on this site’s data: it re-filed ${real.placed} of ${real.ran} imprecise flood reports in the ${real.states} sample areas and said “I don’t know” on the other ${real.ran - real.placed}. These re-filings are not scored against the truth yet.`
        : null,
    },
    {
      id: "damage",
      name: "The damage mapper",
      does: "Reads a tornado’s official damage narrative and pins the named streets and landmarks where it says there was damage.",
      ...(damagePlaces > 0
        ? {
            status: "pilot" as const,
            number: `On ${DAMAGE_EVAL.surveys} hand-labelled NWS surveys: extraction precision ${DAMAGE_EVAL.precision.toFixed(2)}, recall ${DAMAGE_EVAL.recall.toFixed(2)}; ${DAMAGE_EVAL.pinned} of ${DAMAGE_EVAL.labelled} damage places pinned.`,
            detail: `${damagePlaces} damage places are on the map now, each with the NWS’s own words. A spot-check of ${DAMAGE_EVAL.spotChecked} random pins found ${DAMAGE_EVAL.spotCorrect} on the named place and the tornado’s track. A street pin is where that street meets the track, not a spot the survey states. Five surveys is a small test, not a pre-registered one.`,
          }
        : { status: "pending" as const, number: null, detail: "Not run on this data yet. Its accuracy test is pending." }),
    },
    briefEval
      ? {
          id: "briefing",
          name: "The briefing and “Ask your street”",
          does: "Writes the next-72-hours brief and answers questions, only in sentences a source backs up. Code checks every citation and number.",
          status: "measured",
          number: `${briefEval.passPercent}% of the sentences it wrote passed the checks (${briefEval.sentencesVerified} of ${briefEval.sentencesWritten}, across ${briefEval.questions} questions on ${briefEval.addresses} addresses).`,
          detail: `${briefEval.sentencesVerified === briefEval.sentencesWritten ? "Nothing had to be removed in this run; the checks are tested on uncited sentences, made-up sources and unsupported numbers." : "The rest were removed before anyone saw them."} Measured ${briefEval.ranAt.slice(0, 10)} with ${briefEval.model}. It shows the checks work; it does not show every sentence is wise.`,
        }
      : {
          id: "briefing",
          name: "The briefing and “Ask your street”",
          does: "Writes the next-72-hours brief and answers questions, only in sentences a source backs up. Code checks every citation and number.",
          status: "pending",
          number: null,
          detail: "The 20-question test has not been run yet.",
        },
    {
      id: "forecaster",
      name: "The flood forecaster we trained and set aside",
      does: "A small model we trained to predict where flood reports would follow, to see whether we could beat the official outlook.",
      status: "measured",
      number: `${advance.bss.toFixed(1)}% better than the official outlook using only what is known in advance (${hindsight.bss > 0 ? "+" : ""}${hindsight.bss.toFixed(1)}% if it is told the rain after the fact).`,
      detail: "So we explain the official forecasts instead of competing with them.",
    },
  ];
}
