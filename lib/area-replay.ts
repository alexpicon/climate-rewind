/**
 * Every event the National Weather Service filed for an address's county and forecast zones since 2000, in a compact form for the
 * area replay: each one lights up the area it was filed for, in its hazard family's colour, on the date it happened. Zone events light
 * their own zone; county events light the zones that cover the county (the pipeline's county-to-zone crosswalk, county-areas.json),
 * since NCEI gives counties no outline here. Server only.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AREA_EVENTS_FROM_YEAR } from "./constants";
import { loadZones, selectAreaEvents, sinceYear, type ZoneShape } from "./area-events";

const AREA_CODE = /^[A-Z]{2}[CZ]\d{3}$/;
const eventsDir = () => process.env.MEMORIA_EVENTS_DIR ?? path.join(process.cwd(), "data", "events");
const round3 = (n: number) => Math.round(n * 1e3) / 1e3;
/** At most this many outlines are sent: the address's zones and the county's, which is all a replay needs. */
export const MAX_SHAPES = 24;

export interface ReplayArea {
  code: string;
  name: string;
  kind: "C" | "Z";
  tier: "county" | "your zone" | "nearby zone";
  /** The zone outlines this area lights: its own for a zone, the county's zones for a county. */
  shapes: string[];
}

export interface AreaReplay {
  source: string;
  since: number;
  /** Every distinct event type, in the order `events` refer to them. */
  types: string[];
  areas: ReplayArea[];
  /** Zone outlines by code, as MultiPolygon coordinates (lon, lat, rounded to about 100 m). */
  shapes: Record<string, number[][][][]>;
  /** One row per event, oldest first: [day since Jan 1 of `since`, type index, area index, deaths, injuries, damage in dollars]. */
  events: Array<[number, number, number, number, number, number]>;
}

/** data/events/<ST>/county-areas.json: county code to the zones that cover it. */
async function countyZones(state: string, county: string, dir: string): Promise<string[]> {
  try {
    const crosswalk = JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ dir, state, "county-areas.json"), "utf8")) as Record<string, string[]>;
    return (crosswalk[county] ?? []).filter((code) => AREA_CODE.test(code) && code[2] === "Z");
  } catch {
    return [];
  }
}

/**
 * A county as people say it, from NCEI's upper-case name and the area code's state: "KING" in WA is "King County", a Louisiana one is a
 * parish, an independent city ("BALTIMORE CITY", "ST. LOUIS (C)") stays a city, and Alaska's boroughs and census areas keep their own
 * name. A zone keeps its name.
 */
export function areaName(name: string, kind: "C" | "Z", code: string = ""): string {
  if (kind !== "C") return name;
  const city = /\(c\)\s*$/i.test(name);
  const titled = name
    .replace(/\s*\(c\)\s*$/i, "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
  if (city) return `${titled} City`;
  if (/\b(county|parish|city|borough|census area|municipality)$/i.test(titled) || code.startsWith("AK")) return titled;
  return `${titled} ${code.startsWith("LA") ? "Parish" : "County"}`;
}

const dayOf = (start: string, since: number) => Math.floor((Date.parse(start.slice(0, 10)) - Date.UTC(since, 0, 1)) / 86_400_000);

/** The replay for a point, or null when the state has no area events. */
export async function buildAreaReplay(lat: number, lon: number, state: string, county: string, dir: string = eventsDir()): Promise<AreaReplay | null> {
  if (!/^[A-Z]{2}$/.test(state) || !AREA_CODE.test(county) || !county.startsWith(state)) return null;
  const selection = await selectAreaEvents(lat, lon, state, county, dir);
  if (!selection) return null;
  const since = AREA_EVENTS_FROM_YEAR;
  const events = sinceYear(selection.events, since);
  const zones = (await loadZones(state, dir)) ?? [];
  const byCode = new Map<string, ZoneShape>(zones.map((z) => [z.code, z]));
  const coveringCounty = (await countyZones(state, county, dir)).filter((code) => byCode.get(code)?.polygons);

  const areas: ReplayArea[] = [];
  const areaIndex = new Map<string, number>();
  const areaFor = (code: string, name: string, kind: "C" | "Z", tier: ReplayArea["tier"]) => {
    const known = areaIndex.get(code);
    if (known !== undefined) return known;
    const shapes = kind === "Z" ? (byCode.get(code)?.polygons ? [code] : []) : coveringCounty;
    areaIndex.set(code, areas.length);
    areas.push({ code, name, kind, tier, shapes });
    return areas.length - 1;
  };

  const types: string[] = [];
  const typeIndex = new Map<string, number>();
  const rows: AreaReplay["events"] = [];
  for (const event of events) {
    const day = dayOf(event.start, since);
    if (!Number.isFinite(day) || day < 0) continue;
    if (!typeIndex.has(event.type)) {
      typeIndex.set(event.type, types.length);
      types.push(event.type);
    }
    const tier = event.tier ?? (event.area.kind === "C" ? "county" : "your zone");
    const area = areaFor(event.area.code, event.zoneName ?? areaName(event.area.name, event.area.kind, event.area.code), event.area.kind, tier);
    rows.push([day, typeIndex.get(event.type)!, area, event.deaths, event.injuries, event.damageUsd]);
  }

  const shapes: AreaReplay["shapes"] = {};
  for (const code of [...new Set(areas.flatMap((a) => a.shapes))].slice(0, MAX_SHAPES)) {
    const polygons = byCode.get(code)?.polygons;
    if (polygons) shapes[code] = polygons.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [round3(x), round3(y)])));
  }
  return { source: "NCEI Storm Events, filed by the National Weather Service for this county and its forecast zones", since, types, areas, shapes, events: rows };
}
