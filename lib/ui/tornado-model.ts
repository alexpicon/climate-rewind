/** Pure helpers for the tornado view: colours, the draw-on timeline and the damage swath polygon. */
import { clamp, smooth } from "./anim";
import { excerpt } from "./text";
import type { Coord, DamagePin, NearbyTornado, TornadoRow } from "../types";

export type Rating = "EF0" | "EF1" | "EF2" | "EF3" | "EF4" | "EF5";

/** "F1" and "EF1" are the same rung; unknown or missing ratings count as 0. */
export function ratingNumber(ef: string): number {
  const m = /(\d)/.exec(ef);
  return m ? Number(m[1]) : 0;
}

export const isStrong = (ef: string) => ratingNumber(ef) >= 2;
export const isBig = (ef: string) => ratingNumber(ef) >= 3;

const COLORS = ["#C7D6FF", "#8FB0FF", "#B58CFF", "#FF4FA3", "#FF4FA3", "#FF4FA3"];
const WIDTHS = [2.8, 3.2, 4, 5, 5, 5];
const VORTEX_SCALE = [0.64, 0.8, 1.02, 1.3, 1.3, 1.3];

export const efColor = (ef: string) => COLORS[Math.min(5, ratingNumber(ef))];
export const efLineWidth = (ef: string) => WIDTHS[Math.min(5, ratingNumber(ef))];
export const efVortexScale = (ef: string) => VORTEX_SCALE[Math.min(5, ratingNumber(ef))];

/**
 * Deaths and injuries exactly as the index row has them, e.g. ["2 deaths", "170 injured"]. Nothing
 * is added or rounded; a count of 0 is left out. The index row is one county's part of a track.
 */
export function casualtyParts(t: Pick<TornadoRow, "deaths" | "injuries">): string[] {
  const parts: string[] = [];
  if (t.deaths > 0) parts.push(`${t.deaths} ${t.deaths === 1 ? "death" : "deaths"}`);
  if (t.injuries > 0) parts.push(`${t.injuries} injured`);
  return parts;
}

export interface TimedTornado {
  tornado: NearbyTornado;
  /** When the track starts drawing, ms from the start of the animation. */
  startMs: number;
  /** How long it takes to draw. */
  drawMs: number;
  /** How long the NWS card stays up before the next one. */
  holdMs: number;
  /** 0 to 1: how far along the track the address's closest point is. */
  closestFraction: number;
}

export interface TornadoTimeline {
  items: TimedTornado[];
  /** End of the last hold; the finale runs after this. */
  tracksMs: number;
  finaleMs: number;
  totalMs: number;
}

const LEAD_MS = 700;
export const FINALE_MS = 5200;

/** Tornadoes are shown one at a time in date order; big ones draw slower and stay on screen longer. */
export function buildTimeline(tornadoes: NearbyTornado[]): TornadoTimeline {
  const ordered = [...tornadoes].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  let cursor = LEAD_MS;
  const items = ordered.map((tornado) => {
    const big = isBig(tornado.ef);
    const quoteLength = excerpt(tornado.narrative).text.length || 60;
    const drawMs = big ? 5600 : clamp(1800 + tornado.lengthMi * 120, 1800, 3000);
    const holdMs = big ? 8600 : isStrong(tornado.ef) ? 5600 : clamp(900 + quoteLength * 9, 1900, 3300);
    const item: TimedTornado = { tornado, startMs: cursor, drawMs, holdMs, closestFraction: closestFraction(tornado) };
    cursor += drawMs + holdMs;
    return item;
  });
  return { items, tracksMs: cursor, finaleMs: FINALE_MS, totalMs: cursor + FINALE_MS };
}

/** Where along the track (0 at touchdown, 1 at lift-off) the address's closest point sits. */
function closestFraction(t: NearbyTornado): number {
  const span = Math.hypot(t.end[0] - t.begin[0], t.end[1] - t.begin[1]);
  if (span === 0) return 0.5;
  return clamp(Math.hypot(t.closest[0] - t.begin[0], t.closest[1] - t.begin[1]) / span);
}

/**
 * The tornado whose NWS notes belong on the card at animation time `ms`: the one the map is drawing right now (the card
 * switches the moment its track starts), staying on it through its hold until the next track starts. In the finale it is the
 * closest one, the one the map zooms to. Before the first track starts there is none.
 */
export function cardTornado(timeline: TornadoTimeline, ms: number): NearbyTornado | null {
  if (ms >= timeline.tracksMs) return closestTornado(timeline.items.map((i) => i.tornado));
  let shown: NearbyTornado | null = null;
  for (const item of timeline.items) if (ms >= item.startMs) shown = item.tornado;
  return shown;
}

