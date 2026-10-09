/**
 * The landing page's event replays (Hurricane Ian, the Iowa derecho, Hurricane Helene): public/data/events/<id>.json, written by
 * pipeline/event_package.py. A pure function of storm time, like every animated view: the model's wind anywhere in the box at any
 * moment (bilinear in space, linear between the hourly fields), where the hurricane was and how far its winds reached, and which
 * storm reports have come in so far.
 */
import { clamp, lerp } from "./anim";

export interface EventTrackPoint {
  t: string;
  lat: number;
  lon: number;
  windKt: number;
  pressureMb: number;
  /** HURDAT2 status: HU, TS, TD, EX ... */
  status: string;
  landfall: boolean;
  /** Wind radii in nautical miles, NE SE SW NW; 0 where none. */
  r34: number[];
  r50: number[];
  r64: number[];
}

export interface EventReport {
  t: string;
  lat: number;
  lon: number;
  /** The NWS type, verbatim: "TSTM WND GST", "TORNADO", "STORM SURGE" ... */
  type: string;
  mag: number | null;
  unit: string;
  /** A measured value (an instrument), not an estimate. */
  measured: boolean;
  city: string;
  state: string;
  remark: string;
}

export interface EventPackage {
  id: string;
  title: string;
  startUtc: string;
  endUtc: string;
  /** south, north, west, east */
  box: [number, number, number, number];
  built: string;
  wind: {
    source: string;
    step: number;
    south: number;
    west: number;
    rows: number;
    cols: number;
    hours: string[];
    /** [hour][point], points row by row from the south-west: mph, degrees the wind blows from, mph. */
    speed: number[][];
    dir: number[][];
    gust: number[][];
  };
  track: EventTrackPoint[] | null;
  trackSource: string | null;
  reports: EventReport[];
  reportsSource: string;
}

export type ReportKind = "gust" | "wind" | "tornado" | "flood" | "surge" | "hail" | "other";

export interface ModelReport extends EventReport {
  ms: number;
  kind: ReportKind;
  /** A wind gust in mph, or null. */
  gustMph: number | null;
}

export interface EventModel {
  pkg: EventPackage;
  startMs: number;
  endMs: number;
  hourMs: number[];
  rows: number;
  cols: number;
  /** Per hour, per point: the unit vector the wind blows toward, on screen (x east, y south), and the speeds. */
  ux: Float32Array[];
  uy: Float32Array[];
  speed: Float32Array[];
  gust: Float32Array[];
  /** Per hour: the strongest point, sustained and gust. */
  hourPeak: Array<{ speed: number; gust: number; lat: number; lon: number }>;
  track: Array<EventTrackPoint & { ms: number }>;
  reports: ModelReport[];
  /** For each i, the index of the highest gust among reports [0, i], or -1. */
  topGustIdx: Int32Array;
}

export const KT_TO_MPH = 1.15078;
export const NM_TO_M = 1852;
const HOUR = 3_600_000;

export function reportKind(type: string): ReportKind {
  const t = type.toUpperCase();
  if (t.includes("TORNADO") || t.includes("FUNNEL")) return "tornado";
  if (t.includes("WND GST")) return "gust";
  if (t.includes("SURGE") || t.includes("COASTAL FLOOD") || t.includes("TIDE")) return "surge";
  if (t.includes("FLOOD") || t.includes("RAIN") || t.includes("LANDSLIDE")) return "flood";
  if (t.includes("HAIL")) return "hail";
  if (t.includes("WND") || t.includes("WIND") || t.includes("HURRICANE") || t.includes("TROPICAL")) return "wind";
  return "other";
}

const gustOf = (r: EventReport): number | null => {
  if (r.mag === null || !(r.type.toUpperCase().includes("GST"))) return null;
  const unit = r.unit.toUpperCase();
  if (unit === "MPH") return r.mag;
  if (unit === "KTS" || unit === "KT") return Math.round(r.mag * KT_TO_MPH);
  return null;
};

