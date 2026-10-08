/**
 * Address lookup: turns a typed address into the CONTRACT payload.
 *
 * The pure pieces (flood filter and tiers, replay-night selection, tornado
 * distance, heat summary) are exported on their own so they can be tested with
 * fixtures. `lookupAddress` wires them to the live sources.
 */
import {
  FLOOD_RADIUS_KM,
  FRAME_MINUTES,
  REPLAY_CLUSTER_HOURS,
  REPLAY_MAX_HOURS,
  REPLAY_NIGHT_RADIUS_KM,
  REPLAY_PAD_MINUTES,
  RECENT_NIGHT_FROM_YEAR,
  RECENT_NIGHT_MIN_REPORTS,
  REPLAY_REGION_KM,
  TOP_NIGHTS,
  TORNADO_RADIUS_KM,
} from "./constants";
import { buildFloodTrigger } from "./flood-trigger";
import { loadDamageRows } from "./ai/damage";
import { damagePinsFor } from "./damage-pins";
import { boxAround, haversineKm, segmentDistance } from "./geo";
import { loadHeatGrid, loadStateIndex, slugify } from "./index-store";
import type { FetchLike } from "./http";
import { findSnapshot, loadSampleSnapshots, type SampleSnapshot } from "./samples";
import {
  fetchActiveAlerts,
  fetchDailyFeelsLike,
  fetchFemaZone,
  geocodeAddress,
  HEAT_THRESHOLD_F,
  type Sourced,
} from "./sources";
import type {
  DamagePin,
  Coord,
  Coverage,
  FloodRow,
  FloodTier,
  HeatDay,
  HeatGrid,
  HeatSummary,
  LiveAlerts,
  LookupAddress,
  LookupPayload,
  NearbyFlood,
  NearbyTornado,
  NoticeKey,
  StateIndex,
  StormNight,
  StormReplay,
  TierCounts,
  TornadoRow,
} from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// ---------------------------------------------------------------- floods

/** The point a report is drawn at for distance purposes: the detective's placement if there is one. */
export function reportPoint(flood: FloodRow): Coord | null {
  return flood.placed ?? flood.filed;
}

/**
 * mentioned = the detective placed it from an address or intersection in the text
 * about1km = the NWS gave a precise or rounded coordinate
 * citywide = a city placeholder or no coordinate, and no placement
 */
export function tierOf(flood: FloodRow): FloodTier {
  const verdict = flood.detective;
  if (verdict?.verdict === "placed" && (verdict.matchType === "address" || verdict.matchType === "intersection")) {
    return "mentioned";
  }
  if (flood.coordPrecision === "precise" || flood.coordPrecision === "rounded") return "about1km";
  return "citywide";
}

/** Rows that duplicate another row are never counted. */
function distinctFloods(floods: FloodRow[]): FloodRow[] {
  return floods.filter((flood) => !flood.dupOf);
}

export function findNearbyFloods(
  floods: FloodRow[],
  origin: Coord,
  radiusKm: number = FLOOD_RADIUS_KM,
): { reports: NearbyFlood[]; tierCounts: TierCounts } {
  const reports: NearbyFlood[] = [];
  for (const flood of distinctFloods(floods)) {
    const point = reportPoint(flood);
    if (!point) continue;
    const distanceKm = haversineKm(origin, point);
    if (distanceKm <= radiusKm) reports.push({ ...flood, distanceKm: round(distanceKm, 2), tier: tierOf(flood) });
  }
  reports.sort((a, b) => a.distanceKm - b.distanceKm);

  const tierCounts: TierCounts = { mentioned: 0, about1km: 0, citywide: 0 };
  for (const report of reports) tierCounts[report.tier] += 1;
  return { reports, tierCounts };
}

// ---------------------------------------------------------------- storm replay

const floorTo = (ms: number, step: number) => Math.floor(ms / step) * step;
const ceilTo = (ms: number, step: number) => Math.ceil(ms / step) * step;

interface Night {
  /** Reports within 15 km of the address that define the night, in time order. */
  cluster: Array<{ flood: FloodRow; ms: number }>;
  /** The radar window: the cluster padded by up to 90 minutes each side, aligned to 5-minute frames, within 7 h. */
  startMs: number;
  endMs: number;
}

/** A night's id: the UTC minute of its first report, like 2021-03-28T03:55. Stable, short and safe in a URL. */
export const nightIdOf = (firstReportMs: number): string => new Date(firstReportMs).toISOString().slice(0, 16);

