/**
 * The observed half: per-decade counts and a trend test for the three things the page is about, from an address's daily archive.
 * Pure functions over the daily series, so they are tested without the network.
 */
import { yearlyTrend } from "./trend";
import type { DailyObservation, DecadeRow, MeasureId, ObservedBlock, ObservedMeasure } from "./types";

/** Feels-like highs at or above this count as a hot day. */
export const HOT_FEELS_F = 90;
export const VERY_HOT_FEELS_F = 100;
/** Air-temperature highs at or above this are what the climate models are counted on too. */
export const HOT_AIR_F = 90;
/** A heavy-rain day. */
export const HEAVY_RAIN_IN = 1;
/** A year counts only if the archive has a value for at least this many of its days. */
export const MIN_DAYS_PER_YEAR = 350;

interface MeasureSpec {
  id: MeasureId;
  title: string;
  value: (day: DailyObservation) => number | null;
  threshold: number;
}

export const MEASURES: readonly MeasureSpec[] = [
  { id: "feels90", title: "Days with a feels-like high of 90°F or more", value: (d) => d.feelsF, threshold: HOT_FEELS_F },
  { id: "feels100", title: "Days with a feels-like high of 100°F or more", value: (d) => d.feelsF, threshold: VERY_HOT_FEELS_F },
  { id: "rain1", title: "Days with 1 inch of rain or more", value: (d) => d.rainIn, threshold: HEAVY_RAIN_IN },
  { id: "air90", title: "Days with an air temperature high of 90°F or more", value: (d) => d.airF, threshold: HOT_AIR_F },
];

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Days at or over a threshold, per calendar year. Years with too few days of data are left out (not counted as zero). */
export function countByYear(days: readonly DailyObservation[], value: (day: DailyObservation) => number | null, threshold: number): Record<string, number> {
  const seen = new Map<string, number>();
  const over = new Map<string, number>();
  for (const day of days) {
    const v = value(day);
    if (v === null || !Number.isFinite(v)) continue;
    const year = day.date.slice(0, 4);
    seen.set(year, (seen.get(year) ?? 0) + 1);
    if (v >= threshold) over.set(year, (over.get(year) ?? 0) + 1);
  }
  const out: Record<string, number> = {};
  for (const [year, count] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
    if (count >= MIN_DAYS_PER_YEAR) out[year] = over.get(year) ?? 0;
  }
  return out;
}

/** Totals and per-year averages for each decade present. A decade with fewer than 10 years is labelled with its years. */
export function decadeRows(byYear: Record<string, number>): DecadeRow[] {
  const groups = new Map<number, Array<[number, number]>>();
  for (const [year, count] of Object.entries(byYear)) {
    const y = Number(year);
    const decade = Math.floor(y / 10) * 10;
    groups.set(decade, [...(groups.get(decade) ?? []), [y, count]]);
  }
  return [...groups]
    .sort(([a], [b]) => a - b)
    .map(([decade, rows]) => {
      const years = rows.map(([y]) => y);
      const startYear = Math.min(...years);
      const endYear = Math.max(...years);
      const total = rows.reduce((sum, [, c]) => sum + c, 0);
      const complete = rows.length === 10;
      return {
        label: complete ? `${decade}s` : `${startYear} to ${endYear}`,
        startYear,
        endYear,
        years: rows.length,
        total,
        perYear: round1(total / rows.length),
      };
    });
}

/** The two windows of the record compared everywhere (Story strip, What's changing, the AI explanation): the first decade and the latest ten years. */
export const THEN_SPAN: [number, number] = [2000, 2009];
export const NOW_SPAN: [number, number] = [2016, 2025];
export const THEN_LABEL = "2000s";
export const NOW_LABEL = "2016 to 2025";
export const NOW_NAME = "last 10 years";

/** The two windows as rows (replaces by-decade rows so one "now" number exists). A window needs 9 of its 10 years; otherwise it is left out. */
export function windowRows(byYear: Record<string, number>): DecadeRow[] {
  const rows: DecadeRow[] = [];
  for (const [label, [from, to]] of [[THEN_LABEL, THEN_SPAN], [NOW_LABEL, NOW_SPAN]] as const) {
    const counts = Object.entries(byYear).filter(([y]) => Number(y) >= from && Number(y) <= to).map(([, c]) => c);
    if (counts.length < (to - from + 1) * 0.9) continue;
    const total = counts.reduce((a, b) => a + b, 0);
    rows.push({ label, startYear: from, endYear: to, years: counts.length, total, perYear: round1(total / counts.length) });
  }
  return rows;
}

/** Everything observed for an address: four counts over the two windows, and a trend verdict for each (the test uses every year). */
export function buildObserved(days: readonly DailyObservation[], source: string): ObservedBlock | null {
  const measures: ObservedMeasure[] = [];
  for (const spec of MEASURES) {
    const byYear = countByYear(days, spec.value, spec.threshold);
    if (Object.keys(byYear).length === 0) continue;
    const years = Object.keys(byYear).sort();
    measures.push({
      id: spec.id,
      title: spec.title,
      byYear,
      decades: windowRows(byYear),
      trend: yearlyTrend(years.map((y) => byYear[y])),
    });
  }
  if (measures.length === 0) return null;
  const all = measures.flatMap((m) => Object.keys(m.byYear).map(Number));
  return { firstYear: Math.min(...all), lastYear: Math.max(...all), source, measures };
}

/** The plain-words line for one measure's trend. Only a p under 0.05 is a trend; anything else is "no clear trend yet". */
export function trendSentence(measure: ObservedMeasure): string {
  const t = measure.trend;
  if (!t) return "Too few years to test for a trend.";
  if (t.verdict === "none") return "No clear trend yet.";
  const amount = Math.abs(t.perDecade);
  const dir = t.verdict === "increasing" ? "up" : "down";
  // Sen's slope can round to zero for a count that is zero in most years: say so rather than print "0.0 days".
  if (amount < 0.05) return `A statistically clear shift ${dir}, but it shows in only a few years (the typical change is under 0.1 days per decade).`;
  const shown = round1(amount);
  return `A clear trend ${dir}: about ${shown} ${dir === "up" ? "more" : "fewer"} ${shown === 1 ? "day" : "days"} a year, each decade (Mann-Kendall p = ${t.p < 0.001 ? "under 0.001" : t.p.toFixed(3)}).`;
}

/** The average count a year over a span of years, or null if the record covers fewer than 90% of them. Whole numbers of days, one decimal. */
export function observedAverage(measure: ObservedMeasure | undefined, from: number, to: number): number | null {
  if (!measure) return null;
  const values = Object.entries(measure.byYear)
    .filter(([y]) => Number(y) >= from && Number(y) <= to)
    .map(([, c]) => c);
  return values.length >= (to - from + 1) * 0.9 ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

/** The trend result as a phrase that can sit inside a sentence ("clear trend up, about 2.1 more days a year each decade"). */
export function trendPhrase(measure: ObservedMeasure): string {
  const t = measure.trend;
  if (!t) return "too few years to test";
  if (t.verdict === "none") return "no clear trend yet";
  const amount = round1(Math.abs(t.perDecade));
  if (amount < 0.05) return `clear trend ${t.verdict === "increasing" ? "up" : "down"}, but it shows in only a few years`;
  return `clear trend ${t.verdict === "increasing" ? "up" : "down"}, about ${amount} ${t.verdict === "increasing" ? "more" : "fewer"} ${amount === 1 ? "day" : "days"} a year each decade`;
}
