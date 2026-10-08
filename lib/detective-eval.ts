/**
 * The AI detective's pre-registered test: 100 fresh NWS flood reports with the true locations hidden, run once on 2026-10-08
 * (`pipeline/eval/score.json`, written up in `pipeline/RUN-2026-10-08.md`, "Pre-registered eval result", protocol in `pipeline/eval/PREREG.md`).
 * These are the only copies of the numbers in the app. `tests/detective-eval.test.ts` fails if any of them stops matching `score.json`.
 * Pure and client-safe. Percentages are whole numbers.
 */
export const DETECTIVE_EVAL = {
  /** Fresh reports scored. */
  n: 100,
  /** Primary measure: pins placed more than 5 km from the true location. Lower is better. */
  wrong: { baseline: 28, detective: 2 },
  /** Reach: pins placed within 1 km of the true location. Higher is better. */
  within1km: { baseline: 33, detective: 16 },
  /** Reports left unplaced ("I don't know" for the detective). */
  abstain: { baseline: 10, detective: 79 },
  /** Wrong pins that were also high or medium confidence. */
  confidentWrong: 0,
  /** Reports the baseline got wrong that the detective got right, and the reverse (exact McNemar test). */
  discordant: { baselineOnlyWrong: 26, detectiveOnlyWrong: 0 },
  /** Exact McNemar p-value, as written in the run log (score.json rounds it to 0.0). */
  mcnemarP: "3e-8",
  /** The earlier pilot (not pre-registered, 100 records already seen once): wrong pins more than 5 km off. */
  pilot: { baseline: 36, detective: 8 },
} as const;

const E = DETECTIVE_EVAL;

/** The headline claim. Never shown without EVAL_TRADEOFF next to it. */
export const EVAL_HEADLINE = `In a pre-registered test on ${E.n} fresh reports, the AI detective cut wrong pins from ${E.wrong.baseline}% to ${E.wrong.detective}%.`;

/** The cost of that claim, stated right beside it. */
export const EVAL_TRADEOFF = `It places fewer reports (${E.within1km.detective}% vs ${E.within1km.baseline}% within 1 km), because it refuses to guess when a report names only a road.`;

/** The one-line footnote. */
export const PILOT_FOOTNOTE = `Pilot: ${E.pilot.baseline}% → ${E.pilot.detective}%`;

/** The fine print under the bars: how the test was run and what else it found. */
export const EVAL_FINE = `Pre-registered: the sample, the measures and the pass bar were committed to the repository before the run, then it ran once on ${E.n} NWS reports whose true locations were hidden. Wrong pins is the main measure; within 1 km is the reach it gives up. The AI detective said “I don’t know” on ${E.abstain.detective}% of reports (the no-AI baseline left ${E.abstain.baseline}% unplaced). Of the ${E.discordant.baselineOnlyWrong + E.discordant.detectiveOnlyWrong} reports where exactly one of them was wrong, the AI detective was the wrong one in ${E.discordant.detectiveOnlyWrong} (McNemar p = ${E.mcnemarP}). No wrong pin was a confident one. The test’s own verdict: fewer wrong pins, less reach.`;
