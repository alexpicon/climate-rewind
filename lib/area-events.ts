/**
 * "What has happened in your area": NCEI Storm Events rows for the address's county, the forecast zone it is in, and zones within
 * 15 km, every event type, since 2000. Server only.
 *
 * Layout (CONTRACT addendum, Oct 8): data/events/<ST>/<CODE>.json.gz is one file per area code (a county like WAC033 or a zone like
 * WAZ508, including zone numbers NWS has since retired) and data/events/<ST>/zones.json holds each zone's outline. The county-areas.json
 * overlap list is NOT used any more: it pulled in every zone that touched the county, so Bellevue's story led with Mount Rainier.
 * selectAreaEvents() tests the address against the outlines instead. The /points forecast zone is not used either: NWS renumbered
 * zones over time, so today's id does not match old rows.
 *
 * The pure pieces (normalizing rows, choosing zones, the severity score, the summary) are exported and tested with a fixture.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { AREA_EVENTS_FROM_YEAR, AREA_EVENTS_TOP, NEARBY_ZONE_KM } from "./constants";
import type { FetchLike } from "./http";
import { fetchAreaIds } from "./nws-zones";
import { rankBySeverity, yearOf } from "./event-severity";
import { LruCache } from "./lru";
import type { AreaEvent, AreaEventsSummary, AreaTier, AreaZoneInfo, LookupAddress } from "./types";
import { distanceToBboxKm, polygonsOf, probePolygons, type Bbox, type PolygonCoords } from "./zone-geometry";

const STATE_CODE = /^[A-Z]{2}$/;
const AREA_CODE = /^[A-Z]{2}[CZ]\d{3}$/;
const eventsDir = () => process.env.MEMORIA_EVENTS_DIR ?? path.join(process.cwd(), "data", "events");

// ---------------------------------------------------------------- reading the files

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** One row of a file as an AreaEvent, or null if it lacks what we need (an id, a start, an area). */
export function normalizeEvent(raw: unknown, episodes: Record<string, string>): AreaEvent | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const area = r.area as Record<string, unknown> | undefined;
  const id = str(r.id);
  const start = str(r.start);
  const code = str(area?.code);
  const kind = area?.kind === "Z" || area?.kind === "C" ? area.kind : null;
  if (!id || !/^\d{4}-\d{2}-\d{2}/.test(start) || !code || !kind) return null;
  const episodeId = str(r.episodeId) || null;
  return {
    id,
    episodeId,
    type: str(r.type) || "Event",
    start,
    end: str(r.end) || null,
    area: { kind, code, name: str(area?.name) },
    deaths: num(r.deaths),
    injuries: num(r.injuries),
    damageUsd: num(r.damageUsd),
    magnitude: typeof r.magnitude === "number" && Number.isFinite(r.magnitude) ? r.magnitude : null,
    magnitudeType: str(r.magnitudeType) || null,
    narrative: str(r.narrative),
    episodeNarrative: str(r.episodeNarrative) || (episodeId ? (episodes[episodeId] ?? "") : ""),
  };
}

/** The events of one area file (already gunzipped and parsed). Null if it is not an events file. */
export function parseAreaFile(parsed: unknown): AreaEvent[] | null {
  const file = parsed as { events?: unknown; episodes?: unknown } | null;
  if (!file || !Array.isArray(file.events)) return null;
  const episodes = file.episodes && typeof file.episodes === "object" ? (file.episodes as Record<string, string>) : {};
  const events: AreaEvent[] = [];
  for (const raw of file.events) {
    const event = normalizeEvent(raw, episodes);
    if (event) events.push(event);
  }
  return events;
}

const FOREVER = Number.MAX_SAFE_INTEGER;
/** Parsed area files, a few hundred at a time (an address reads its county's file and a few zones'). A missing file is just empty (and looked for again next time). */
const areaFiles = new LruCache<AreaEvent[]>(300, FOREVER);
/** Parsed zones.json files, one per state (Alaska's is 850 KB, most are 100 to 300 KB). */
const zoneFiles = new LruCache<ZoneShape[]>(60, FOREVER);

