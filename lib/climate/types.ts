/**
 * Shapes for "What's changing here": what the record shows (observed) beside what climate models project. Safe to import from client code.
 */
import type { AiAnswer } from "../ai/types";
import type { Trend } from "./trend";

/** One day of the archive for the address. Null means the archive had no value. */
export interface DailyObservation {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Feels-like (apparent) high, F. */
  feelsF: number | null;
  /** Air temperature high at 2 m, F. */
  airF: number | null;
  /** Rain and melted snow for the day, inches. */
  rainIn: number | null;
}

export type MeasureId = "feels90" | "feels100" | "rain1" | "air90";

export interface DecadeRow {
  /** "2000s" or "2016 to 2025": the two windows used everywhere (the Story strip and What's changing). */
  label: string;
  startYear: number;
  endYear: number;
  /** Years with data in this decade. */
  years: number;
  /** Days over the threshold, all those years together. */
  total: number;
  /** Days per year on average (total / years), one decimal. */
  perYear: number;
}

export interface ObservedMeasure {
  id: MeasureId;
  /** Plain words: "Days with a feels-like high of 90 F or more". */
  title: string;
  /** Days per year, by calendar year. */
  byYear: Record<string, number>;
  decades: DecadeRow[];
  /** Null when there were too few years to test. */
  trend: Trend | null;
}

export interface ObservedBlock {
  firstYear: number;
  lastYear: number;
  source: string;
  measures: ObservedMeasure[];
}

export interface ModelResult {
  /** Open-Meteo's model name, like "EC_Earth3P_HR". */
  model: string;
  /** Average days per year at or above the threshold, 2001 to 2020 in the model. Null: the model had no data. */
  baseline: number | null;
  /** The same for 2041 to 2050. */
  future: number | null;
}

export interface Spread {
  min: number;
  median: number;
  max: number;
}

export interface ProjectionBlock {
  /** Air temperature high, F. */
  thresholdF: number;
  baselinePeriod: [number, number];
  futurePeriod: [number, number];
  /** Per model. Models with no data are listed with nulls. */
  models: ModelResult[];
  /** The spread across the models that had data, in days per year. Null if none did. */
  baseline: Spread | null;
  future: Spread | null;
  source: string;
}

/** Why a part could not be shown, in words for the page. */
export interface FutureNotices {
  observed?: string;
  projected?: string;
}

export interface FuturePayload {
  /** Set for the four sample addresses, whose numbers were computed ahead of time. */
  slug: string | null;
  lat: number;
  lon: number;
  /** ISO time the numbers were computed. */
  built: string;
  observed: ObservedBlock | null;
  projected: ProjectionBlock | null;
  notices: FutureNotices;
  /** The AI's plain-words explanation, already checked. Absent until asked for (or when the AI is resting). */
  explanation?: AiAnswer | null;
}

export type FutureErrorState = "bad_request" | "error";
export interface FutureErrorBody {
  error: string;
}
