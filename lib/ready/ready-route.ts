/**
 * GET /api/ready?lat=36.1682&lon=-86.7775&state=TN
 *
 * Reads this address's own record (flood reports within 5 km, tornado tracks within 10 km, the heat record, and the storm events recorded for
 * its forecast zone or county when data/events exists), has the AI write a short plan from it, and keeps only the items that cite both a
 * real local fact and a line of official guidance. One answer per address is kept for six hours. Server only.
 */
import { AnswerCache } from "../ai/guard";
import { getAiDeps, guardAiRequest, serverError } from "../climate/model";
import { parsePoint } from "../climate/future-route";
import type { FetchLike } from "../http";
import { loadStateIndex } from "../index-store";
import { findNearbyFloods, findNearbyTornadoes, summarizeHeat } from "../lookup";
import { fetchAreaIds, type NwsAreaIds } from "../nws-zones";
import { findSnapshot, loadSampleSnapshots, type SampleSnapshot } from "../samples";
import { fetchDailyFeelsLike } from "../sources";
import type { AiDeps } from "../ai/service";
import type { HeatSummary, StateIndex } from "../types";
import { selectAreaEvents, sinceYear } from "@/lib/area-events";
import type { AreaEvent, AreaEventsInput } from "./events";
import { buildLocalFacts } from "./local";
import { buildReady } from "./plan";
import type { ReadyPayload } from "./types";

const READY_CACHE_MS = 6 * 60 * 60_000;
const plans = new AnswerCache<ReadyPayload>(READY_CACHE_MS);

export function clearReadyCache(): void {
  plans.clear();
}

export interface ReadyDeps {
  fetch: FetchLike;
  now: () => Date;
  loadIndex: (state: string) => Promise<StateIndex | null>;
  /** The events recorded for this address's county and zones (the shared selector in lib/area-events.ts, once wired): null when there is no events data. */
  areaEvents: (input: AreaEventsInput) => Promise<AreaEvent[] | null>;
  areaIds: (lat: number, lon: number) => Promise<NwsAreaIds | null>;
  snapshots: () => Promise<SampleSnapshot[]>;
  heat: (lat: number, lon: number) => Promise<HeatSummary | null>;
  ai: () => AiDeps;
}

export function defaultReadyDeps(): ReadyDeps {
  const fetchFn: FetchLike = (url, init) => fetch(url, init);
  return {
    fetch: fetchFn,
    now: () => new Date(),
    loadIndex: loadStateIndex,
    // The shared selector: the county's own events plus zones that contain the point or lie within 15 km (lib/area-events.ts).
    areaEvents: async ({ lat, lon, state, county }) => {
      if (!county) return null;
      const found = await selectAreaEvents(lat, lon, state, county);
      return found ? sinceYear(found.events) : null;
    },
    areaIds: (lat, lon) => fetchAreaIds(lat, lon, fetchFn),
    snapshots: () => loadSampleSnapshots(),
    heat: async (lat, lon) => {
      const daily = await fetchDailyFeelsLike(lat, lon, fetchFn);
      return daily.value ? summarizeHeat(daily.value) : null;
    },
    ai: getAiDeps,
  };
}

const STATE = /^[A-Za-z]{2}$/;

export interface Gathered {
  input: Parameters<typeof buildReady>[0];
  notices: string[];
}

/** The address's record, with a plain notice for every part that could not be read. */
export async function gatherRecord(lat: number, lon: number, state: string, deps: ReadyDeps): Promise<Gathered> {
  const origin: [number, number] = [lat, lon];
  const notices: string[] = [];

  const snapshot = findSnapshot(lat, lon, await deps.snapshots().catch(() => []));
  const [index, heat, ids] = await Promise.all([
    deps.loadIndex(state).catch(() => null),
    snapshot?.heat ? Promise.resolve<HeatSummary | null>({ byYear: snapshot.heat.byYear, hottest: snapshot.heat.hottest, worstWeek: snapshot.heat.worstWeek, regionalSlug: null }) : deps.heat(lat, lon).catch(() => null),
    deps.areaIds(lat, lon).catch(() => null),
  ]);

  if (!index) notices.push(`We have not indexed ${state} yet, so flood reports and tornado paths are not part of this plan.`);
  if (!heat) notices.push("The heat record for this address could not be read just now, so heat is not part of this plan.");
  let events: AreaEvent[] = [];
  if (!ids) {
    notices.push("We could not look up this address's forecast zone, so storm events for the wider area are not part of this plan.");
  } else {
    const found = await deps.areaEvents({ lat, lon, state, county: ids.county, zone: ids.zone }).catch(() => null);
    if (found) events = found;
    else notices.push("Storm events for the wider area (wind, winter storms, wildfire smoke) are not part of this plan yet.");
  }

  return {
    input: {
      indexed: Boolean(index),
      floods: index ? findNearbyFloods(index.floods, origin).reports : [],
      tornadoes: index ? findNearbyTornadoes(index.tornadoes, origin) : [],
      heat,
      events,
    },
    notices,
  };
}

export async function readyRoute(request: Request, deps: ReadyDeps = defaultReadyDeps()): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const point = parsePoint(params);
  const state = (params.get("state") ?? "").toUpperCase();
  if (!point || !STATE.test(state)) return Response.json({ error: "lat, lon and a two-letter state are required, and must be in the United States." }, { status: 400 });
  const headers = { "Cache-Control": "no-store" };
  const ai = deps.ai();
  const key = `${point.lat.toFixed(3)},${point.lon.toFixed(3)},${state}`;

  const cached = plans.get(key, ai.now());
  if (cached) return Response.json({ ...cached, cached: true } satisfies ReadyPayload, { headers });

  // A visitor sending too many requests gets the plain refusal at once. Any other "AI is not answering" still gets the record, counted by code.
  const blocked = guardAiRequest(request, ai);
  if (blocked && blocked.body.state !== "resting" && blocked.body.state !== "unavailable") return Response.json(blocked.body, { status: blocked.status, headers: { ...headers, ...(blocked.headers ?? {}) } });

  try {
    const run = async () => {
      const { input, notices } = await gatherRecord(point.lat, point.lon, state, deps);
      if (blocked) {
        return { payload: { state: "problem", items: [], hazards: buildLocalFacts(input).hazards, dropped: 0, notices, problem: blocked.body, generatedAt: new Date(ai.now()).toISOString(), model: "", cached: false } satisfies ReadyPayload, cacheable: false };
      }
      const built = await buildReady(input, notices, ai);
      if (built.ok) return built.result;
      return {
        payload: { state: "problem", items: [], hazards: built.hazards, dropped: 0, notices, problem: built.failure.body, generatedAt: new Date(ai.now()).toISOString(), model: "", cached: false } satisfies ReadyPayload,
        cacheable: false,
      };
    };
    const result = await plans.once(key, async () => {
      const done = await run();
      if (done.cacheable) plans.set(key, done.payload, ai.now());
      return done.payload;
    });
    return Response.json(result, { headers });
  } catch (error) {
    console.error("ready failed", (error as Error | null)?.name);
    const failure = serverError();
    return Response.json(failure.body, { status: failure.status, headers });
  }
}