/** The closest tornado to the address; the earliest wins a tie. */
export function closestTornado(tornadoes: NearbyTornado[]): NearbyTornado | null {
  return tornadoes.reduce<NearbyTornado | null>((best, t) => (best === null || t.minDistanceKm < best.minDistanceKm ? t : best), null);
}

/** The strongest and then longest tornado, used for the call-out label. */
export function strongestTornado(tornadoes: NearbyTornado[]): NearbyTornado | null {
  return tornadoes.reduce<NearbyTornado | null>((best, t) => {
    if (best === null) return t;
    const better = ratingNumber(t.ef) > ratingNumber(best.ef) || (ratingNumber(t.ef) === ratingNumber(best.ef) && t.lengthMi > best.lengthMi);
    return better ? t : best;
  }, null);
}

const YARD = 0.9144;

/**
 * The damage swath as a polygon in real metres. It starts narrow at touchdown and grows to the
 * NWS-recorded maximum width as the tornado travels. Its shape between the two ends is a drawing choice.
 * `progress` is how far along the track it has been drawn (0 to 1). Returns [lon, lat] pairs.
 */
export function swathPolygon(t: Pick<NearbyTornado, "begin" | "end" | "widthYd">, progress: number): Array<[number, number]> {
  const half = Math.max(14, t.widthYd * YARD) / 2;
  const [lat0, lon0] = t.begin;
  const dLat = t.end[0] - t.begin[0];
  const dLon = t.end[1] - t.begin[1];
  const metersPerLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const metersPerLat = 110570;
  const dx = dLon * metersPerLon;
  const dy = dLat * metersPerLat;
  const length = Math.hypot(dx, dy);

  if (length < 1) {
    // A touchdown with no length: a small circle.
    const radius = half * (0.3 + 0.7 * progress);
    return Array.from({ length: 25 }, (_, k) => {
      const angle = (k / 24) * 2 * Math.PI;
      return [lon0 + (radius * Math.cos(angle)) / metersPerLon, lat0 + (radius * Math.sin(angle)) / metersPerLat] as [number, number];
    });
  }

  const nx = -dy / length;
  const ny = dx / length;
  const steps = Math.max(6, Math.ceil(progress * 30));
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  for (let k = 0; k <= steps; k += 1) {
    const s = (progress * k) / steps;
    const width = half * (0.12 + 0.88 * smooth(0, 0.6, s));
    const lon = lon0 + dLon * s;
    const lat = lat0 + dLat * s;
    left.push([lon + (nx * width) / metersPerLon, lat + (ny * width) / metersPerLat]);
    right.push([lon - (nx * width) / metersPerLon, lat - (ny * width) / metersPerLat]);
  }
  return [...left, ...right.reverse(), left[0]];
}

/** Points of a circle of `km` around a [lat, lon] point, as [lon, lat]. */
export function circlePoints(center: Coord, km: number, n = 90): Array<[number, number]> {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return [center[1] + (km * Math.cos(a)) / (111.32 * Math.cos((center[0] * Math.PI) / 180)), center[0] + (km * Math.sin(a)) / 110.57] as [number, number];
  });
}

// ---------------------------------------------------------------- AI-mapped damage places

/** The small label every damage pin carries, on the map, in the card and in the text version. */
export const DAMAGE_LABEL = "AI-mapped from the NWS survey";

/** How the pin's position was found, in plain words. A street pin is not a spot the survey states, and says so. */
export function damageWhere(matchType: string | null): string {
  switch (matchType) {
    case "street":
      return "pinned where the street meets the track (the exact spot is not stated)";
    case "intersection":
      return "intersection match";
    case "address":
      return "address match";
    case "landmark":
      return "landmark match";
    case "named_area":
      return "centre of the named area";
    default:
      return "place match";
  }
}

/** One pin read aloud or hovered: the place, the survey's own words, and where the AI put it. */
export function damageLabel(pin: Pick<DamagePin, "place" | "phrase" | "matchType">): string {
  return `Damage place: ${pin.place}. The NWS survey says: \u201C${pin.phrase}\u201D. ${DAMAGE_LABEL}; ${damageWhere(pin.matchType)}.`;
}

/** The pins that go with one tornado, in the order the survey reads. */
export const pinsOf = (pins: readonly DamagePin[] | undefined, tornadoId: string): DamagePin[] => (pins ?? []).filter((p) => p.tornadoId === tornadoId);
