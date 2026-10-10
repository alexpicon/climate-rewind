/**
 * "Next 7 days": one card per day. Types only; safe to import from client code.
 * Everything under `what` is an official forecast read at the address. `before` and `climate` are counts from the address's own
 * records. `actions` are written by the AI from the official guidance corpus and kept only when they cite a guidance line.
 */
import type { AiErrorBody } from "../ai/types";
import type { GuidanceLine, HazardId } from "../ready/types";

export type WeekHazardKind = "heat" | "flood" | "storm" | "wind";

/** 1 heads-up, 2 take care, 3 high concern. Always written out as words too; color is only a second cue. */
export type WeekLevel = 1 | 2 | 3;

export const LEVEL_WORD: Record<WeekLevel, string> = { 1: "Heads-up", 2: "Take care", 3: "High concern" };

export interface DayForecast {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  highF: number | null;
  lowF: number | null;
  /** Highest forecast feels-like of the day, F. */
  feelsF: number | null;
  /** Highest chance of rain in any hour of the day, percent. */
  rainChance: number | null;
  rainIn: number | null;
  snowIn: number | null;
  gustMph: number | null;
  /** The NWS forecast's own short words for the day ("Mostly sunny"). */
  words: string | null;
}

/** The official outlook products at the address for this day (Days 1 to 3 only; null when not issued for this day). */
export interface DayOfficial {
  /** NWS HeatRisk 0 to 4. */
  heatRisk: 0 | 1 | 2 | 3 | 4 | null;
  /** WPC Excessive Rainfall Outlook. */
  ero: "none" | "MRGL" | "SLGT" | "ENH" | "MDT" | "HIGH" | null;
  /** SPC percent within 25 miles; `kind` says tornado (Days 1, 2) or any severe (Day 3). */
  spc: { percent: number; kind: "tornado" | "severe" } | null;
}

export interface WeekHazard {
  kind: WeekHazardKind;
  level: WeekLevel;
  /** The plain headline: "Hot", "Heavy rain", "Storms", "Strong wind". */
  title: string;
  /** What to expect, in plain words, no jargon. */
  plain: string;
  /** The official names, for small source text. */
  source: string;
  /** What it meant here before, from this address's records. Null when the records hold nothing to say. */
  before: string | null;
  /** Climate context, one line. Heat only, only when the data supports it. */
  climate: string | null;
}

export interface WeekAction {
  /** What to do, as the AI wrote it and the checks passed it. */
  text: string;
  /** The official guidance lines it cites (at least one). */
  guidance: GuidanceLine[];
}

export interface WeekDay {
  date: string;
  /** 0 is today. */
  index: number;
  forecast: DayForecast;
  hazards: WeekHazard[];
  /** True when there is at least one hazard; a quiet day collapses to one line. */
  notable: boolean;
  actions: WeekAction[];
  /** "ai": written by the AI and checked. "official": the AI was not available, so these are official lines word for word. */
  actionsFrom: "ai" | "official" | null;
}

export interface WeekPayload {
  /** ok: days are filled in. problem: the forecast could not be read (see notices). */
  state: "ok" | "problem";
  checkedAt: string;
  timeZone: string | null;
  days: WeekDay[];
  /** Plain lines for every source that could not be read. */
  notices: string[];
  /** The AI part: "ok", "skipped" (not asked for), "none" (no notable days), or "problem". */
  ai: { state: "ok" | "skipped" | "none" | "problem"; problem?: AiErrorBody; dropped: number; model: string; cached: boolean };
}

/** Which corpus hazards each card kind draws official guidance from. */
export const HAZARD_OF_KIND: Record<WeekHazardKind, HazardId> = { heat: "heat", flood: "flood", storm: "tornado", wind: "wind" };