export function buildEventModel(pkg: EventPackage): EventModel {
  const { wind } = pkg;
  const hourMs = wind.hours.map((h) => Date.parse(h));
  const n = wind.rows * wind.cols;
  const ux: Float32Array[] = [];
  const uy: Float32Array[] = [];
  const speed: Float32Array[] = [];
  const gust: Float32Array[] = [];
  const hourPeak: EventModel["hourPeak"] = [];
  for (let h = 0; h < hourMs.length; h += 1) {
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    let best = 0;
    let bestGust = 0;
    for (let i = 0; i < n; i += 1) {
      // Meteorological direction is where the wind comes from, clockwise from north; it blows the opposite way.
      const from = (wind.dir[h][i] * Math.PI) / 180;
      x[i] = -Math.sin(from);
      y[i] = Math.cos(from);
      if (wind.speed[h][i] > wind.speed[h][best]) best = i;
      if (wind.gust[h][i] > bestGust) bestGust = wind.gust[h][i];
    }
    ux.push(x);
    uy.push(y);
    speed.push(Float32Array.from(wind.speed[h]));
    gust.push(Float32Array.from(wind.gust[h]));
    const row = Math.floor(best / wind.cols);
    hourPeak.push({ speed: wind.speed[h][best], gust: bestGust, lat: wind.south + row * wind.step, lon: wind.west + (best % wind.cols) * wind.step });
  }
  const reports = pkg.reports
    .map((r) => ({ ...r, ms: Date.parse(r.t), kind: reportKind(r.type), gustMph: gustOf(r) }))
    .filter((r) => Number.isFinite(r.ms))
    .sort((a, b) => a.ms - b.ms);
  const topGustIdx = new Int32Array(reports.length);
  reports.forEach((r, i) => {
    const prev = i > 0 ? topGustIdx[i - 1] : -1;
    topGustIdx[i] = r.gustMph !== null && (prev < 0 || r.gustMph > (reports[prev].gustMph ?? 0)) ? i : prev;
  });
  return {
    pkg,
    startMs: hourMs[0],
    endMs: hourMs[hourMs.length - 1],
    hourMs,
    rows: wind.rows,
    cols: wind.cols,
    ux,
    uy,
    speed,
    gust,
    hourPeak,
    track: (pkg.track ?? []).map((t) => ({ ...t, ms: Date.parse(t.t) })),
    reports,
    topGustIdx,
  };
}

/** Storm time at progress p. */
export const timeAt = (model: EventModel, p: number) => model.startMs + clamp(p) * (model.endMs - model.startMs);

/** Fractional hour index at a storm time. */
export const hourAt = (model: EventModel, ms: number) => clamp((ms - model.startMs) / HOUR, 0, model.hourMs.length - 1);

export interface WindSample {
  /** mph */
  speed: number;
  /** Unit vector the wind blows toward, on screen (x east, y south). */
  dx: number;
  dy: number;
}

/**
 * The model's wind at one place and moment, or null outside the grid. Directions are blended as vectors and speeds as numbers, so a
 * turning wind keeps its strength between two hours.
 */
export function windAt(model: EventModel, hourF: number, lat: number, lon: number, field: "speed" | "gust" = "speed"): WindSample | null {
  const { wind } = model.pkg;
  const gy = (lat - wind.south) / wind.step;
  const gx = (lon - wind.west) / wind.step;
  if (gy < 0 || gx < 0 || gy > model.rows - 1 || gx > model.cols - 1) return null;
  const r0 = Math.min(model.rows - 2, Math.floor(gy));
  const c0 = Math.min(model.cols - 2, Math.floor(gx));
  const fy = gy - r0;
  const fx = gx - c0;
  const h0 = Math.min(model.hourMs.length - 1, Math.floor(hourF));
  const h1 = Math.min(model.hourMs.length - 1, h0 + 1);
  const ft = hourF - h0;
  const values = field === "gust" ? model.gust : model.speed;
  let s = 0;
  let x = 0;
  let y = 0;
  const corners: Array<[number, number]> = [
    [r0 * model.cols + c0, (1 - fx) * (1 - fy)],
    [r0 * model.cols + c0 + 1, fx * (1 - fy)],
    [(r0 + 1) * model.cols + c0, (1 - fx) * fy],
    [(r0 + 1) * model.cols + c0 + 1, fx * fy],
  ];
  for (const [h, wt] of [[h0, 1 - ft], [h1, ft]] as const) {
    for (const [i, ws] of corners) {
      const w = wt * ws;
      if (w === 0) continue;
      const v = values[h][i];
      s += w * v;
      // Weighted by speed too, so a calm corner does not swing the direction of a strong one.
      x += w * (v + 1) * model.ux[h][i];
      y += w * (v + 1) * model.uy[h][i];
    }
  }
  const len = Math.hypot(x, y) || 1;
  return { speed: s, dx: x / len, dy: y / len };
}

