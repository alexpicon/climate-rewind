/**
 * The projected half: days per year at or above 90 F in CMIP6 HighResMIP climate models (Open-Meteo Climate API), 2001 to 2020 against
 * 2041 to 2050, one number per model and the range across models. Pure functions over the API's reply, so they are tested without the network.
 *
 * These are climate-model projections, not a forecast. The models run on climate-model grids of about 20–50 km, downscaled by Open-Meteo to about 10 km; they disagree, and so the page shows the range.
 */
import type { DailyObservation, ModelResult, ProjectionBlock, Spread } from "./types";
import { withOpenMeteoKey } from "../open-meteo";

export const CLIMATE_API = "https://climate-api.open-meteo.com/v1/climate";
export const ARCHIVE_API = "https://archive-api.open-meteo.com/v1/archive";

/** The HighResMIP models Open-Meteo serves. A model with no data for a point is shown as "no data", never filled in. */
export const CLIMATE_MODELS = ["CMCC_CM2_VHR4", "FGOALS_f3_H", "HiRAM_SIT_HR", "MRI_AGCM3_2_S", "EC_Earth3P_HR", "MPI_ESM1_2_XR", "NICAM16_8S"] as const;

export const PROJECTED_THRESHOLD_F = 90;
export const BASELINE_PERIOD: [number, number] = [2001, 2020];
export const FUTURE_PERIOD: [number, number] = [2041, 2050];
/** A model year counts only if the model has a value for at least this many of its days (some models use 360-day years). */
export const MIN_MODEL_DAYS_PER_YEAR = 300;
/** A model's period average needs at least this share of its years. */
export const MIN_YEAR_SHARE = 0.9;

export const CAVEAT = "Climate-model projections (CMIP6), not a forecast; climate-model grids of about 20–50 km, downscaled by Open-Meteo to about 10 km; models disagree, so we show the range.";

/** What the models follow. Shown under the caveat. No claim that the numbers are adjusted to the record: they are not, and they can run hotter. */
export const SCENARIO_NOTE = "These models follow a high-emissions path (as close to RCP8.5 as CMIP6 gets). We show how much they say it changes, not their raw level.";

/** How the models' own 2001-2020 compares with what the record counted here. */
export type ModelRun = "higher" | "close" | "lower";

/** The one short caveat line, same wording on the strip and on What's changing. */
export function caveatLine(run: ModelRun | null): string {
  if (run === "higher") return "Climate models (CMIP6) are physics simulations, not a forecast; they run hotter than the record here, so we show their change.";
  if (run === "lower") return "Climate models (CMIP6) are physics simulations, not a forecast; they run cooler than the record here, so we show their change.";
  return "Climate models (CMIP6) are physics simulations, not a forecast, so we show their change.";
}

/**
 * The models' own change in days a year, 2001-2020 to the 2040s: the middle is the middle future minus the middle past, and the range is the lowest
 * to the highest change of a single model (widened to hold the middle). Null if no model had both periods.
 */
export function modelChange(proj: { models: readonly { baseline: number | null; future: number | null }[]; baseline: Spread | null; future: Spread | null } | null | undefined): Spread | null {
  if (!proj?.baseline || !proj.future) return null;
  const each = proj.models.filter((m) => m.baseline !== null && m.future !== null).map((m) => (m.future as number) - (m.baseline as number));
  if (each.length === 0) return null;
  const median = round1(proj.future.median - proj.baseline.median);
  return { min: Math.min(round1(Math.min(...each)), median), median, max: Math.max(round1(Math.max(...each)), median) };
}

/** "+4.1" or "−0.5": a signed change in days a year. */
export const signed = (n: number): string => `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(1)}`;

export interface ClimateReply {
  daily?: { time?: string[] } & Record<string, unknown>;
}

export function climateUrl(lat: number, lon: number, startYear: number, endYear: number, models: readonly string[] = CLIMATE_MODELS): string {
  return withOpenMeteoKey(
    `${CLIMATE_API}?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}` +
    `&start_date=${startYear}-01-01&end_date=${endYear}-12-31` +
    `&models=${models.join(",")}&daily=temperature_2m_max&temperature_unit=fahrenheit`
  );
}

