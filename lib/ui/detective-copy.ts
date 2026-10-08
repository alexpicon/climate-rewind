/**
 * What the pages may say about the AI detective. Until real detective results exist in the data
 * (`detectiveRan` false), nothing here claims it has moved any pin; the pilot numbers are labelled as a pilot.
 */

export const PILOT_NOTE = "In our pilot test it cut wrong pins from 36% to 8%; the pre-registered re-test is pending.";

export function landingLead(detectiveRan: boolean): { lead: string; body: string } {
  return detectiveRan
    ? {
        lead: "An AI flood detective.",
        body: "It reads each National Weather Service report and moves misfiled flood pins to the street the words name, or says it doesn’t know.",
      }
    : {
        lead: "An AI detective",
        body: `that reads each report’s words to re-file misplaced pins. ${PILOT_NOTE}`,
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

/** The sentence under the pilot bars. */
export const PILOT_CAVEATS =
  "Pilot, not the final test: the 36% to 8% came from a pilot harness (Claude Sonnet agents calling the geocoders by hand, not the production detective code), found after the fact (post-hoc) on 100 records already seen once. Placement within 1 km was a tie (36% against 33%). It also declined to place 37% of reports instead of guessing. The pre-registered re-test on a fresh sample is the real result and is still pending.";
