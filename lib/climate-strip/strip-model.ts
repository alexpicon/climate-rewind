/**
 * The "then, now, 2040s" strip at the top of "Your history": the same measure the What's changing tab charts (days a year with an air
 * temperature high of 90 F or more), so the past and the projection are like for like. The 2040s range is the lowest to the highest of
 * the climate models, never one number. "Trend" is only said when the Mann-Kendall test gives p under 0.05 (observed.ts decides).
 * Pure functions; no network.
 */
import { buildChartModel, fmt1 } from "../climate/chart-model";
import { NOW_SPAN, observedAverage, THEN_SPAN, trendPhrase } from "../climate/observed";
import { caveatLine, modelChange, signed, type ModelRun } from "../climate/projection";
import type { FuturePayload, ObservedMeasure, Spread } from "../climate/types";

export { NOW_SPAN, THEN_SPAN };

export interface StripRow {
  /** Plain words for the row: "Days at 90°F or hotter (air temperature)". */
  title: string;
  then: number | null;
  now: number | null;
  /** The models' own change (days a year, 2001-2020 to the 2040s) with the range across models. Heavy rain has none: the models were not asked. */
  change: Spread | null;
  /** Null when there is no test result, else the phrase from the existing test ("no clear trend yet", "clear trend up, about…"). */
  trend: string | null;
  /** True only when the existing test found a trend (p under 0.05). */
  hasTrend: boolean;
  /** One sentence for screen readers and the text fallback. */
  summary: string;
}

export interface StripModel {
  hot: StripRow | null;
  rain: StripRow | null;
  projectedPeriod: string | null;
  /** "2040s": the decade the projection period sits in. */
  projectedDecade: string | null;
  /** The one caveat line (CMIP6, not a forecast; says "hotter than the record" only when they do). */
  caveat: string;
  modelRun: ModelRun | null;
  thenLabel: string;
  nowLabel: string;
}

const decadeOf = (period: string): string => `${Math.floor(Number(period.slice(0, 4)) / 10) * 10}s`;
const span = (s: [number, number]) => `${s[0]}–${s[1]}`;

function rowOf(measure: ObservedMeasure | undefined, title: string, change: Spread | null, projPeriod: string | null): StripRow | null {
  const then = observedAverage(measure, THEN_SPAN[0], THEN_SPAN[1]);
  const now = observedAverage(measure, NOW_SPAN[0], NOW_SPAN[1]);
  if (then === null && now === null && !change) return null;
  const hasTrend = Boolean(measure?.trend && measure.trend.verdict !== "none" && measure.trend.p < 0.05);
  const bits: string[] = [];
  if (then !== null) bits.push(`${fmt1(then)} a year in ${span(THEN_SPAN)}`);
  if (now !== null) bits.push(`${fmt1(now)} a year in ${span(NOW_SPAN)}`);
  if (change && projPeriod) bits.push(`climate models project about ${signed(change.median)} more days a year by the ${decadeOf(projPeriod)}, ranging from ${signed(change.min)} to ${signed(change.max)} across models`);
  return {
    title,
    then,
    now,
    change,
    trend: measure ? trendPhrase(measure) : null,
    hasTrend,
    summary: `${title}: ${bits.join(", ")}.`,
  };
}

/** Null when there is nothing honest to show (neither the record nor the models could be read). */
export function buildStrip(payload: FuturePayload): StripModel | null {
  const measures = payload.observed?.measures ?? [];
  const proj = payload.projected?.future ? payload.projected : null;
  const projPeriod = proj ? `${proj.futurePeriod[0]}–${proj.futurePeriod[1]}` : null;
  const hot = rowOf(measures.find((m) => m.id === "air90"), "Days at 90°F or hotter (air temperature)", modelChange(proj), projPeriod);
  const rain = rowOf(measures.find((m) => m.id === "rain1"), "Days with 1 inch of rain or more", null, null);
  if (!hot && !rain) return null;
  const chart = buildChartModel(payload);
  const modelRun = chart?.modelRun ?? null;
  return { hot, rain, projectedPeriod: projPeriod, projectedDecade: projPeriod ? decadeOf(projPeriod) : null, caveat: caveatLine(modelRun), modelRun, thenLabel: "2000s", nowLabel: "2016–2025" };
}
