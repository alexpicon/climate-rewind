/**
 * The record-flash replay on the landing page: ten seconds of the satellite's light groups over the storm of 29 April 2020,
 * played slowly. A pure function of progress `p` (0 to 1), like every animated view: which light is on now and how faded, the
 * storm clock, and how far east to west the light has spread so far.
 */
import { haversineKm } from "../geo";

/** public/data/lightning/record-2020-04-29.json, as written by pipeline/record_flash.py. */
export interface RecordFlashFile {
  source: string;
  note: string;
  record: { lengthKm: number; lengthMi: number; began: string; where: string; certified: string; since: string };
  startUtc: string;
  endUtc: string;
  box: [number, number, number, number];
  spanKm: number;
  /** [ms since startUtc, lat, lon, energy in femtojoules] */
  groups: Array<[number, number, number, number]>;
}

/** A light group stays lit this long in storm time (it is 2 ms; this makes it visible), fading out. */
export const GLOW_MS = 350;

export interface RecordModel {
  file: RecordFlashFile;
  durationMs: number;
  /** For each i, the westernmost and easternmost group among the first i + 1: the span so far. */
  westIdx: Int32Array;
  eastIdx: Int32Array;
}

export function buildRecordModel(file: RecordFlashFile): RecordModel {
  const groups = file.groups;
  const westIdx = new Int32Array(groups.length);
  const eastIdx = new Int32Array(groups.length);
  groups.forEach((g, i) => {
    westIdx[i] = i > 0 && groups[westIdx[i - 1]][2] <= g[2] ? westIdx[i - 1] : i;
    eastIdx[i] = i > 0 && groups[eastIdx[i - 1]][2] >= g[2] ? eastIdx[i - 1] : i;
  });
  return { file, durationMs: Date.parse(file.endUtc) - Date.parse(file.startUtc), westIdx, eastIdx };
}

/** Groups with time at or before `ms` (groups are sorted by time). */
function upTo(groups: RecordFlashFile["groups"], ms: number): number {
  let lo = 0;
  let hi = groups.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (groups[mid][0] <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface RecordFrame {
  /** Storm time, ms since startUtc. */
  ms: number;
  /** Groups [0, seen) have been seen; of those, [glowFrom, seen) are still glowing. */
  seen: number;
  glowFrom: number;
  /** East to west span of the light seen so far, km (0 before two groups). */
  spanKm: number;
  /** "14:32:41.2" UTC. */
  clock: string;
}

export function recordFrame(model: RecordModel, p: number): RecordFrame {
  const ms = Math.min(1, Math.max(0, p)) * model.durationMs;
  const groups = model.file.groups;
  const seen = upTo(groups, ms);
  const glowFrom = upTo(groups, ms - GLOW_MS);
  let spanKm = 0;
  if (seen > 1) {
    const west = groups[model.westIdx[seen - 1]];
    const east = groups[model.eastIdx[seen - 1]];
    spanKm = Math.round(haversineKm([west[1], west[2]], [east[1], east[2]]));
  }
  const clock = new Date(Date.parse(model.file.startUtc) + ms).toISOString().slice(11, 21);
  return { ms, seen, glowFrom, spanKm, clock };
}
