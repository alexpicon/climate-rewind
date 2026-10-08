/**
 * Rain and reports: did heavy rain cross the spot a report was filed from, in the hour before it?
 * Computed from the radar frames already on the map (no extra request): read the picture's colour at the report's point
 * (and about 1 km around it, because NWS points are rounded) in every frame of the prior 60 minutes.
 * If the picture does not show heavy rain there, the answer is null and the app says nothing.
 */
import type { Coord } from "../types";

/** Just what we need from a canvas ImageData, so tests can pass plain objects. */
export interface PixelFrame {
  width: number;
  height: number;
  /** RGBA, row by row. */
  data: ArrayLike<number>;
}

/** NEXRAD reflectivity in dBZ, as IEM's n0q colour table draws it (every 2 dBZ from 10 to 74). Used to turn a pixel back into a number. */
const PALETTE: ReadonlyArray<readonly [dbz: number, r: number, g: number, b: number]> = [
  [10, 67, 97, 162], [12, 77, 125, 178], [14, 89, 159, 199], [16, 98, 187, 216], [18, 111, 214, 232],
  [20, 75, 214, 144], [22, 17, 213, 24], [24, 16, 196, 22], [26, 14, 175, 19], [28, 13, 158, 17], [30, 11, 136, 15],
  [32, 10, 119, 13], [34, 8, 102, 11], [36, 70, 125, 8], [38, 152, 168, 6], [40, 234, 210, 4], [42, 255, 206, 0],
  [44, 255, 187, 0], [46, 255, 167, 0], [48, 255, 143, 0], [50, 255, 0, 0], [52, 227, 0, 0], [54, 191, 0, 0],
  [56, 163, 0, 0], [58, 127, 0, 0], [60, 255, 245, 255], [62, 255, 201, 255], [64, 255, 146, 255], [66, 246, 86, 247],
  [68, 234, 43, 236], [70, 172, 0, 252], [72, 136, 0, 234], [74, 105, 0, 219],
];

/**
 * 38 dBZ is about 8 mm (0.3 in) of rain an hour: the usual line for "heavy" rain.
 * 50 dBZ is about 50 mm (2 in) an hour. (Marshall-Palmer style Z-R, so a rough rate, not a gauge.)
 */
export const HEAVY_DBZ = 38;
export const VERY_HEAVY_DBZ = 50;
/** How far back from the report to look, and how far around its point. */
export const LOOKBACK_MINUTES = 60;
export const POINT_RADIUS_KM = 1;

/** Reflectivity for one radar pixel, or null when the pixel is clear, see-through or too weak to be rain. */
export function dbzOfPixel(r: number, g: number, b: number, a: number): number | null {
  if (a < 128) return null;
  let best = Infinity;
  let dbz = 0;
  for (const [value, pr, pg, pb] of PALETTE) {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < best) {
      best = d;
      dbz = value;
    }
  }
  // A colour that is nowhere near the table is not a radar value (an edge pixel, for instance).
  return best > 60 * 60 ? null : dbz;
}

const EARTH_RADIUS_M = 6378137;
const mercX = (lon: number) => (EARTH_RADIUS_M * lon * Math.PI) / 180;
const mercY = (lat: number) => EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** The pixel of a radar image (Web Mercator box `bounds` = [west, south, east, north]) that lies over a point. Fractional. */
export function pixelOf(bounds: [number, number, number, number], width: number, height: number, at: Coord): { x: number; y: number } {
  const [west, south, east, north] = bounds;
  const x0 = mercX(west);
  const x1 = mercX(east);
  const y0 = mercY(south);
  const y1 = mercY(north);
  return { x: ((mercX(at[1]) - x0) / (x1 - x0)) * width, y: ((y1 - mercY(at[0])) / (y1 - y0)) * height };
}

/** The strongest reflectivity in a frame within `radiusKm` of a point, or null (no rain there, or the point is off the picture). */
export function peakNear(frame: PixelFrame, bounds: [number, number, number, number], at: Coord, radiusKm = POINT_RADIUS_KM): number | null {
  const { x, y } = pixelOf(bounds, frame.width, frame.height, at);
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return null;
  const kmWide = (bounds[2] - bounds[0]) * 111.32 * Math.cos((at[0] * Math.PI) / 180);
  const radius = Math.max(1, Math.round((radiusKm * frame.width) / kmWide));
  let peak: number | null = null;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const px = Math.floor(x) + dx;
      const py = Math.floor(y) + dy;
      if (px < 0 || py < 0 || px >= frame.width || py >= frame.height) continue;
      const i = (py * frame.width + px) * 4;
      const dbz = dbzOfPixel(frame.data[i], frame.data[i + 1], frame.data[i + 2], frame.data[i + 3]);
      if (dbz !== null && (peak === null || dbz > peak)) peak = dbz;
    }
  }
  return peak;
}

export type RainLevel = "heavy" | "very heavy";

export interface RainLink {
  level: RainLevel;
  /** Strongest reflectivity seen at the spot in the hour before the report. */
  peakDbz: number;
  /** Minutes between the last frame that showed heavy rain there and the report. 0 means it was over the spot as the report came in. */
  minutesBefore: number;
  /** How many radar frames were read (of the ones in the hour that had loaded). */
  framesRead: number;
}

export interface RainLinkInput {
  /** Where the report was filed from, [lat, lon]. Only call this for a real point, never a city-point placeholder. */
  at: Coord;
  /** When it was filed, ms since epoch. */
  ms: number;
  bounds: [number, number, number, number];
  frameTimesMs: number[];
  /** The pixels of frame i, or null when that frame has not loaded (or was skipped). */
  frame: (index: number) => PixelFrame | null;
}

/**
 * Did heavy rain pass over this report's point in the prior 60 minutes? Returns null unless a loaded frame actually shows it.
 * Frames that are missing only mean less to read; they never produce a claim.
 */
export function rainBeforeReport(input: RainLinkInput): RainLink | null {
  const { at, ms, bounds, frameTimesMs, frame } = input;
  let peak: number | null = null;
  let lastHeavyMs: number | null = null;
  let read = 0;
  for (let i = 0; i < frameTimesMs.length; i += 1) {
    const t = frameTimesMs[i];
    if (t > ms || t < ms - LOOKBACK_MINUTES * 60_000) continue;
    const pixels = frame(i);
    if (!pixels) continue;
    read += 1;
    const dbz = peakNear(pixels, bounds, at);
    if (dbz === null) continue;
    if (peak === null || dbz > peak) peak = dbz;
    if (dbz >= HEAVY_DBZ && (lastHeavyMs === null || t > lastHeavyMs)) lastHeavyMs = t;
  }
  if (peak === null || peak < HEAVY_DBZ || lastHeavyMs === null) return null;
  return {
    level: peak >= VERY_HEAVY_DBZ ? "very heavy" : "heavy",
    peakDbz: peak,
    minutesBefore: Math.max(0, Math.round((ms - lastHeavyMs) / 60_000)),
    framesRead: read,
  };
}

/** The sentence under a report that pops in, and the line of detail under it. */
export function rainNoteText(link: RainLink): { text: string; detail: string } {
  const text = link.minutesBefore <= 5 ? `Filed while ${link.level} rain was over this spot` : `Filed after ${link.level} rain crossed this spot`;
  const detail =
    link.minutesBefore <= 5
      ? "Radar over this point, within about 1 km"
      : `Radar showed it about ${Math.round(link.minutesBefore / 5) * 5} min earlier, within about 1 km`;
  return { text, detail };
}
