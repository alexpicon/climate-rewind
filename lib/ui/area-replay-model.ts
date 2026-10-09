/**
 * The area replay's frames: 26 years of a county's and its zones' recorded events, as a pure function of progress `p` (0 to 1), like
 * every animated view. An event flares its area in its hazard family's colour on its date and fades over LIGHT_DAYS, leaving a faint
 * glow that grows with the events filed there so far, so the map fills in over the years (a quiet county is not dark between events);
 * the totals by family count up; the most recent deadly or costly event is named. At the end (and with reduced motion) each area keeps
 * the colour of the family filed most often there, stronger where more was filed.
 */
import type { AreaReplay } from "../area-replay";
import { familyOf, FAMILY_ORDER, type Family } from "./story-model";

/** The whole replay at 1x: about a second a year. */
export const AREA_REPLAY_MS = 28_000;
/** How long an event's flare takes to fade, in days of the replay's clock (about a quarter of a second on screen). */
export const LIGHT_DAYS = 90;
/** The faint glow an area keeps after its events: up to this strength, growing with the events filed there so far. */
export const RESIDUE = 0.3;
/** An event this costly (dollars of property and crop damage), or with any death or injury, is named as it happens. */
export const NOTABLE_DAMAGE_USD = 1_000_000;

export interface ReplayEvent {
  day: number;
  type: string;
  family: Family;
  area: number;
  deaths: number;
  injuries: number;
  damageUsd: number;
}

export interface ReplayModel {
  since: number;
  events: ReplayEvent[];
  spanDays: number;
  /** Running count by family: counts[f][i] = events of family f among the first i events. */
  counts: Record<Family, Int32Array>;
  deathsBefore: Int32Array;
  /** The most events any one area has, for scaling the residue. */
  busiest: number;
}

export function buildReplayModel(replay: AreaReplay): ReplayModel {
  const events = replay.events
    .map(([day, type, area, deaths, injuries, damageUsd]) => ({ day, type: replay.types[type] ?? "Other", family: familyOf(replay.types[type] ?? ""), area, deaths, injuries, damageUsd }))
    .sort((a, b) => a.day - b.day);
  const counts = Object.fromEntries(FAMILY_ORDER.map((f) => [f, new Int32Array(events.length + 1)])) as Record<Family, Int32Array>;
  const deathsBefore = new Int32Array(events.length + 1);
  events.forEach((event, i) => {
    for (const f of FAMILY_ORDER) counts[f][i + 1] = counts[f][i] + (event.family === f ? 1 : 0);
    deathsBefore[i + 1] = deathsBefore[i] + event.deaths;
  });
  const lastDay = events.length ? events[events.length - 1].day : 0;
  const perArea = new Map<number, number>();
  for (const event of events) perArea.set(event.area, (perArea.get(event.area) ?? 0) + 1);
  return { since: replay.since, events, spanDays: lastDay + LIGHT_DAYS, counts, deathsBefore, busiest: Math.max(1, ...perArea.values()) };
}

/** Events with day at or before `day` (events are sorted by day). */
function upTo(events: readonly ReplayEvent[], day: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].day <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface LitArea {
  area: number;
  family: Family;
  /** 0 to 1. */
  strength: number;
}

export interface ReplayFrame {
  year: number;
  /**
   * Every area with an event so far, in the colour of its most recent one: as strong as that event's flare is fresh, and never weaker
   * than its residue (RESIDUE scaled by the log of its events so far against the busiest area's total).
   */
  lit: LitArea[];
  counts: Record<Family, number>;
  total: number;
  deaths: number;
  /** The most recent notable event within the last year of the replay's clock, or null. */
  notable: ReplayEvent | null;
}

const yearOf = (since: number, day: number) => new Date(Date.UTC(since, 0, 1) + day * 86_400_000).getUTCFullYear();

export function replayFrame(model: ReplayModel, p: number): ReplayFrame {
  const clamped = Math.min(1, Math.max(0, p));
  const day = clamped * model.spanDays;
  const started = upTo(model.events, day);
  const counts = Object.fromEntries(FAMILY_ORDER.map((f) => [f, model.counts[f][started]])) as Record<Family, number>;
  const soFar = new Map<number, { count: number; latest: ReplayEvent }>();
  for (let i = 0; i < started; i += 1) {
    const event = model.events[i];
    soFar.set(event.area, { count: (soFar.get(event.area)?.count ?? 0) + 1, latest: event });
  }
  const lit: LitArea[] = [];
  for (const [area, { count, latest }] of soFar) {
    const flare = Math.max(0, 1 - (day - latest.day) / LIGHT_DAYS);
    const residue = (RESIDUE * Math.log1p(count)) / Math.log1p(model.busiest);
    lit.push({ area, family: latest.family, strength: Math.max(flare, residue) });
  }
  let notable: ReplayEvent | null = null;
  for (let i = started - 1; i >= 0 && day - model.events[i].day <= 365; i -= 1) {
    const event = model.events[i];
    if (event.deaths > 0 || event.injuries > 0 || event.damageUsd >= NOTABLE_DAMAGE_USD) {
      notable = event;
      break;
    }
  }
  const lastDay = model.events.length ? model.events[model.events.length - 1].day : 0;
  return { year: yearOf(model.since, Math.min(day, lastDay)), lit: [...lit.values()], counts, total: started, deaths: model.deathsBefore[started], notable };
}

/** The finished picture: each area in the colour of the family filed most often there, stronger where more was filed. */
export function finalTint(model: ReplayModel): LitArea[] {
  const byArea = new Map<number, Map<Family, number>>();
  for (const event of model.events) {
    const families = byArea.get(event.area) ?? new Map<Family, number>();
    families.set(event.family, (families.get(event.family) ?? 0) + 1);
    byArea.set(event.area, families);
  }
  const totals = [...byArea.values()].map((families) => [...families.values()].reduce((a, b) => a + b, 0));
  const most = Math.max(1, ...totals);
  return [...byArea.entries()].map(([area, families]) => {
    const [family] = [...families.entries()].sort((a, b) => b[1] - a[1] || FAMILY_ORDER.indexOf(a[0]) - FAMILY_ORDER.indexOf(b[0]))[0];
    const total = [...families.values()].reduce((a, b) => a + b, 0);
    return { area, family, strength: 0.25 + 0.75 * (Math.log1p(total) / Math.log1p(most)) };
  });
}

/** "Dec 14, 2006" for an event's day. */
export function replayDate(model: ReplayModel, day: number): string {
  return new Date(Date.UTC(model.since, 0, 1) + day * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The replay with only the events of the given NWS types (an empty or absent list keeps them all). */
export function onlyKinds(replay: AreaReplay, kinds: readonly string[] | null | undefined): AreaReplay {
  if (!kinds?.length) return replay;
  const wanted = new Set(kinds);
  return { ...replay, events: replay.events.filter(([, type]) => wanted.has(replay.types[type] ?? "")) };
}

/** "wildfire" or "hurricane and tropical storm" for a short list of NWS types, in words for a sentence. */
export function kindsLabel(kinds: readonly string[]): string {
  const words = [...new Set(kinds.map((k) => k.replace(/\s*\(.*\)$/, "").replace(/\/.*$/, "").toLowerCase()))];
  return words.length <= 2 ? words.join(" and ") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
