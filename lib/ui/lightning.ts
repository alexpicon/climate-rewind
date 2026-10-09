/**
 * Lightning on the storm replay: the flashes the GOES Geostationary Lightning Mapper saw during a sample night, extracted ahead of
 * time by pipeline/glm_flashes.py into public/data/lightning/. Pure helpers: which night file belongs to an address and night, and
 * which flashes show (and how faded) at a moment of the replay.
 */
import { haversineKm } from "../geo";

/** public/data/lightning/index.json */
export interface LightningIndex {
  nights: Array<{ slug: string; nightId: string; lat: number; lon: number; file: string; flashes: number }>;
}

/** One night's file. Each flash row: [seconds since startUtc, lat, lon, energy in femtojoules, area in km2]. */
export interface LightningNight {
  source: string;
  note: string;
  nightId: string;
  startUtc: string;
  endUtc: string;
  files: number;
  filesExpected: number;
  filesMissing: number;
  flashes: Array<[number, number, number, number, number]>;
}

/** A sample's file is used only for the sample's own address (within this distance) and night. */
export const LIGHTNING_RADIUS_KM = 0.2;
/** How long a flash stays on the map as it fades, in storm time: about 1.6 s on screen at 1 s per 5 minutes. */
export const FLASH_FADE_MS = 8 * 60_000;
/** At most this many flashes are drawn at once (the newest), so a dense storm never slows the replay. */
export const MAX_SHOWN = 1500;

/** The night file for this address and night, or null. */
export function lightningFileFor(index: LightningIndex, lat: number, lon: number, nightId: string | null | undefined): string | null {
  if (!nightId) return null;
  const night = index.nights.find((entry) => entry.nightId === nightId && haversineKm([lat, lon], [entry.lat, entry.lon]) <= LIGHTNING_RADIUS_KM);
  return night ? night.file : null;
}

export interface ShownFlash {
  lat: number;
  lon: number;
  energy: number;
  /** 1 at the moment of the flash, falling to 0 as it fades. */
  fresh: number;
}

/** The index of the first flash at or after `seconds` (flashes are sorted by time). */
function firstAtOrAfter(flashes: LightningNight["flashes"], seconds: number): number {
  let lo = 0;
  let hi = flashes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (flashes[mid][0] < seconds) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The flashes on the map at `nowMs` (UTC): those of the last FLASH_FADE_MS, newest last, each with how fresh it still is. */
export function flashesAt(night: LightningNight, nowMs: number): ShownFlash[] {
  const startMs = Date.parse(night.startUtc);
  const now = (nowMs - startMs) / 1000;
  const from = firstAtOrAfter(night.flashes, now - FLASH_FADE_MS / 1000);
  const to = firstAtOrAfter(night.flashes, now + 1e-9);
  const shown: ShownFlash[] = [];
  for (let i = Math.max(from, to - MAX_SHOWN); i < to; i += 1) {
    const [t, lat, lon, energy] = night.flashes[i];
    shown.push({ lat, lon, energy, fresh: Math.max(0, 1 - (now - t) / (FLASH_FADE_MS / 1000)) });
  }
  return shown;
}

/** Totals for the words beside the map: how many flashes, and how many arrived before `nowMs`. */
export function lightningCounts(night: LightningNight, nowMs: number): { total: number; soFar: number } {
  const now = (nowMs - Date.parse(night.startUtc)) / 1000;
  return { total: night.flashes.length, soFar: firstAtOrAfter(night.flashes, now + 1e-9) };
}

/** "GOES-16" from the file's source line, for the words beside the map. */
export function satelliteName(source: string): string {
  return /GOES-\d+/.exec(source)?.[0] ?? "a GOES satellite";
}
