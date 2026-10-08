/**
 * The words for "Your street's next 72 hours". Pure and client-safe; the AI sources (lib/ai/sources.ts) use the same helpers,
 * so a number on the page and a number the briefing quotes are written the same way.
 *
 * Wording rule: official outlooks are the agencies'. Counts of past days are "how this has played out here", never "our prediction".
 */
import {
  ERO_LABEL,
  HEATRISK_LABEL,
  type EroLevel,
  type EroRecordKey,
  type FloodOutlookDay,
  type FloodRecord,
  type HeatForecastDay,
  type HeatRank,
  type HeatRiskDay,
  type RecordCount,
  type TornadoOutlookDay,
  type TornadoRecord,
  type TornadoRecordKey,
} from "../outlook-types";
import { MONTHS } from "./text";

/** Fewer days than this and a share is an anecdote, not a pattern. */
export const FEW_DAYS = 10;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-10-08" -> "Thu Oct 8" */
export function dayName(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Day 1 is "Today", Day 2 "Tomorrow", Day 3 the weekday and date. */
export function dayLabel(day: 1 | 2 | 3, date: string): string {
  return day === 1 ? "Today" : day === 2 ? "Tomorrow" : dayName(date);
}

/** 8.5% with one decimal under 10%, whole percent from 10%. 0 days gives "n/a". */
export function percentText(hit: number, n: number): string {
  if (n <= 0) return "n/a";
  const p = (hit / n) * 100;
  if (p >= 10) return `${Math.round(p)}%`;
  return `${Math.round(p * 10) / 10}%`;
}

const fmt = (n: number) => n.toLocaleString("en-US");

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2016-10-01" -> "October 2016" */
export function monthYear(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// ---------------------------------------------------------------- flood

const ERO_ORDER: EroLevel[] = ["none", "MRGL", "SLGT", "ENH", "MDT", "HIGH"];

/** The highest level over the given days, "none" for an empty list. */
export function worstLevel(days: FloodOutlookDay[]): EroLevel {
  return days.reduce<EroLevel>((worst, d) => (ERO_ORDER.indexOf(d.level) > ERO_ORDER.indexOf(worst) ? d.level : worst), "none");
}

/** ENH has no row in the record (WPC has not issued it in the archive); it is read against Moderate's neighbour, Slight, only if asked. */
export function recordKeyForLevel(level: EroLevel): EroRecordKey {
  return level === "ENH" ? "SLGT" : level;
}

export interface RecordLine {
  /** One sentence: how this kind of day has played out here. */
  sentence: string;
  /** Too few days to say anything firm. */
  few: boolean;
  count: RecordCount;
}

export function floodRecordLine(level: EroLevel, record: FloodRecord): RecordLine {
  const key = recordKeyForLevel(level);
  const count = record.byCategory[key];
  const since = monthYear(record.window.start);
  const rated = key === "none" ? "had no risk area here" : `were rated ${ERO_LABEL[key]} here by the Weather Prediction Center`;
  const few = count.days < FEW_DAYS;
  const sentence =
    count.days === 0
      ? `Since ${since}, no day was rated ${key === "none" ? "without a risk area" : ERO_LABEL[key]} here.`
      : `Since ${since}, ${fmt(count.days)} ${count.days === 1 ? "day" : "days"} ${rated}. A flood was reported within ${record.radiusKm} km on ${fmt(count.hitDays)} of ${count.days === 1 ? "it" : "them"} (${percentText(count.hitDays, count.days)}).`;
  return { sentence, few, count };
}

// ---------------------------------------------------------------- tornado

export function tornadoKeyForPercent(percent: number): TornadoRecordKey {
  return percent <= 0 ? "none" : percent <= 2 ? "2" : percent <= 5 ? "5" : "10+";
}

/** The highest probability over Days 1 and 2 (the tornado-specific ones). Day 3 only has a combined severe probability. */
export function worstTornadoPercent(days: TornadoOutlookDay[]): number {
  return days.filter((d) => d.kind === "tornado").reduce((worst, d) => Math.max(worst, d.percent), 0);
}

export function tornadoRecordLine(percent: number, record: TornadoRecord): RecordLine {
  const key = tornadoKeyForPercent(percent);
  const count = record.byProbability[key];
  const since = monthYear(record.window.start);
  const gave = key === "none" ? "showed no tornado risk area here" : key === "10+" ? "gave this point 10% or more" : `gave this point ${key}%`;
  const few = count.days < FEW_DAYS;
  const sentence =
    count.days === 0
      ? `Since ${since}, there was no day when the Storm Prediction Center ${gave}.`
      : `Since ${since}, the Storm Prediction Center ${gave} on ${fmt(count.days)} ${count.days === 1 ? "day" : "days"}. A tornado track passed within ${record.radiusMi} miles on ${fmt(count.hitDays)} of ${count.days === 1 ? "it" : "them"} (${percentText(count.hitDays, count.days)}).`;
  return { sentence, few, count };
}

// ---------------------------------------------------------------- heat

export function heatRiskText(day: HeatRiskDay): string {
  return day.level === null ? "No value" : `Level ${day.level} of 4, ${HEATRISK_LABEL[day.level].toLowerCase()}`;
}

/** "Top 4.1% of all days at this address since 2000" (this hot or hotter), plus the same for this time of year. */
export function heatRankText(rank: HeatRank): { all: string; season: string } {
  return {
    all: `${fmt(rank.allAtLeast)} of ${fmt(rank.allTotal)} days since ${rank.since} (${percentText(rank.allAtLeast, rank.allTotal)}) were this hot or hotter.`,
    season: `For days within a week of this date, in any year, ${fmt(rank.seasonAtLeast)} of ${fmt(rank.seasonTotal)} (${percentText(rank.seasonAtLeast, rank.seasonTotal)}).`,
  };
}

/** True when a forecast day is unusual enough for its ranking to be worth a sentence: in the hottest quarter of days for this time of year. */
export function heatIsNotable(day: HeatForecastDay): boolean {
  return !!day.rank && day.rank.seasonTotal > 0 && day.rank.seasonAtLeast / day.rank.seasonTotal <= 0.25;
}
