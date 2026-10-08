/**
 * "Your street's next 72 hours": official outlooks made local, and how they have played out here.
 * Types only; safe to import from client code. Everything labelled "official" is an NWS/WPC/SPC product read at the point.
 * Everything labelled "record" is a count of past days at this address, never a forecast.
 */

/** WPC Excessive Rainfall Outlook categories. ENH exists in the 2026 proposal (PNS 26-57); accepted if it appears. */
export type EroLevel = "none" | "MRGL" | "SLGT" | "ENH" | "MDT" | "HIGH";

export const ERO_LABEL: Record<EroLevel, string> = {
  none: "No risk area",
  MRGL: "Marginal",
  SLGT: "Slight",
  ENH: "Enhanced",
  MDT: "Moderate",
  HIGH: "High",
};

/** What each ERO level means (WPC, since Feb 10, 2022): the chance that rain exceeds flash flood guidance within 25 miles of a point. */
export const ERO_MEANING: Record<EroLevel, string> = {
  none: "no excessive rainfall risk area here",
  MRGL: "at least a 5% chance that rain exceeds flash flood guidance within 25 miles",
  SLGT: "at least a 15% chance that rain exceeds flash flood guidance within 25 miles",
  ENH: "at least a 25% chance that rain exceeds flash flood guidance within 25 miles",
  MDT: "at least a 40% chance that rain exceeds flash flood guidance within 25 miles",
  HIGH: "at least a 70% chance that rain exceeds flash flood guidance within 25 miles",
};

/** A day of an official outlook. `day` is the NWS outlook day (1 = today's 12Z to 12Z period). `date` is the calendar date it starts on, YYYY-MM-DD. */
export interface OutlookDayBase {
  day: 1 | 2 | 3;
  date: string;
}

export interface FloodOutlookDay extends OutlookDayBase {
  level: EroLevel;
}

export interface TornadoOutlookDay extends OutlookDayBase {
  /** "tornado": the SPC tornado probability (Days 1 and 2). "severe": Day 3 only has a combined any-severe probability, not a tornado one. */
  kind: "tornado" | "severe";
  /** Percent chance within 25 miles of the point; 0 means no risk area at the point. */
  percent: number;
}

export interface HeatRiskDay extends OutlookDayBase {
  /** NWS HeatRisk (experimental) 0 to 4, or null if the service had no value at the point. */
  level: 0 | 1 | 2 | 3 | 4 | null;
}

export const HEATRISK_LABEL = ["Little to no risk", "Minor", "Moderate", "Major", "Extreme"] as const;

/** One bucket of a track record: of `days` days that had this outlook here, `hitDays` had the event. */
export interface RecordCount {
  days: number;
  hitDays: number;
}

export type EroRecordKey = "none" | "MRGL" | "SLGT" | "MDT" | "HIGH";

export interface FloodRecord {
  radiusKm: number;
  window: { start: string; end: string };
  /** Days with an outlook product in the archive. */
  days: number;
  daysMissing: number;
  hitDays: number;
  reportsWithin10Km: number;
  /** Date WPC changed what the categories mean. */
  redefined: string;
  byCategory: Record<EroRecordKey, RecordCount>;
  beforeRedefinition: Record<EroRecordKey, RecordCount>;
  sinceRedefinition: Record<EroRecordKey, RecordCount>;
}

export type TornadoRecordKey = "none" | "2" | "5" | "10+";

export interface TornadoRecord {
  radiusMi: number;
  window: { start: string; end: string };
  days: number;
  daysMissing: number;
  hitDays: number;
  byProbability: Record<TornadoRecordKey, RecordCount>;
}

/** The feels-like ranking of one forecast day against this address's history. */
export interface HeatRank {
  /** Days since 2000 whose feels-like high was this high or higher, out of `allTotal`. */
  allAtLeast: number;
  allTotal: number;
  /** The same, but only for days within a week of this calendar date, in every year. */
  seasonAtLeast: number;
  seasonTotal: number;
  /** First year of the history. */
  since: number;
}

export interface HeatForecastDay {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Forecast feels-like high, F (NWS hourly apparent temperature, daily maximum). */
  feelsF: number;
  /** Null when this address has no saved history (only the sample addresses do). */
  rank: HeatRank | null;
}

export interface OutlookPayload {
  /** ISO time the official products were read. */
  checkedAt: string;
  /** Which sample address's record applies (within 200 m), or null: official outlooks only. */
  recordSlug: string | null;
  flood: { days: FloodOutlookDay[] | null; record: FloodRecord | null; notice?: string };
  tornado: { days: TornadoOutlookDay[] | null; record: TornadoRecord | null; notice?: string };
  heat: {
    risk: HeatRiskDay[] | null;
    forecast: HeatForecastDay[] | null;
    /** True when a feels-like history for this address exists (sample addresses). */
    hasHistory: boolean;
    notices: { risk?: string; forecast?: string; history?: string };
  };
  /** One plain sentence on why there is no local record, when there is none. */
  recordNotice: string | null;
}
