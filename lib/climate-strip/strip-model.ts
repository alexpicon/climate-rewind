/**
 * The "then, now, 2040s" strip at the top of "Your history": the same measure the What's changing tab charts (days a year with an air
 * temperature high of 90 F or more), so the past and the projection are like for like. The 2040s range is the lowest to the highest of
 * the climate models, never one number. "Trend" is only said when the Mann-Kendall test gives p under 0.05 (observed.ts decides).
 * Pure functions; no network.
 */
import { buildChartModel, fmt1 } from "../climate/chart-model";
import { observedAverage, trendPhrase } from "../climate/observed";
import type { FuturePayload, ObservedMeasure, Spread } from "../climate/types";

/** The two observed spans compared: the first decade of the record, and the latest ten years. */
export const THEN_SPAN: [number, number] = [2000, 2009];
export const NOW_SPAN: [number, number] = [2016, 2025];

export interface StripRow {
  /** Plain words for the row: "Days at 90°F or hotter (air temperature)". */
  title: string;
  then: number | null;
  now: number | null;
  /** The projected range across models for the 2040s. Heavy rain has none: the models were not asked. */
  projected: Spread | null;
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
  /** The models' own past compared with the record, only when the models run noticeably hotter than what was recorded here. */
  hotModelNote: string | null;
  thenLabel: string;
  nowLabel: string;
}

const span = (s: [number, number]) => `${s[0]}–${s[1]}`;

function rowOf(measure: ObservedMeasure | undefined, title: string, projected: Spread | null, projPeriod: string | null): StripRow | null {
  const then = observedAverage(measure, THEN_SPAN[0], THEN_SPAN[1]);
  const now = observedAverage(measure, NOW_SPAN[0], NOW_SPAN[1]);
  if (then === null && now === null && !projected) return null;
  const hasTrend = Boolean(measure?.trend && measure.trend.verdict !== "none" && measure.trend.p < 0.05);
  const bits: string[] = [];
  if (then !== null) bits.push(`${fmt1(then)} a year in ${span(THEN_SPAN)}`);
  if (now !== null) bits.push(`${fmt1(now)} a year in ${span(NOW_SPAN)}`);
  if (projected && projPeriod) bits.push(`${fmt1(projected.min)} to ${fmt1(projected.max)} a year projected by climate models for ${projPeriod}`);
  return {
    title,
    then,
    now,
    projected,
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
  const hot = rowOf(measures.find((m) => m.id === "air90"), "Days at 90°F or hotter (air temperature)", proj?.future ?? null, projPeriod);
  const rain = rowOf(measures.find((m) => m.id === "rain1"), "Days with 1 inch of rain or more", null, null);
  if (!hot && !rain) return null;
  const chart = buildChartModel(payload);
  // The existing check: "higher" means the models' own 2001–2020 middle is well above what the record counted at this spot.
  const hotModelNote = chart?.modelNote && /is higher than/.test(chart.modelNote) ? chart.modelNote : null;
  return { hot, rain, projectedPeriod: projPeriod, hotModelNote, thenLabel: "2000s", nowLabel: "2016–2025" };
}
