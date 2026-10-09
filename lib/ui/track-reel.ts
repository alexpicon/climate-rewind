/**
 * The model behind the landing page's tornado reel: every real tornado track of 2015 to 2025, drawn in date order. Like every
 * animated view, the frame is a pure function of one progress value `p` (0 to 1), so pausing, reduced motion (p = 1) and tests
 * share one path. The renderer only draws what this says.
 */

/** public/data/tornado-tracks.json, as written by scripts/landing-tracks.py. */
export interface TrackFile {
  source: string;
  built: string;
  region: string;
  from: string;
  to: string;
  count: number;
  ef: string[];
  /** Six whole numbers per track: day since `from`, lat0, lon0, lat1, lon1 (x100), EF index. */
  tracks: number[];
  /** [track index, deaths] for the tracks that killed someone. */
  deaths: Array<[number, number]>;
}

export interface Track {
  day: number;
  a: [number, number];
  b: [number, number];
  ef: string;
  /** EF3 or stronger. */
  strong: boolean;
  deaths: number;
}

export interface Reel {
  tracks: Track[];
  from: string;
  /** Days from `from` to the last track, plus the time the last one takes to draw in. */
  spanDays: number;
  /** Running totals over the first i tracks: strongBefore[i] are EF3 or stronger, deathsBefore[i] people died in them. */
  strongBefore: Int32Array;
  deathsBefore: Int32Array;
}

/** How long one track takes to draw in, in days of the reel's clock (about a quarter of a second on screen). */
export const DRAW_IN_DAYS = 40;
/** How long the whole reel runs at 1x, in milliseconds: about 2.4 seconds a year. */
export const REEL_MS = 26_000;
/** How long the finished picture holds before the reel starts again. */
export const HOLD_MS = 4_000;

const STRONG = new Set(["EF3", "EF4", "EF5"]);

/** Reads the compact file into tracks, with the running totals the counters need. Rows that are not whole are skipped. */
export function decodeReel(file: TrackFile): Reel {
  const tracks: Track[] = [];
  const killed = new Map(file.deaths.map(([index, deaths]) => [index, deaths]));
  for (let i = 0; i + 5 < file.tracks.length; i += 6) {
    const [day, lat0, lon0, lat1, lon1, efIndex] = file.tracks.slice(i, i + 6);
    const ef = file.ef[efIndex];
    if (ef === undefined) continue;
    tracks.push({ day, a: [lat0 / 100, lon0 / 100], b: [lat1 / 100, lon1 / 100], ef, strong: STRONG.has(ef), deaths: killed.get(i / 6) ?? 0 });
  }
  const strongBefore = new Int32Array(tracks.length + 1);
  const deathsBefore = new Int32Array(tracks.length + 1);
  tracks.forEach((track, i) => {
    strongBefore[i + 1] = strongBefore[i] + (track.strong ? 1 : 0);
    deathsBefore[i + 1] = deathsBefore[i] + track.deaths;
  });
  const lastDay = tracks.length ? tracks[tracks.length - 1].day : 0;
  return { tracks, from: file.from, spanDays: lastDay + DRAW_IN_DAYS, strongBefore, deathsBefore };
}

/** The number of tracks whose day is at or before `day` (tracks are sorted by day). */
export function startedBy(tracks: readonly Track[], day: number): number {
  let lo = 0;
  let hi = tracks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tracks[mid].day <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface ReelFrame {
  /** The reel's clock, in days since `from`. */
  day: number;
  /** The calendar year the clock is in. */
  year: number;
  /** Tracks [0, settled) are fully drawn. */
  settled: number;
  /** Tracks [settled, started) are drawing in; `progress[k]` (0 to 1) is how far track settled + k has got. */
  started: number;
  progress: number[];
  /** Totals so far, counting every track that has started. */
  count: number;
  strong: number;
  deaths: number;
}

/** Everything the frame at progress `p` shows. */
export function reelFrame(reel: Reel, p: number): ReelFrame {
  const clamped = Math.min(1, Math.max(0, p));
  const day = clamped * reel.spanDays;
  const started = startedBy(reel.tracks, day);
  const settled = clamped >= 1 ? reel.tracks.length : startedBy(reel.tracks, day - DRAW_IN_DAYS);
  const progress: number[] = [];
  for (let i = settled; i < started; i += 1) progress.push(Math.min(1, Math.max(0, (day - reel.tracks[i].day) / DRAW_IN_DAYS)));
  const from = new Date(`${reel.from}T00:00:00Z`);
  const lastDay = reel.tracks.length ? reel.tracks[reel.tracks.length - 1].day : 0;
  const shownDay = Math.min(day, lastDay);
  const year = new Date(from.getTime() + shownDay * 86_400_000).getUTCFullYear();
  return { day, year, settled, started, progress, count: started, strong: reel.strongBefore[started], deaths: reel.deathsBefore[started] };
}
