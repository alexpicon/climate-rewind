/**
 * "Next 7 days" for one address: the NWS forecast, HeatRisk (7 days), the WPC and SPC outlooks (Days 1 to 3), this address's own
 * records, and the "what to do" actions. Server only. The base (everything except the AI) is kept 10 minutes; the AI actions for a
 * given set of notable days are kept 60 minutes, so a visitor going back and forth does not pay for them twice.
 */
import type { AiDeps } from "../ai/service";
import { AnswerCache } from "../ai/guard";
import { AI_MODEL, getAiDeps, guardAiRequest, type AiFailure } from "../climate/model";
import type { FetchLike } from "../http";
import { LruCache } from "../lru";
import { buildOutlook } from "../outlooks";
import { findOutlookRecord, loadOutlookRecords } from "../outlook-record";
import type { OutlookPayload } from "../outlook-types";
import { defaultReadyDeps, gatherRecord, type Gathered, type ReadyDeps } from "../ready/ready-route";
import { fetchDailyFeelsLike } from "../sources";
import type { HeatDay } from "../types";
import { dayName } from "../ui/ahead-text";
import { askWeekActions, officialActions, type ActionDay } from "./actions";
import { classifyDay } from "./classify";
import { fetchWeekForecast, fetchWeekHeatRisk } from "./forecast";
import { beforeLine, heatClimateLine, type LocalRecord } from "./history";
import type { DayForecast, DayOfficial, WeekDay, WeekHazard, WeekPayload } from "./types";

const BASE_CACHE_MS = 10 * 60_000;
export const ACTIONS_CACHE_MS = 60 * 60_000;

export interface WeekDeps {
  fetch: FetchLike;
  now: () => Date;
  outlook: (lat: number, lon: number) => Promise<OutlookPayload>;
  /** The address's own records (flood reports, tornado paths, area events). */
  record: (lat: number, lon: number, state: string) => Promise<Gathered>;
  /** Daily feels-like highs since 2000: the saved sample record, or the live archive. Null: could not be read. */
  heatDays: (lat: number, lon: number) => Promise<HeatDay[] | null>;
  ai: () => AiDeps;
}

export function defaultWeekDeps(): WeekDeps {
  const fetchFn: FetchLike = (url, init) => fetch(url, init);
  const ready: ReadyDeps = defaultReadyDeps();
  return {
    fetch: fetchFn,
    now: () => new Date(),
    outlook: (lat, lon) => buildOutlook(lat, lon),
    record: (lat, lon, state) => gatherRecord(lat, lon, state, ready),
    heatDays: async (lat, lon) => {
      const saved = findOutlookRecord(lat, lon, await loadOutlookRecords().catch(() => []));
      if (saved?.heat) {
        const start = Date.parse(`${saved.heat.start}T00:00:00Z`);
        const days: HeatDay[] = [];
        saved.heat.feelsF.forEach((value, i) => {
          if (typeof value === "number") days.push({ date: new Date(start + i * 86_400_000).toISOString().slice(0, 10), feelsF: value });
        });
        if (days.length) return days;
      }
      const daily = await fetchDailyFeelsLike(lat, lon, fetchFn);
      return daily.value ?? null;
    },
    ai: getAiDeps,
  };
}

const baseCache = new LruCache<WeekPayload>(100, BASE_CACHE_MS);
const actionCache = new AnswerCache<{ days: WeekDay[]; dropped: number; model: string }>(ACTIONS_CACHE_MS);

export function clearWeekCache(): void {
  baseCache.clear();
  actionCache.clear();
}

const empty = (message: string, now: Date): WeekPayload => ({ state: "problem", checkedAt: now.toISOString(), timeZone: null, days: [], notices: [message], ai: { state: "skipped", dropped: 0, model: "", cached: false } });

