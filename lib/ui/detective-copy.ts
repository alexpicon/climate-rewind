/**
 * What the pages may say about the AI detective. Until real detective results exist in the data
 * (`detectiveRan` false), nothing here claims it has moved any pin. The measured result is the pre-registered test in
 * lib/detective-eval.ts, and its headline is never shown without the reach trade-off beside it. The pilot is a one-line footnote.
 */
import { EVAL_HEADLINE, EVAL_TRADEOFF } from "../detective-eval";

/** The headline and its trade-off, always together. */
export const EVAL_NOTE = `${EVAL_HEADLINE} ${EVAL_TRADEOFF}`;

export function landingLead(detectiveRan: boolean): { lead: string; body: string } {
  return detectiveRan
    ? {
        lead: "An AI flood detective.",
        body: `It reads each National Weather Service report and moves misfiled flood pins to the street the words name, or says it doesn’t know. ${EVAL_NOTE}`,
      }
    : {
        lead: "An AI detective",
        body: `that reads each report’s words to re-file misplaced pins. ${EVAL_NOTE}`,
      };
}

export function howHeading(detectiveRan: boolean): string {
  return detectiveRan ? "An AI flood detective that refuses to guess." : "An AI flood detective, built to refuse to guess.";
}

export function howIntro(detectiveRan: boolean): string {
  return detectiveRan
    ? "Each pin is a written flood report, not a storm. Many reports were filed by the NWS at a city placeholder. The detective reads each report’s own words and re-files it at the street it names, or says it doesn’t know."
    : "Each pin is a written flood report, not a storm. Many reports were filed by the NWS at a city placeholder. The detective is built to read each report’s own words and re-file it at the street it names, or say it doesn’t know. It has not run on this data yet.";
}