export interface StormNow {
  lat: number;
  lon: number;
  /** The wind radii (nautical miles, NE SE SW NW), blended between fixes. */
  r34: number[];
  r50: number[];
  r64: number[];
  /** The latest best-track fix at or before now: what the panel quotes (never a blended number). */
  fix: EventTrackPoint & { ms: number };
}

/** Where the hurricane was at a storm time, between the best track's fixes; null outside the track or for an event without one. */
export function stormAt(model: EventModel, ms: number): StormNow | null {
  const track = model.track;
  if (track.length < 2 || ms < track[0].ms || ms > track[track.length - 1].ms) return null;
  let i = 0;
  while (i < track.length - 2 && track[i + 1].ms <= ms) i += 1;
  const a = track[i];
  const b = track[i + 1];
  const f = clamp((ms - a.ms) / (b.ms - a.ms));
  const fix = ms >= b.ms ? b : a;
  const radii = (key: "r34" | "r50" | "r64") => a[key].map((v, q) => lerp(v, b[key][q], f));
  return { lat: lerp(a.lat, b.lat, f), lon: lerp(a.lon, b.lon, f), r34: radii("r34"), r50: radii("r50"), r64: radii("r64"), fix };
}

/** "Category 4", "Tropical storm" ... from a best-track wind in knots (Saffir-Simpson). */
export function categoryOf(windKt: number, status = "HU"): string {
  if (status === "EX" || status === "LO") return "Post-tropical";
  if (windKt >= 137) return "Category 5";
  if (windKt >= 113) return "Category 4";
  if (windKt >= 96) return "Category 3";
  if (windKt >= 83) return "Category 2";
  if (windKt >= 64) return "Category 1";
  if (windKt >= 34) return "Tropical storm";
  return "Tropical depression";
}

/** How many reports have come in by a storm time. */
export function reportsUpTo(model: EventModel, ms: number): number {
  let lo = 0;
  let hi = model.reports.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (model.reports[mid].ms <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface EventFrame {
  ms: number;
  hourF: number;
  storm: StormNow | null;
  /** Reports [0, seen) are in. */
  seen: number;
  /** The highest gust reported so far, or null. */
  topGust: ModelReport | null;
  /** The model's strongest wind at the nearest hour. */
  peak: EventModel["hourPeak"][number];
  /** Landfalls so far. */
  landfalls: Array<EventTrackPoint & { ms: number }>;
}

export function eventFrame(model: EventModel, p: number): EventFrame {
  const ms = timeAt(model, p);
  const hourF = hourAt(model, ms);
  const seen = reportsUpTo(model, ms);
  const top = seen > 0 ? model.topGustIdx[seen - 1] : -1;
  return {
    ms,
    hourF,
    storm: stormAt(model, ms),
    seen,
    topGust: top >= 0 ? model.reports[top] : null,
    peak: model.hourPeak[Math.round(hourF)],
    landfalls: model.track.filter((t) => t.landfall && t.ms <= ms),
  };
}

/** Counts of the reports in so far, by kind. */
export function kindCounts(model: EventModel, seen: number): Record<ReportKind, number> {
  const counts: Record<ReportKind, number> = { gust: 0, wind: 0, tornado: 0, flood: 0, surge: 0, hail: 0, other: 0 };
  for (let i = 0; i < seen; i += 1) counts[model.reports[i].kind] += 1;
  return counts;
}

/**
 * The replay's key moment, as progress: the strongest landfall inside the window for a hurricane, otherwise the highest gust reported.
 * Reduced motion opens here, still.
 */
export function keyMomentP(model: EventModel): number {
  const span = model.endMs - model.startMs;
  const inside = (ms: number) => ms >= model.startMs && ms <= model.endMs;
  const landfalls = model.track.filter((t) => t.landfall && inside(t.ms));
  if (landfalls.length) return (landfalls.reduce((a, b) => (b.windKt > a.windKt ? b : a)).ms - model.startMs) / span;
  const top = model.reports.length ? model.reports[model.topGustIdx[model.reports.length - 1]] : null;
  return top ? (top.ms - model.startMs) / span : 1;
}