/**
 * Every storm night near an address, busiest first. A night is the busiest stretch of up to 6 hours with flood
 * reports within 15 km (grouping by clock date would cut a night in half at midnight). The busiest night is taken,
 * everything inside its radar window is set aside (it appears in that replay anyway), and the search repeats on what
 * is left, so no two nights overlap. A tie goes to the earlier night.
 */
function rankNights(floods: FloodRow[], origin: Coord): Night[] {
  const frameMs = FRAME_MINUTES * MINUTE;
  const usable = distinctFloods(floods).filter((flood) => Number.isFinite(Date.parse(flood.start)));

  let pool = usable
    .filter((flood) => {
      const point = reportPoint(flood);
      return point !== null && haversineKm(origin, point) <= REPLAY_NIGHT_RADIUS_KM;
    })
    .map((flood) => ({ flood, ms: Date.parse(flood.start) }))
    .sort((a, b) => a.ms - b.ms);

  const nights: Night[] = [];
  while (pool.length > 0) {
    // Sliding window: for each report, count the reports in the next 6 hours.
    let best = { from: 0, to: 0 };
    let right = 0;
    for (let left = 0; left < pool.length; left += 1) {
      right = Math.max(right, left);
      while (right + 1 < pool.length && pool[right + 1].ms - pool[left].ms < REPLAY_CLUSTER_HOURS * HOUR) right += 1;
      // `>` keeps the earliest window when two nights tie.
      if (right - left > best.to - best.from) best = { from: left, to: right };
    }

    const cluster = pool.slice(best.from, best.to + 1);
    const spanMs = cluster[cluster.length - 1].ms - cluster[0].ms;
    // Pad each side by 90 minutes, less if that would push the window past the cap. The cluster is never cut.
    const padMs = Math.max(0, Math.min(REPLAY_PAD_MINUTES * MINUTE, (REPLAY_MAX_HOURS * HOUR - spanMs) / 2));
    const startMs = floorTo(cluster[0].ms - padMs, frameMs);
    const endMs = ceilTo(cluster[cluster.length - 1].ms + padMs, frameMs);
    nights.push({ cluster, startMs, endMs });
    pool = pool.filter((entry) => entry.ms < startMs || entry.ms > endMs);
  }
  return nights;
}

/**
 * The "Storm nights" picker: the 5 nights with the most reports within 15 km, then any other night with at least
 * 2 reports that is newer than 2023, so a recent storm like Helene is never hidden behind an older busier night.
 * The first entry is the default (most reports).
 */
export function listStormNights(floods: FloodRow[], origin: Coord): StormNight[] {
  const nights = rankNights(floods, origin);
  const entry = (night: Night): StormNight => ({
    id: nightIdOf(night.cluster[0].ms),
    date: night.cluster[0].flood.start.slice(0, 10),
    reports: night.cluster.length,
    startUtc: new Date(night.startMs).toISOString(),
    endUtc: new Date(night.endMs).toISOString(),
  });
  const top = nights.slice(0, TOP_NIGHTS).map(entry);
  const recent = nights
    .slice(TOP_NIGHTS)
    .map(entry)
    .filter((night) => night.reports >= RECENT_NIGHT_MIN_REPORTS && Number(night.date.slice(0, 4)) >= RECENT_NIGHT_FROM_YEAR)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return [...top, ...recent];
}

/**
 * Picks the storm night for an address: by default the busiest stretch of up to 6 hours
 * with flood reports within 15 km, or the night with the given id (an unknown id falls back to the busiest).
 * `reports` holds every report in the 120 km radar box during the window.
 * Returns null if nothing was reported within 15 km.
 */
