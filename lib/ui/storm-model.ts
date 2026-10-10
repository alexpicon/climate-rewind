/**
 * Turns the API's stormReplay into what the storm view draws: radar frame times, report
 * dots, and the "city point" reports that the correction step re-files.
 */
import { haversineKm } from "../geo";
import { REPLAY_NIGHT_RADIUS_KM } from "../constants";
import type { Coord, FloodRow, LookupAddress, NearbyFlood, StormReplay } from "../types";
import { resolvePlacement, type Placement } from "./placements";
import { offsetMinutes } from "./text";
import { zoneAbbreviation } from "./zone";

/** One storm-second per radar frame at 1x: 5 minutes of storm per second. */
export const MS_PER_FRAME = 1000;
/** The correction step runs 40 s at 1x. */
export const CORRECTION_MS = 40_000;
/** At most this many city-point reports are walked through one by one. */
export const MAX_CORRECTIONS = 6;

export interface ReplayReport {
  id: string;
  ms: number;
  /** Where the NWS filed it. */
  at: Coord;
  row: FloodRow;
}

export interface Correction {
  /** 1-based number on the pin and the paper note. */
  number: number;
  report: ReplayReport;
  placement: Placement;
  /** Distance from the address to the new spot, if it was placed. */
  km: number | null;
}

/**
 * What the correction step can honestly show:
 * - "ran": every report pinned to the city point has a real detective result
 * - "sample": the Nashville prototype placements, every one tagged SAMPLE
 * - "not-run": no results for this area yet; the step shows the filed points and moves nothing
 * - "nothing-to-move": the detective has run here, but no group of reports was pinned to one city point
 */
export type DetectiveState = "ran" | "sample" | "not-run" | "nothing-to-move";

export interface StormModel {
  startMs: number;
  endMs: number;
  frameCount: number;
  /** UTC time of every radar frame, like 2021-03-28T04:00:00Z. */
  frameTimes: string[];
  /** Minutes east of UTC where the storm happened, from the reports' own timestamps. */
  offsetMin: number;
  /** Local zone abbreviation for the storm night, e.g. "CDT". */
  zone: string;
  reports: ReplayReport[];
  /** Reports the NWS pinned to a city point near the address, in time order. */
  corrections: Correction[];
  /** True when every city-point report has a placement (detective result or labelled sample). */
  canCorrect: boolean;
  detective: DetectiveState;
  /** Reports within 5 km of the address as the NWS filed them, with their precision tier (for the "not run" view). */
  filed: NearbyFlood[];
  cityPoint: Coord | null;
  cityPointKm: number | null;
  bounds: [number, number, number, number];
}

/**
 * "Pinned to one city point" means several reports filed at exactly the same coordinate.
 * Of the placeholder reports near the address, take the biggest such group (nearest wins a tie).
 * A lone placeholder is just a dot, not a correction story.
 */
export function pickCityPointGroup(placeholders: ReplayReport[], origin: Coord): ReplayReport[] {
  const groups = new Map<string, ReplayReport[]>();
  for (const report of placeholders) {
    const key = `${report.at[0]},${report.at[1]}`;
    groups.set(key, [...(groups.get(key) ?? []), report]);
  }
  let best: ReplayReport[] = [];
  for (const group of groups.values()) {
    const closer = best.length > 0 && haversineKm(origin, group[0].at) < haversineKm(origin, best[0].at);
    if (group.length > best.length || (group.length === best.length && closer)) best = group;
  }
  return best.length >= 2 ? best : [];
}

