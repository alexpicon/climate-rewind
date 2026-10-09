/**
 * The radar's own flags on the storm replay (hail detections and tornado vortex signatures, lib/radar-signatures.ts): which are on
 * the map at a moment of the replay and how faded, and the totals beside it. Pure; the map layer only draws what this says.
 */
import type { HailSignature, RadarSignatures, VortexSignature } from "../radar-signatures";

/** A radar scan repeats every 4 to 6 minutes: a flag stays on the map this long in storm time, so a moving cell leaves a short trail. */
export const SIGNATURE_FADE_MS = 15 * 60_000;

export interface Shown<T> {
  item: T;
  /** 1 at the scan, falling to 0 as it fades. */
  fresh: number;
}

function shownAt<T extends { t: number }>(items: readonly T[], nowMs: number): Array<Shown<T>> {
  const out: Array<Shown<T>> = [];
  for (const item of items) {
    if (item.t > nowMs) break;
    const age = nowMs - item.t;
    if (age <= SIGNATURE_FADE_MS) out.push({ item, fresh: 1 - age / SIGNATURE_FADE_MS });
  }
  return out;
}

/** The hail detections and vortex signatures on the map at `nowMs` (items are sorted by time). */
export function signaturesAt(signatures: RadarSignatures, nowMs: number): { hail: Array<Shown<HailSignature>>; vortex: Array<Shown<VortexSignature>> } {
  return { hail: shownAt(signatures.hail, nowMs), vortex: shownAt(signatures.vortex, nowMs) };
}

/** Totals so far, for the words beside the map. */
export function signatureCounts(signatures: RadarSignatures, nowMs: number): { hail: number; largestIn: number; vortex: number } {
  let hail = 0;
  let largestIn = 0;
  for (const h of signatures.hail) {
    if (h.t > nowMs) break;
    hail += 1;
    largestIn = Math.max(largestIn, h.maxIn);
  }
  let vortex = 0;
  for (const v of signatures.vortex) {
    if (v.t > nowMs) break;
    vortex += 1;
  }
  return { hail, largestIn, vortex };
}

/** "1.75 in" or "under 1 in" for the algorithm's largest-hail estimate (it reports in quarter inches, and 0 for small hail). */
export function hailSize(inches: number): string {
  return inches >= 1 ? `${inches} in` : inches > 0 ? `${inches} in (small)` : "small";
}