export function clearEventsCache(): void {
  areaFiles.clear();
  zoneFiles.clear();
}

/** One area's events (data/events/<ST>/<CODE>.json.gz), read once. Empty when there is no file. */
export async function loadAreaFile(state: string, areaCode: string, dir: string = eventsDir()): Promise<AreaEvent[]> {
  const st = state.toUpperCase();
  if (!STATE_CODE.test(st) || !AREA_CODE.test(areaCode)) return [];
  const key = `${dir}|${st}|${areaCode}`;
  const hit = areaFiles.get(key, 0);
  if (hit) return hit;
  try {
    const compressed = await readFile(path.join(/*turbopackIgnore: true*/ dir, st, `${areaCode}.json.gz`));
    const events = parseAreaFile(JSON.parse(gunzipSync(compressed).toString("utf8"))) ?? [];
    areaFiles.set(key, events, 0);
    return events;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- the zones: which ones are "yours" and which are "nearby"

/** A forecast zone as the zones.json file stores it, ready to test a point against. */
export interface ZoneShape {
  code: string;
  name: string;
  validFrom: string | null;
  validTo: string | null;
  bbox: Bbox;
  /** The outline. Null for an approximate zone (bounding box only): it can never be "your zone", only "nearby". */
  polygons: PolygonCoords[] | null;
}

const isBbox = (value: unknown): value is Bbox => Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number" && Number.isFinite(n));

/** The zones of a parsed zones.json ({code: {name, validFrom, validTo, bbox, polygon, approx?}}). Entries without a usable box or outline are left out. */
export function parseZones(parsed: unknown): ZoneShape[] {
  if (!parsed || typeof parsed !== "object") return [];
  const zones: ZoneShape[] = [];
  for (const [code, raw] of Object.entries(parsed as Record<string, unknown>)) {
    const z = raw as Record<string, unknown> | null;
    if (!AREA_CODE.test(code) || !z || typeof z !== "object") continue;
    const outline = z.approx === true ? null : polygonsOf(z.polygon);
    const bbox = isBbox(z.bbox) ? z.bbox : null;
    if (!bbox) continue; // a box is what keeps far zones from being measured at all
    zones.push({ code, name: str(z.name), validFrom: str(z.validFrom) || null, validTo: str(z.validTo) || null, bbox, polygons: outline });
  }
  return zones;
}

/** data/events/<ST>/zones.json parsed once. Null when the state has none. */
export async function loadZones(state: string, dir: string = eventsDir()): Promise<ZoneShape[] | null> {
  const st = state.toUpperCase();
  if (!STATE_CODE.test(st)) return null; // also keeps odd input out of the file path
  const key = `${dir}|${st}`;
  const hit = zoneFiles.get(key, 0);
  if (hit) return hit;
  try {
    const zones = parseZones(JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ dir, st, "zones.json"), "utf8")));
    // Only a file that was read is remembered: a missing one is looked for again (a failed read costs microseconds).
    zoneFiles.set(key, zones, 0);
    return zones;
  } catch {
    return null;
  }
}

export interface ChosenZone {
  code: string;
  name: string;
  tier: "your zone" | "nearby zone";
  /** 0 for your zone; else km to the zone's edge (an approximate zone: to its box). */
  distanceKm: number;
  /** When NWS stopped using this zone's outline (YYYY-MM-DD), if the file says. The newest of "your zones" is the one in force now. */
  validTo?: string | null;
}

/**
 * The zones that count for a point. "your zone": the outline contains the point. "nearby zone": the outline's edge is within `maxKm` of it.
 * An approximate zone (box only) is "nearby" if its box is within `maxKm`, even when the point is inside the box, because a box says
 * nothing sure about the zone's real edge. Everything farther is left out. Your zones come first, then nearest first.
 */