export function archiveUrl(lat: number, lon: number, firstYear: number, lastYear: number): string {
  return withOpenMeteoKey(
    `${ARCHIVE_API}?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}` +
    `&start_date=${firstYear}-01-01&end_date=${lastYear}-12-31` +
    "&daily=apparent_temperature_max,temperature_2m_max,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto"
  );
}

export interface ArchiveReply {
  daily?: {
    time?: string[];
    apparent_temperature_max?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
    precipitation_sum?: Array<number | null>;
  };
}

export function observationsFromArchive(reply: ArchiveReply): DailyObservation[] {
  const time = reply.daily?.time ?? [];
  const feels = reply.daily?.apparent_temperature_max ?? [];
  const air = reply.daily?.temperature_2m_max ?? [];
  const rain = reply.daily?.precipitation_sum ?? [];
  const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return time.map((date, i) => ({ date, feelsF: num(feels[i]), airF: num(air[i]), rainIn: num(rain[i]) }));
}

/**
 * Average days per year at or above the threshold for one model over a period. A year with fewer than 300 days of values is skipped;
 * a year's count is scaled to 365 days so a model with 360-day years is comparable. Null if fewer than 90% of the period's years are usable.
 */
export function averageDaysPerYear(time: readonly string[], values: readonly unknown[], period: [number, number], thresholdF: number = PROJECTED_THRESHOLD_F): number | null {
  const seen = new Map<number, number>();
  const over = new Map<number, number>();
  for (let i = 0; i < time.length; i += 1) {
    const value = values[i];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const year = Number(time[i].slice(0, 4));
    if (year < period[0] || year > period[1]) continue;
    seen.set(year, (seen.get(year) ?? 0) + 1);
    if (value >= thresholdF) over.set(year, (over.get(year) ?? 0) + 1);
  }
  const wanted = period[1] - period[0] + 1;
  const usable = [...seen].filter(([, count]) => count >= MIN_MODEL_DAYS_PER_YEAR);
  if (usable.length < Math.ceil(wanted * MIN_YEAR_SHARE)) return null;
  const perYear = usable.map(([year, count]) => ((over.get(year) ?? 0) / count) * 365);
  return perYear.reduce((a, b) => a + b, 0) / perYear.length;
}

/** The series for one model in a reply: `temperature_2m_max_<MODEL>`, or plain `temperature_2m_max` when only one model was asked for. */
export function modelSeries(reply: ClimateReply, model: string, only: boolean): unknown[] | null {
  const daily = reply.daily;
  if (!daily) return null;
  const series = daily[`temperature_2m_max_${model}`] ?? (only ? daily.temperature_2m_max : undefined);
  return Array.isArray(series) ? series : null;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function spreadOf(values: readonly number[]): Spread | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { min: round1(sorted[0]), median: round1(median), max: round1(sorted[sorted.length - 1]) };
}

/**
 * Builds the projection from the two API replies (2001 to 2020 and 2041 to 2050; one reply covering both also works).
 * A model needs usable data in BOTH periods to be counted; otherwise it is listed with nulls.
 */
export function buildProjection(baselineReply: ClimateReply, futureReply: ClimateReply, models: readonly string[] = CLIMATE_MODELS, source = "Open-Meteo Climate API (CMIP6 HighResMIP models), daily temperature_2m_max"): ProjectionBlock | null {
  const results: ModelResult[] = models.map((model) => {
    const only = models.length === 1;
    const baseSeries = modelSeries(baselineReply, model, only);
    const futureSeries = modelSeries(futureReply, model, only);
    const baseline = baseSeries ? averageDaysPerYear(baselineReply.daily?.time ?? [], baseSeries, BASELINE_PERIOD) : null;
    const future = futureSeries ? averageDaysPerYear(futureReply.daily?.time ?? [], futureSeries, FUTURE_PERIOD) : null;
    return baseline !== null && future !== null ? { model, baseline: round1(baseline), future: round1(future) } : { model, baseline: null, future: null };
  });
  const usable = results.filter((r) => r.baseline !== null && r.future !== null);
  if (usable.length === 0) return null;
  return {
    thresholdF: PROJECTED_THRESHOLD_F,
    baselinePeriod: BASELINE_PERIOD,
    futurePeriod: FUTURE_PERIOD,
    models: results,
    baseline: spreadOf(usable.map((r) => r.baseline as number)),
    future: spreadOf(usable.map((r) => r.future as number)),
    source,
  };
}