const isoSeconds = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`;

export function buildStormModel(
  replay: StormReplay,
  address: Pick<LookupAddress, "lat" | "lon"> & Partial<Pick<LookupAddress, "state">>,
  nearby: NearbyFlood[] = [],
): StormModel {
  const origin: Coord = [address.lat, address.lon];
  const stepMs = replay.frameMinutes * 60_000;
  const startMs = Date.parse(replay.startUtc);
  const endMs = Date.parse(replay.endUtc);
  const frameCount = Math.round((endMs - startMs) / stepMs) + 1;

  const reports: ReplayReport[] = replay.reports
    .filter((row): row is FloodRow & { filed: Coord } => row.filed !== null)
    .map((row) => ({ id: row.id, ms: Date.parse(row.start), at: row.filed, row }))
    .sort((a, b) => a.ms - b.ms);

  const cityPointReports = pickCityPointGroup(
    reports.filter((r) => new Set(replay.reportIds).has(r.id) && r.row.coordPrecision === "placeholder" && haversineKm(origin, r.at) <= REPLAY_NIGHT_RADIUS_KM),
    origin,
  ).slice(0, MAX_CORRECTIONS);

  const resolved = cityPointReports.map((report) => ({ report, placement: resolvePlacement(report.row) }));
  const canCorrect = resolved.length > 0 && resolved.every((entry) => entry.placement !== null);

  const corrections: Correction[] = canCorrect
    ? resolved.map(({ report, placement }, i) => ({
        number: i + 1,
        report,
        placement: placement as Placement,
        km: placement?.dest ? haversineKm(origin, placement.dest) : null,
      }))
    : [];

  const cityPoint = cityPointReports[0]?.at ?? null;
  const detectiveRan = [...replay.reports, ...nearby].some((row) => row.detective !== null);
  const detective: DetectiveState = canCorrect
    ? corrections.some((c) => c.placement.status === "sample")
      ? "sample"
      : "ran"
    : cityPointReports.length === 0 && detectiveRan
      ? "nothing-to-move"
      : "not-run";
  const offsetMin = reports.length ? offsetMinutes(reports[0].row.start) : 0;

  return {
    startMs,
    endMs,
    frameCount,
    frameTimes: Array.from({ length: frameCount }, (_, i) => isoSeconds(startMs + i * stepMs)),
    offsetMin,
    zone: zoneAbbreviation(reports.length ? reports[0].ms : startMs, offsetMin, address.state),
    reports,
    corrections,
    canCorrect,
    detective,
    filed: nearby.filter((r) => r.filed !== null || r.placed !== null),
    cityPoint,
    cityPointKm: cityPoint ? haversineKm(origin, cityPoint) : null,
    bounds: replay.bounds,
  };
}

/** Reports that have been filed by storm time `nowMs`. */
export function reportsSoFar(model: StormModel, nowMs: number): number {
  let n = 0;
  for (const r of model.reports) if (r.ms <= nowMs) n += 1;
  return n;
}

/** How precisely the NWS placed a report, in plain words (CONTRACT tiers). */
export const TIER_LABEL = {
  mentioned: "Placed from the words in the report",
  about1km: "Filed at a point (about 1 km)",
  citywide: "Filed at a city point only",
} as const;

export interface Tally {
  verified: number;
  sample: number;
  unknown: number;
}

export function tallyCorrections(corrections: Correction[]): Tally {
  const tally: Tally = { verified: 0, sample: 0, unknown: 0 };
  for (const { placement } of corrections) {
    if (placement.status === "unknown") tally.unknown += 1;
    else if (placement.status === "sample") tally.sample += 1;
    else tally.verified += 1; // "verified" and "area" are real detective results
  }
  return tally;
}

// ---------------------------------------------------------------- correction timeline

/** The correction step: first a camera move, then one equal slot per report (card, line, move, settle). */
export const CAMERA_SHARE = 0.07;

export function correctionSlot(index: number, count: number): { start: number; length: number } {
  const length = (1 - CAMERA_SHARE) / count;
  return { start: CAMERA_SHARE + index * length, length };
}

export type CardPhase = "in" | "read" | "line" | "move" | "done";

export interface CurrentCorrection {
  index: number;
  /** Progress inside this report's slot, 0 to 1. */
  u: number;
  phase: CardPhase;
}

/** Which report the correction is on at progress p, or null while the camera moves and after the last one. */
export function currentCorrection(p: number, count: number): CurrentCorrection | null {
  if (count === 0 || p < CAMERA_SHARE || p >= 0.995) return null;
  const index = Math.min(count - 1, Math.floor((p - CAMERA_SHARE) / ((1 - CAMERA_SHARE) / count)));
  const { start, length } = correctionSlot(index, count);
  const u = Math.min(1, Math.max(0, (p - start) / length));
  const phase: CardPhase = u < 0.08 ? "in" : u < 0.3 ? "read" : u < 0.52 ? "line" : u < 0.92 ? "move" : "done";
  return { index, u, phase };
}

/** How far a pin has travelled, 0 to 1, given its slot progress. Pins move during the last half of their slot. */
export const moveProgress = (u: number) => Math.min(1, Math.max(0, (u - 0.52) / 0.4));

/** Width of the replay map, east to west through its middle, to the nearest 10 km. */
export function mapWidthKm(bounds: [number, number, number, number]): number {
  const [west, south, east, north] = bounds;
  const mid = (south + north) / 2;
  return Math.max(10, Math.round(haversineKm([mid, west], [mid, east]) / 10) * 10);
}

/** The one wording for the two report counts, used by the panel, the night picker's hint and the text version. */
export function replayCountsText(near: number, total: number, bounds: [number, number, number, number]): string {
  const noun = (n: number) => (n === 1 ? "flood report" : "flood reports");
  return `${near} ${noun(near)} within 15 km of your address · ${total} across this map (about ${mapWidthKm(bounds)} km wide)`;
}
