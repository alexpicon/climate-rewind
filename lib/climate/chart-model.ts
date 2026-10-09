/**
 * What the "past decades, then the projected range" chart draws, worked out in code so it can be tested and so the text version says the
 * same thing as the picture. Both halves are the SAME measure: days a year with an air-temperature high of 90 F or more (the archive for
 * the past decades, the climate models for 2041 to 2050).
 */
import { observedAverage, trendSentence } from "./observed";
import type { DecadeRow, FuturePayload, ObservedMeasure, ProjectionBlock, Spread } from "./types";

export interface ChartBar {
  label: string;
  value: number;
  years: number;
}

export interface ChartModel {
  title: string;
  bars: ChartBar[];
  /** The projected range for the future period, or null if the models were not read. */
  future: { label: string; spread: Spread } | null;
  /** What the same models say for the past period, so the reader can see whether they run close to what was observed. */
  modelPast: { label: string; spread: Spread } | null;
  /** What the weather record counted on average over the models' past years, so the two can be compared. Null if the record does not cover them. */
  observedBaseline: number | null;
  /** One plain sentence on how the models' past compares with the record (they can run high or low at a spot). Null if either is missing. */
  modelNote: string | null;
  /** Top of the y axis, a round number above everything drawn. */
  yMax: number;
  ticks: number[];
  /** One plain sentence that says what the picture shows. */
  summary: string;
}

const periodText = (p: [number, number]) => `${p[0]} to ${p[1]}`;

/** Days a year, always with one decimal, so a row of numbers reads evenly ("6.0", "29.4"). */
export const fmt1 = (n: number): string => n.toFixed(1);

/** A round axis top above `value`, with 4 ticks. */
export function niceAxis(value: number): { yMax: number; ticks: number[] } {
  const raw = Math.max(value, 1);
  const rough = raw / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const yMax = Math.ceil(raw / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= yMax + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  return { yMax, ticks };
}

export function airMeasure(payload: FuturePayload): ObservedMeasure | undefined {
  return payload.observed?.measures.find((m) => m.id === "air90");
}

const barOf = (d: DecadeRow): ChartBar => ({ label: d.label, value: d.perYear, years: d.years });

export function buildChartModel(payload: FuturePayload): ChartModel | null {
  const air = airMeasure(payload);
  const proj: ProjectionBlock | null = payload.projected?.future ? payload.projected : null;
  const bars = air ? air.decades.map(barOf) : [];
  if (bars.length === 0 && !proj) return null;

  const future = proj?.future ? { label: periodText(proj.futurePeriod), spread: proj.future } : null;
  const modelPast = proj?.baseline ? { label: periodText(proj.baselinePeriod), spread: proj.baseline } : null;
  const top = Math.max(0, ...bars.map((b) => b.value), future?.spread.max ?? 0, modelPast?.spread.max ?? 0);
  const { yMax, ticks } = niceAxis(top * 1.05);

  const observedBaseline = proj && air ? observedAverage(air, proj.baselinePeriod[0], proj.baselinePeriod[1]) : null;
  let modelNote: string | null = null;
  if (modelPast && observedBaseline !== null) {
    const mid = modelPast.spread.median;
    const close = Math.abs(mid - observedBaseline) < Math.max(1, observedBaseline * 0.2);
    modelNote = close
      ? `For ${modelPast.label} the models' middle value (${fmt1(mid)}) is close to the ${fmt1(observedBaseline)} the weather record counted.`
      : `For ${modelPast.label} the models' middle value (${fmt1(mid)}) is ${mid > observedBaseline ? "higher" : "lower"} than the ${fmt1(observedBaseline)} the weather record counted at this spot, so read the change from one model band to the next, not the height against the bars.`;
  }

  const parts: string[] = [];
  if (bars.length) parts.push(`In the weather record, days a year at or above 90°F averaged ${bars.map((b) => `${fmt1(b.value)} in ${b.label}`).join(", ")}.`);
  if (modelPast) parts.push(`The same models give ${fmt1(modelPast.spread.min)} to ${fmt1(modelPast.spread.max)} for ${modelPast.label}.`);
  if (future) parts.push(`Climate models project ${fmt1(future.spread.median)} a year in ${future.label}, with models ranging from ${fmt1(future.spread.min)} to ${fmt1(future.spread.max)}.`);
  return {
    title: "Days a year at or above 90°F (air temperature)",
    bars,
    future,
    modelPast,
    observedBaseline,
    modelNote,
    yMax,
    ticks,
    summary: parts.join(" "),
  };
}

/** The sentence under the heading: what the record counted lately, then how the models' middle value moves, with the range across models. */
export function headline(payload: FuturePayload): string {
  const chart = buildChartModel(payload);
  if (!chart) return "";
  const last = chart.bars[chart.bars.length - 1];
  const pastPart = last ? `The weather record counted about ${fmt1(last.value)} days a year at or above 90°F in ${last.label.replace(" to ", "–")}.` : "";
  let futurePart = "";
  if (chart.future && chart.modelPast) {
    futurePart = `Climate models put the middle value at ${fmt1(chart.future.spread.median)} a year in ${chart.future.label}, ${chart.future.spread.median >= chart.modelPast.spread.median ? "up" : "down"} from ${fmt1(chart.modelPast.spread.median)} in ${chart.modelPast.label}, with models ranging from ${fmt1(chart.future.spread.min)} to ${fmt1(chart.future.spread.max)}.`;
  } else if (chart.future) {
    futurePart = `Climate models put the middle value at ${fmt1(chart.future.spread.median)} a year in ${chart.future.label}, with models ranging from ${fmt1(chart.future.spread.min)} to ${fmt1(chart.future.spread.max)}.`;
  }
  return [pastPart, futurePart].filter(Boolean).join(" ");
}

export { trendSentence };