export function selectReplayNight(floods: FloodRow[], origin: Coord, nightId?: string | null): StormReplay | null {
  const nights = rankNights(floods, origin);
  if (nights.length === 0) return null;
  const night = (nightId ? nights.find((n) => nightIdOf(n.cluster[0].ms) === nightId) : undefined) ?? nights[0];
  const { cluster, startMs, endMs } = night;

  const usable = distinctFloods(floods).filter((flood) => Number.isFinite(Date.parse(flood.start)));
  const bounds = boxAround(origin, REPLAY_REGION_KM);
  const regional = usable
    .filter((flood) => {
      const ms = Date.parse(flood.start);
      const point = flood.filed ?? flood.placed;
      return ms >= startMs && ms <= endMs && point !== null && haversineKm(origin, point) <= REPLAY_REGION_KM;
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  return {
    nightId: nightIdOf(cluster[0].ms),
    date: cluster[0].flood.start.slice(0, 10),
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(endMs).toISOString(),
    frameMinutes: FRAME_MINUTES,
    reportIds: cluster.map(({ flood }) => flood.id),
    bounds,
    reports: regional,
  };
}

// ---------------------------------------------------------------- tornadoes

export function findNearbyTornadoes(
  tornadoes: TornadoRow[],
  origin: Coord,
  radiusKm: number = TORNADO_RADIUS_KM,
): NearbyTornado[] {
  const nearby: NearbyTornado[] = [];
  for (const tornado of tornadoes) {
    const hit = segmentDistance(origin, tornado.begin, tornado.end);
    if (hit.km <= radiusKm) nearby.push({ ...tornado, minDistanceKm: round(hit.km, 2), closest: hit.nearest });
  }
  return nearby.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

// ---------------------------------------------------------------- heat

const DAY_MS = 24 * HOUR;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Summarises the daily feels-like highs: days at or above 100 F per year, the
 * single hottest day, and the 7 days centred on that day (shifted if the day
 * sits near the end of the record). Not a trend and not a forecast.
 */
export function summarizeHeat(days: HeatDay[]): HeatSummary | null {
  if (days.length === 0) return null;

  const byYear: Record<string, number> = {};
  let hottest = days[0];
  for (const day of days) {
    const year = day.date.slice(0, 4);
    byYear[year] ??= 0;
    if (day.feelsF >= HEAT_THRESHOLD_F) byYear[year] += 1;
    if (day.feelsF > hottest.feelsF) hottest = day;
  }

  const byDate = new Map(days.map((day) => [day.date, day]));
  const firstMs = Date.parse(days[0].date);
  const lastMs = Date.parse(days[days.length - 1].date);
  const startMs = Math.min(Math.max(Date.parse(hottest.date) - 3 * DAY_MS, firstMs), Math.max(firstMs, lastMs - 6 * DAY_MS));

  const daily: HeatDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    const day = byDate.get(isoDay(startMs + i * DAY_MS));
    if (day) daily.push({ date: day.date, feelsF: round(day.feelsF, 1) });
  }

  return {
    byYear,
    hottest: { date: hottest.date, feelsF: round(hottest.feelsF, 1) },
    worstWeek: { start: daily[0].date, end: daily[daily.length - 1].date, daily },
    regionalSlug: null,
  };
}

/** A regional grid only applies if it covers the same week as the address chart. */
export function gridMatchesWeek(grid: HeatGrid, week: HeatSummary["worstWeek"]): boolean {
  return grid.days[0] === week.start && grid.days[grid.days.length - 1] === week.end;
}

// ---------------------------------------------------------------- orchestration

export interface LookupDeps {
  fetch: FetchLike;
  loadIndex: (state: string) => Promise<StateIndex | null>;
  loadHeatGrid: (slug: string) => Promise<HeatGrid | null>;
  /** The AI damage mapper's pins for a state (data/damage). Absent: no damage pins. */
  loadDamage?: (state: string) => Promise<DamagePin[]>;
  now: () => Date;
  /** Build-time snapshots of the slow data for the sample addresses (data/samples). Absent: every lookup is live. */
  loadSnapshots?: () => Promise<SampleSnapshot[]>;
}

export const defaultDeps: LookupDeps = {
  fetch: (url, init) => fetch(url, init),
  loadIndex: loadStateIndex,
  loadHeatGrid,
  loadDamage: loadDamageRows,
  now: () => new Date(),
  loadSnapshots: loadSampleSnapshots,
};

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function coverageOf(index: StateIndex | null): Coverage {
  if (!index) return "not yet indexed";
  return index.fixture ? "fixture" : "indexed";
}

async function summarizeAddressHeat(
  address: LookupAddress,
  deps: LookupDeps,
  snapshot: SampleSnapshot | null,
): Promise<Sourced<HeatSummary>> {
  let summary: HeatSummary | null;
  if (snapshot?.heat) {
    // A sample address: the same summary, computed ahead of time from the same archive, so no 26-year request.
    const { byYear, hottest, worstWeek } = snapshot.heat;
    summary = { byYear, hottest, worstWeek, regionalSlug: null };
  } else {
    const daily = await fetchDailyFeelsLike(address.lat, address.lon, deps.fetch, deps.now);
    if (!daily.value) return { value: null, notice: daily.notice };
    summary = summarizeHeat(daily.value);
    if (!summary) return { value: null, notice: "There was not enough temperature data for this address." };
  }

  if (address.city) {
    const slug = slugify(address.city);
    const grid = slug ? await deps.loadHeatGrid(slug) : null;
    if (grid && gridMatchesWeek(grid, summary.worstWeek)) summary.regionalSlug = slug;
  }
  return { value: summary };
}

/**
 * Looks up everything we know about an address. Throws LookupError (with a
 * message safe to show) only when the address itself cannot be matched; every
 * other source degrades to null plus a notice.
 */
export async function lookupAddress(input: string, deps: LookupDeps = defaultDeps, options: { night?: string | null } = {}): Promise<LookupPayload> {
  const address = await geocodeAddress(input, deps.fetch);
  const origin: Coord = [address.lat, address.lon];
  // A sample address (within 200 m) reads its heat summary and rain history from disk; alerts, forecast and FEMA stay live.
  const snapshot = deps.loadSnapshots ? findSnapshot(address.lat, address.lon, await deps.loadSnapshots().catch(() => [])) : null;

  // The flood trigger needs the nearby flood dates, so it starts as soon as the index is read and runs beside the other calls.
  const indexRead = deps.loadIndex(address.state);
  const nearbyRead = indexRead.then((index) => (index ? findNearbyFloods(index.floods, origin) : null));
  const triggerRead = nearbyRead.then((nearby) =>
    buildFloodTrigger(address, nearby?.reports ?? [], { fetch: deps.fetch, now: deps.now, knownRain: snapshot?.rain?.byDate }),
  );
  const [index, fema, live, heat, nearby, floodTrigger] = await Promise.all([
    indexRead,
    fetchFemaZone(address.lat, address.lon, deps.fetch),
    fetchActiveAlerts(address.lat, address.lon, deps.fetch, deps.now),
    summarizeAddressHeat(address, deps, snapshot),
    nearbyRead,
    triggerRead,
  ]);

  const tornadoes = index ? findNearbyTornadoes(index.tornadoes, origin) : [];
  // The AI damage mapper's pins for those tornadoes. A missing or unreadable file just means none.
  const damageRows = index && tornadoes.length && deps.loadDamage ? await deps.loadDamage(address.state).catch(() => []) : [];

  const notices: Partial<Record<NoticeKey, string>> = {};
  if (fema.notice) notices.fema = fema.notice;
  if (live.notice) notices.live = live.notice;
  if (heat.notice) notices.heat = heat.notice;
  if (!index) {
    notices.index = `We have not indexed ${address.state || "this state"} yet, so flood reports and tornado paths are not shown.`;
  } else if (index.fixture) {
    notices.index = "This state has a small development sample, not the full record of reports.";
  }

  return {
    address,
    fema: fema.value,
    live: live.value,
    floods: nearby ?? { reports: [], tierCounts: { mentioned: 0, about1km: 0, citywide: 0 } },
    stormReplay: index ? selectReplayNight(index.floods, origin, options.night) : null,
    stormNights: index ? listStormNights(index.floods, origin) : [],
    tornadoes,
    damage: index ? damagePinsFor(damageRows, index.tornadoes, tornadoes) : [],
    heat: heat.value,
    floodTrigger,
    coverage: coverageOf(index),
    notices,
  };
}

/** Just the live alerts, for the "check again" button and the 5-minute refresh. */
export async function lookupAlerts(lat: number, lon: number, deps: LookupDeps = defaultDeps): Promise<Sourced<LiveAlerts>> {
  return fetchActiveAlerts(lat, lon, deps.fetch, deps.now);
}

const NIGHT_ID = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Another storm night for an address we already matched (the picker): no geocoding, FEMA or weather calls, only
 * the index. Returns null when the state is not indexed, nothing was reported nearby, or the night is not one of ours.
 */
export async function lookupReplay(
  state: string,
  lat: number,
  lon: number,
  night: string,
  deps: Pick<LookupDeps, "loadIndex"> = defaultDeps,
): Promise<StormReplay | null> {
  if (!NIGHT_ID.test(night)) return null;
  const index = await deps.loadIndex(state);
  if (!index) return null;
  const replay = selectReplayNight(index.floods, [lat, lon], night);
  return replay && replay.nightId === night ? replay : null;
}