export function chooseZones(lat: number, lon: number, zones: readonly ZoneShape[], maxKm: number = NEARBY_ZONE_KM): ChosenZone[] {
  const chosen: ChosenZone[] = [];
  for (const zone of zones) {
    const boxKm = distanceToBboxKm(lat, lon, zone.bbox);
    if (boxKm > maxKm) continue; // the box is never farther than the outline inside it, so this cannot drop a near zone
    if (!zone.polygons) {
      chosen.push({ code: zone.code, name: zone.name, tier: "nearby zone", distanceKm: boxKm, validTo: zone.validTo });
      continue;
    }
    const { inside, km } = probePolygons(lat, lon, zone.polygons);
    if (inside) chosen.push({ code: zone.code, name: zone.name, tier: "your zone", distanceKm: 0, validTo: zone.validTo });
    else if (km <= maxKm) chosen.push({ code: zone.code, name: zone.name, tier: "nearby zone", distanceKm: km, validTo: zone.validTo });
  }
  return chosen.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "your zone" ? -1 : 1) || a.distanceKm - b.distanceKm || (a.code < b.code ? -1 : 1));
}

/** What the selector gives back: the chosen zones and the events of the county and those zones, each tagged. */
export interface AreaSelection {
  /** The county code, then each chosen zone's code. */
  areaCodes: string[];
  zones: ChosenZone[];
  events: AreaEvent[];
}

/**
 * Every event that belongs with a point, each tagged `{tier, zoneName}`:
 *   - the county's own rows (tier "county", zoneName null)
 *   - rows of each forecast zone whose outline contains the point (tier "your zone")
 *   - rows of each zone whose outline is within 15 km of it (tier "nearby zone"), so the screen can say whose they are
 * Zones farther away are never read. This replaces the county-overlap list, which pulled in every mountain zone that touched the county.
 * Zones come from every zone NWS has used (retired ones too, with the outlines they had), so an old row is matched by where the point
 * was, not by today's zone number. Null when the state has no events data at all. A state with no zones.json still gets its county rows.
 */
export async function selectAreaEvents(lat: number, lon: number, stateCode: string, countyCode: string, dir: string = eventsDir()): Promise<AreaSelection | null> {
  const state = stateCode.toUpperCase();
  if (!STATE_CODE.test(state) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const zones = await loadZones(state, dir);
  const countyRows = AREA_CODE.test(countyCode) ? await loadAreaFile(state, countyCode, dir) : [];
  if (!zones && countyRows.length === 0) return null; // no zones file and no county file: we have nothing for this state
  const chosen = zones ? chooseZones(lat, lon, zones) : [];
  const zoneRows = await Promise.all(chosen.map((zone) => loadAreaFile(state, zone.code, dir)));

  const seen = new Set<string>();
  const events: AreaEvent[] = [];
  const add = (rows: readonly AreaEvent[], tier: AreaTier, zoneName: string | null) => {
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      events.push({ ...row, tier, zoneName });
    }
  };
  add(countyRows, "county", null);
  // Your zones are read before the nearby ones, so an event filed in both is told as yours.
  chosen.forEach((zone, i) => add(zoneRows[i], zone.tier, zone.name));
  return { areaCodes: [countyCode, ...chosen.map((z) => z.code)], zones: chosen, events };
}

export { rankBySeverity, severityScore, topDistinctEpisodes, yearOf } from "./event-severity";

// ---------------------------------------------------------------- selecting and ranking