/** Assembles the seven cards from already-read inputs. Pure apart from the inputs; the tests call this with fixtures. */
export function assembleWeek(
  forecasts: readonly DayForecast[],
  heatRisk: Array<DayOfficial["heatRisk"]> | null,
  outlook: OutlookPayload | null,
  record: LocalRecord,
): WeekDay[] {
  return forecasts.map((forecast, index) => {
    const flood = outlook?.flood.days?.[index];
    const tornado = outlook?.tornado.days?.[index];
    const official: DayOfficial = {
      heatRisk: heatRisk?.[index] ?? null,
      ero: flood ? flood.level : null,
      spc: tornado ? { percent: tornado.percent, kind: tornado.kind } : null,
    };
    const hazards: WeekHazard[] = classifyDay(forecast, official, index).map((h) => ({
      ...h,
      before: beforeLine(h, forecast, official, record),
      climate: h.kind === "heat" ? heatClimateLine(record.heatDays, forecast.feelsF) : null,
    }));
    return { date: forecast.date, index, forecast, hazards, notable: hazards.length > 0, actions: [], actionsFrom: null };
  });
}

/** The cards without the AI part. */
export async function buildWeekBase(lat: number, lon: number, state: string, deps: WeekDeps): Promise<WeekPayload> {
  const now = deps.now();
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = baseCache.get(key, now.getTime());
  if (cached) return cached;

  // The records and outlooks do not need the time zone, so they are read while the forecast is.
  const outlookRead = deps.outlook(lat, lon).catch(() => null);
  const recordRead = deps.record(lat, lon, state).catch(() => null);
  const heatRead = deps.heatDays(lat, lon).catch(() => null);
  const forecast = await fetchWeekForecast(lat, lon, deps.fetch, now);
  if (!forecast.value) return empty(forecast.notice ?? "The National Weather Service forecast could not be read just now.", now);

  const dates = forecast.value.days.map((d) => d.date);
  const [risk, outlook, gathered, heatDays] = await Promise.all([fetchWeekHeatRisk(lat, lon, dates, deps.fetch), outlookRead, recordRead, heatRead]);

  const notices: string[] = [];
  if (forecast.value.days.every((d) => d.highF === null)) notices.push("The forecast did not cover the coming days yet.");
  if (risk.notice) notices.push(risk.notice);
  if (!outlook) notices.push("The official rain and storm outlooks could not be read just now, so only the forecast and HeatRisk are used.");
  else {
    if (outlook.flood.notice) notices.push(outlook.flood.notice);
    else if (outlook.tornado.notice && outlook.tornado.notice !== outlook.flood.notice) notices.push(outlook.tornado.notice);
  }
  if (!heatDays) notices.push("The heat record for this address could not be read just now, so heat is shown without its history.");
  if (gathered) notices.push(...gathered.notices);

  const record: LocalRecord = {
    heatDays,
    floodRecord: outlook?.flood.record ?? null,
    tornadoRecord: outlook?.tornado.record ?? null,
    floods: gathered?.input.floods ?? [],
    tornadoes: gathered?.input.tornadoes ?? [],
    events: gathered?.input.events ?? [],
  };
  const days = assembleWeek(forecast.value.days, risk.value, outlook, record);
  const payload: WeekPayload = {
    state: "ok",
    checkedAt: now.toISOString(),
    timeZone: forecast.value.timeZone,
    days,
    notices,
    ai: { state: days.some((d) => d.notable) ? "skipped" : "none", dropped: 0, model: "", cached: false },
  };
  // Only a complete read is reused: a failed source should be tried again on the next look.
  if (outlook && !risk.notice && heatDays && gathered) baseCache.set(key, payload, now.getTime());
  return payload;
}

const WHEN = (index: number, date: string) => (index === 0 ? "today" : index === 1 ? "tomorrow" : dayName(date));

/** The notable days as the AI is given them. */
export function actionDays(days: readonly WeekDay[]): ActionDay[] {
  return days
    .filter((d) => d.notable)
    .map((d) => ({ date: d.date, when: WHEN(d.index, d.date), kinds: d.hazards.map((h) => h.kind), expect: d.hazards.map((h) => h.plain).join(" ") }));
}

/** Same set of notable days (and levels): the same actions. */
export function actionSignature(days: readonly WeekDay[]): string {
  return days
    .filter((d) => d.notable)
    .map((d) => `${d.date}:${d.hazards.map((h) => `${h.kind}${h.level}`).join("+")}`)
    .join("|");
}

