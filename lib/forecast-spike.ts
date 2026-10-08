/**
 * Quinn's flood-forecaster experiment, as measured (research/forecast-spike/RESULT.md, 2026-10-08). Numbers are copied, not rounded
 * further; a test keeps this file and the chart in step. Client-safe.
 *
 * The honest reading: with the rain known only after the fact the model beat the official outlook by 3.5%; with only what is known
 * in advance it did exactly as well as the official outlook (0.0%). So Climate Rewind explains the official forecasts instead of competing.
 */
export interface SpikeBar {
  id: "hindsight" | "advance";
  label: string;
  /** Brier skill score against the official outlook alone, in percent. 0 = no better. */
  bss: number;
  /** 95% interval (date-block bootstrap), percent. */
  lo: number;
  hi: number;
  /** Whether this could run live (tomorrow's rain is not known today). */
  usableLive: boolean;
  auc: number;
}

export const FORECAST_SPIKE = {
  trained: "2016 to 2022",
  tested: "2024 to 2025",
  /** City points, and states, the model was trained and tested on. */
  points: 78,
  states: 7,
  trainPointDays: 199_368,
  trainPositives: 920,
  testPointDays: 56_238,
  testPositives: 350,
  testDates: 206,
  /** Distance within which a flood report counts. */
  radiusKm: 10,
  bars: [
    { id: "hindsight", label: "Knowing the rain after the fact", bss: 3.5, lo: 1.7, hi: 5.3, usableLive: false, auc: 0.954 },
    { id: "advance", label: "Knowing only what is known in advance", bss: 0.0, lo: -1.4, hi: 1.3, usableLive: true, auc: 0.916 },
  ] as SpikeBar[],
  /** The official outlook against the usual local rate for the time of year, same test: the Weather Service's skill, not ours. */
  officialVsUsual: { bss: 6.0, lo: 4.5, hi: 7.6, auc: 0.881 },
  /** Illustrative simulation (not real forecast rain): the hindsight lift shrinks as the rain input gets noisier. */
  noisyRain: [
    { label: "observed rain", bss: 3.5 },
    { label: "moderately wrong rain", bss: 0.7 },
  ],
  citation: "Schumacher et al., Bulletin of the American Meteorological Society, 2021 (doi 10.1175/BAMS-D-20-0186.1): the Colorado State University machine-learning system was less skillful than the operational outlook on Day 1.",
} as const;
