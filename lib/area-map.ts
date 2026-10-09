/**
 * What the story and plan maps draw for a handful of records: the outlines of forecast zones (from data/events zones.json) and, for the
 * records that have a place on earth, a point. Only our two point-level record sets carry coordinates: NWS flood reports and tornado
 * tracks in the state index (their ids are the same ids the area events and the plan cite). A record filed for a whole zone or county
 * (wind, snow, heat, hail...) has no coordinate and gets no pin: that is said on the page, not guessed. A flood report filed at a city
 * placeholder is not a place either, so it gets no pin. Server only.
 */
import type { Features } from "./features";
import { loadZones as loadZoneFile, type ZoneShape } from "./area-events";
import { loadStateIndex } from "./index-store";
import { reportPoint, tierOf } from "./lookup";
import type { StateIndex } from "./types";

export const MAX_ZONES = 12;
export const MAX_IDS = 80;
const ZONE_CODE = /^[A-Z]{2}[CZ]\d{3}$/;
const RECORD_ID = /^[A-Za-z0-9-]{3,48}$/;

export interface AreaPoint {
  id: string;
  kind: "flood" | "tornado";
  lat: number;
  lon: number;
}

export interface AreaMap {
  /** Zone outlines ({kind: "zone", code, name}) and tornado tracks ({kind: "track", id}). */
  features: Features["features"];
  /** One point per record that has a place (a tornado's point is the middle of its track). */
  points: AreaPoint[];
}

export interface AreaMapDeps {
  loadIndex: (state: string) => Promise<StateIndex | null>;
  loadZones: (state: string) => Promise<ZoneShape[] | null>;
}

export const defaultAreaMapDeps: AreaMapDeps = { loadIndex: loadStateIndex, loadZones: loadZoneFile };

/** The query's state, zone codes and record ids, cleaned: anything that is not the right shape is dropped (and so never reaches a file path). */
export function parseAreaMapQuery(params: URLSearchParams): { state: string; zones: string[]; ids: string[] } | null {
  const state = (params.get("state") ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return null;
  const list = (name: string) => (params.get(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const zones = [...new Set(list("zones"))].filter((z) => ZONE_CODE.test(z) && z.startsWith(state)).slice(0, MAX_ZONES);
  const ids = [...new Set(list("ids"))].filter((id) => RECORD_ID.test(id)).slice(0, MAX_IDS);
  return { state, zones, ids };
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const roundRing = (ring: ReadonlyArray<readonly [number, number]>) => ring.map(([x, y]) => [round4(x), round4(y)]);

export async function buildAreaMap(query: { state: string; zones: readonly string[]; ids: readonly string[] }, deps: AreaMapDeps = defaultAreaMapDeps): Promise<AreaMap> {
  const features: Features["features"] = [];
  const points: AreaPoint[] = [];

  if (query.zones.length) {
    const shapes = (await deps.loadZones(query.state).catch(() => null)) ?? [];
    for (const code of query.zones) {
      const zone = shapes.find((z) => z.code === code);
      if (!zone?.polygons) continue;
      features.push({
        type: "Feature",
        properties: { kind: "zone", code, name: zone.name },
        geometry: { type: "MultiPolygon", coordinates: zone.polygons.map((polygon) => polygon.map(roundRing)) },
      });
    }
  }

  if (query.ids.length) {
    const index = await deps.loadIndex(query.state).catch(() => null);
    if (index) {
      const wanted = new Set(query.ids);
      for (const flood of index.floods) {
        if (!wanted.has(flood.id) || flood.dupOf || tierOf(flood) === "citywide") continue;
        const point = reportPoint(flood);
        if (point) points.push({ id: flood.id, kind: "flood", lat: round4(point[0]), lon: round4(point[1]) });
      }
      for (const tornado of index.tornadoes) {
        if (!wanted.has(tornado.id)) continue;
        const [a, b] = [tornado.begin, tornado.end];
        points.push({ id: tornado.id, kind: "tornado", lat: round4((a[0] + b[0]) / 2), lon: round4((a[1] + b[1]) / 2) });
        features.push({
          type: "Feature",
          properties: { kind: "track", id: tornado.id },
          geometry: { type: "LineString", coordinates: [[round4(a[1]), round4(a[0])], [round4(b[1]), round4(b[0])]] },
        });
      }
    }
  }
  return { features, points };
}