/** Events from `sinceYear` on, oldest first, each id once. */
export function sinceYear(events: readonly AreaEvent[], year: number = AREA_EVENTS_FROM_YEAR): AreaEvent[] {
  const seen = new Set<string>();
  return events
    .filter((event) => {
      if (yearOf(event.start) < year || seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1));
}

/** The share of the `top` list that nearby-zone events may take, so they show on the timeline (labelled) but never crowd out the address's own. */
const NEARBY_SHARE = 0.2;

/**
 * The most significant events: the address's own county and zone first, by severity, with the last fifth of the list kept for the most
 * significant nearby-zone events (or all of the room, when the address's own are few). Order within the result: own first, then nearby.
 */
export function pickTop(events: readonly AreaEvent[], top: number = AREA_EVENTS_TOP): AreaEvent[] {
  const ranked = rankBySeverity(events);
  const own = ranked.filter((e) => e.tier !== "nearby zone");
  const near = ranked.filter((e) => e.tier === "nearby zone");
  const reserve = Math.min(near.length, Math.ceil(top * NEARBY_SHARE));
  const ownCount = Math.min(own.length, top - reserve);
  return [...own.slice(0, ownCount), ...near.slice(0, Math.min(near.length, top - ownCount))];
}

export function summarizeAreaEvents(events: readonly AreaEvent[], county: string | null, areaCodes: readonly string[], source: string, top: number = AREA_EVENTS_TOP, zones: readonly ChosenZone[] = []): AreaEventsSummary {
  const counts: Record<string, number> = {};
  const byYear: Record<string, number> = {};
  const perZone: Record<string, number> = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    const year = String(yearOf(event.start));
    byYear[year] = (byYear[year] ?? 0) + 1;
    perZone[event.area.code] = (perZone[event.area.code] ?? 0) + 1;
  }
  const zoneInfo: AreaZoneInfo[] = zones.map((z) => ({ code: z.code, name: z.name, tier: z.tier, distanceKm: Math.round(z.distanceKm * 10) / 10, events: perZone[z.code] ?? 0, validTo: z.validTo ?? null }));
  return {
    county,
    countyName: county ? (events.find((e) => e.area.code === county)?.area.name ?? null) : null,
    areaCodes: [...areaCodes],
    zones: zoneInfo,
    since: AREA_EVENTS_FROM_YEAR,
    total: events.length,
    counts,
    byYear,
    top: pickTop(events, top),
    source,
  };
}

// ---------------------------------------------------------------- the lookup piece

export const AREA_EVENTS_SOURCE = "NCEI Storm Events 2000-2025 (county rows, plus the forecast zone the address is in and zones within 15 km)";

/** The address's county as an NCEI area code: state + "C" + the 3-digit FIPS from the Census match. */
export function countyCodeOf(address: Pick<LookupAddress, "state" | "countyFips">): string | null {
  return address.countyFips && /^\d{3}$/.test(address.countyFips) && STATE_CODE.test(address.state) ? `${address.state}C${address.countyFips}` : null;
}

export interface AreaEventsDeps {
  fetch: FetchLike;
  /** Events for a point and its county code (data/events), like selectAreaEvents. Null when the state has no events data. */
  loadEvents: (lat: number, lon: number, state: string, countyCode: string) => Promise<AreaSelection | null>;
  now?: () => Date;
}

/** The summary, or why there is none, in words. Never throws. */
export async function lookupAreaEvents(address: Pick<LookupAddress, "lat" | "lon" | "state" | "countyFips">, deps: AreaEventsDeps): Promise<{ value: AreaEventsSummary | null; notice?: string }> {
  // The Census says the county; api.weather.gov /points is only the fallback when it did not.
  let county = countyCodeOf(address);
  if (!county) {
    const ids = await fetchAreaIds(address.lat, address.lon, deps.fetch, deps.now).catch(() => null);
    county = ids?.county && ids.county.startsWith(address.state) ? ids.county : null;
  }
  if (!county) return { value: null, notice: "We could not tell which county this address is in, so the area's events are not shown." };
  const found = await deps.loadEvents(address.lat, address.lon, address.state, county).catch(() => null);
  if (!found) return { value: null, notice: `We do not have area events for ${address.state || "this state"} yet.` };
  const events = sinceYear(found.events);
  if (events.length === 0) return { value: null, notice: "No events are on record for this address's county or the forecast zones at and near it since 2000." };
  return { value: summarizeAreaEvents(events, county, found.areaCodes, AREA_EVENTS_SOURCE, AREA_EVENTS_TOP, found.zones) };
}