const withOfficial = (days: readonly WeekDay[]): WeekDay[] => days.map((d) => (d.notable ? { ...d, actions: officialActions(d.hazards.map((h) => h.kind)), actionsFrom: "official" as const } : d));
/** A notable day the AI gave nothing usable for shows the official lines instead. */
const fillGaps = (days: readonly WeekDay[]): WeekDay[] => days.map((d) => (d.notable && d.actions.length === 0 ? { ...d, actions: officialActions(d.hazards.map((h) => h.kind)), actionsFrom: "official" as const } : d));

export interface ActionOutcome {
  payload: WeekPayload;
  /** Set when the request itself must be refused (rate limit, wrong origin): send this instead. */
  refuse?: AiFailure;
}

/**
 * Adds the "what to do" actions. One model call for all notable days, kept 60 minutes. When the AI is resting, off, or fails, the days
 * show the official guidance lines word for word instead, and `ai.problem` says why. `guard` is the route's same-origin / rate-limit check.
 */
export async function withActions(base: WeekPayload, deps: WeekDeps, place: string, guard: (ai: AiDeps) => AiFailure | null = () => null): Promise<ActionOutcome> {
  if (base.state !== "ok" || !base.days.some((d) => d.notable)) return { payload: { ...base, ai: { ...base.ai, state: "none" } } };
  const ai = deps.ai();
  const cacheKey = `${place}|${actionSignature(base.days)}`;
  const merge = (made: { days: WeekDay[]; dropped: number; model: string }, cached: boolean): WeekPayload => ({ ...base, days: made.days, ai: { state: "ok", dropped: made.dropped, model: made.model, cached } });
  const hit = actionCache.get(cacheKey, ai.now());
  if (hit) {
    // The cached actions belong to this signature; the day cards come from this (fresh) base.
    return { payload: merge({ ...hit, days: fillGaps(attach(base.days, hit.days)) }, true) };
  }

  const blocked = guard(ai);
  if (blocked && blocked.body.state !== "resting" && blocked.body.state !== "unavailable") return { payload: base, refuse: blocked };
  if (blocked) return { payload: { ...base, days: withOfficial(base.days), ai: { state: "problem", problem: blocked.body, dropped: 0, model: "", cached: false } } };

  try {
    const made = await actionCache.once(cacheKey, async () => {
      const asked = await askWeekActions(actionDays(base.days), ai);
      if (!asked.ok) throw Object.assign(new Error("ai"), { failure: asked.failure });
      const days = base.days.map((d) => {
        const kept = asked.result.byDate.get(d.date);
        return kept?.length ? { ...d, actions: kept, actionsFrom: "ai" as const } : d;
      });
      const value = { days, dropped: asked.result.dropped, model: asked.model };
      // A day the checks emptied shows the official lines; if nothing at all passed, do not keep the answer for an hour.
      if (days.some((d) => d.actionsFrom === "ai")) actionCache.set(cacheKey, value, ai.now());
      return value;
    });
    return { payload: merge({ ...made, days: fillGaps(attach(base.days, made.days)) }, false) };
  } catch (error) {
    const failure = (error as { failure?: AiFailure } | null)?.failure;
    console.error("week actions failed", (error as Error | null)?.name);
    return {
      payload: {
        ...base,
        days: withOfficial(base.days),
        ai: { state: "problem", problem: failure?.body ?? { state: "error", message: "The AI did not answer. Please try again in a moment." }, dropped: 0, model: AI_MODEL, cached: false },
      },
    };
  }
}

/** Puts actions made for the same set of notable days onto the current day cards. */
function attach(current: readonly WeekDay[], made: readonly WeekDay[]): WeekDay[] {
  const byDate = new Map(made.map((d) => [d.date, d]));
  return current.map((d) => {
    const m = byDate.get(d.date);
    return m && m.actions.length ? { ...d, actions: m.actions, actionsFrom: m.actionsFrom } : d;
  });
}

export { guardAiRequest };
