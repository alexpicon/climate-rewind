/**
 * The radar's rotation flags (tornado vortex signatures) for each tornado on the tornado replay. Pure helpers: the box and time
 * window to ask for around one tornado, which tornadoes to ask for, and which flags are on the map at a moment of the reel.
 */
import { segmentDistance } from "../geo";
import type { VortexSignature } from "../radar-signatures";
import type { NearbyTornado } from "../types";
import { ratingNumber, type TimedTornado, type TornadoTimeline } from "./tornado-model";

/** The box asked for around a track is grown by this much (degrees, about 11 km); NEAR_TRACK_KM then keeps only flags near the path. */
export const TRACK_PAD_DEG = 0.1;
/**
 * A rotation flag counts for a tornado only within this distance of its path, which allows for where the radar places the rotation
 * aloft. Wider, a box picked up other storms' flags (Nashville's EF3: flags up to 22 km off the path with a 25 km box).
 */
export const NEAR_TRACK_KM = 8;
/** Ask from this long before touchdown, so the rotation that came first is seen too. */
export const BEFORE_MS = 20 * 60_000;
/** At most this many tornadoes are asked about (the strongest), which keeps one view inside the route's rate limit. */
export const MAX_TORNADOES = 12;

/** About 30 mph of forward speed: two minutes a mile, at least 20 minutes, for how long a tornado may have been on the ground. */
export function groundMs(lengthMi: number): number {
  return Math.max(20, lengthMi * 2) * 60_000;
}

export interface TornadoWindow {
  id: string;
  bounds: [number, number, number, number];
  startMs: number;
  endMs: number;
}

/** The box and window to ask the radar flags for, for one tornado. */
export function windowFor(tornado: NearbyTornado): TornadoWindow {
  const lats = [tornado.begin[0], tornado.end[0]];
  const lons = [tornado.begin[1], tornado.end[1]];
  const touchdown = Date.parse(tornado.start);
  return {
    id: tornado.id,
    bounds: [Math.min(...lons) - TRACK_PAD_DEG, Math.min(...lats) - TRACK_PAD_DEG, Math.max(...lons) + TRACK_PAD_DEG, Math.max(...lats) + TRACK_PAD_DEG],
    startMs: touchdown - BEFORE_MS,
    endMs: touchdown + groundMs(tornado.lengthMi),
  };
}

/** The flags within NEAR_TRACK_KM of a tornado's path (its NWS begin and end points). */
export function nearTrack(flags: readonly VortexSignature[], tornado: Pick<NearbyTornado, "begin" | "end">): VortexSignature[] {
  return flags.filter((flag) => segmentDistance([flag.lat, flag.lon], tornado.begin, tornado.end).km <= NEAR_TRACK_KM);
}

/** The tornadoes to ask about: the strongest first, then the closest, at most MAX_TORNADOES. */
export function tornadoesToAsk(tornadoes: readonly NearbyTornado[]): NearbyTornado[] {
  return [...tornadoes].sort((a, b) => ratingNumber(b.ef) - ratingNumber(a.ef) || a.minDistanceKm - b.minDistanceKm).slice(0, MAX_TORNADOES);
}

/**
 * The flags on the map at reel time `ms`: those of the tornado being drawn, revealed in time order as its track draws (from 20 minutes
 * before touchdown to the end of its time on the ground), then fading out over its hold.
 */
export function flagsAt(timeline: TornadoTimeline, byId: ReadonlyMap<string, readonly VortexSignature[]>, ms: number): Array<{ flag: VortexSignature; fresh: number }> {
  const item = timeline.items.find((i: TimedTornado) => ms >= i.startMs && ms < i.startMs + i.drawMs + i.holdMs);
  const flags = item ? byId.get(item.tornado.id) : undefined;
  if (!item || !flags?.length) return [];
  const window = windowFor(item.tornado);
  const drawn = Math.min(1, (ms - item.startMs) / item.drawMs);
  const holding = ms - item.startMs - item.drawMs;
  const fade = holding > 0 ? Math.max(0, 1 - holding / item.holdMs) : 1;
  return flags
    .filter((flag) => (flag.t - window.startMs) / (window.endMs - window.startMs) <= drawn)
    .map((flag) => ({ flag, fresh: fade }));
}
