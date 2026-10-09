/**
 * The moving maps behind the landing page's "Start here" cards (public/data/sample-previews.json, written by
 * scripts/sample-previews.ts). Each is a pure function of loop progress `p` (0 to 1), like every animated view.
 */
import { clamp, lerp } from "./anim";
import { formatAtOffset } from "./text";

type Box = [number, number, number, number];

export interface TornadoPreview {
  kind: "tornadoes";
  /** south, north, west, east */
  box: Box;
  home: [number, number];
  from: number;
  to: number;
  focusKm: number;
  /** [year, EF (-1 unknown), begin lat, lon, end lat, lon, 1 for the card's own] */
  tracks: Array<[number, number, number, number, number, number, number]>;
}

export interface NightPreview {
  kind: "night";
  box: Box;
  home: [number, number];
  startMs: number;
  endMs: number;
  offsetMin: number;
  /** [seconds since startMs, lat, lon] */
  flashes: Array<[number, number, number]>;
  reports: Array<[number, number, number]>;
}

export interface HeatPreview {
  kind: "heat";
  box: Box;
  home: [number, number];
  days: string[];
  step: number;
  /** [lat, lon, feels-like °F per day] */
  cells: Array<[number, number, number[]]>;
  /** Feels-like at the address, per day. */
  address: number[];
}

export type SamplePreview = TornadoPreview | NightPreview | HeatPreview;

export interface SamplePreviewsFile {
  built: string;
  previews: Record<string, SamplePreview>;
}

/** Which preview each "Start here" card shows, by the sample's address. */
export const PREVIEW_OF_ADDRESS: Record<string, string> = {
  "100 James Robertson Pkwy, Nashville, TN": "nashville",
  "100 Military Plaza, San Antonio, TX": "san-antonio",
  "350 Riverside Dr, Asheville, NC": "asheville",
  "450 110th Ave NE, Bellevue, WA": "bellevue",
};

/** How long one loop lasts. */
export const LOOP_MS: Record<SamplePreview["kind"], number> = { tornadoes: 9000, night: 8000, heat: 7000 };

/** Where a still preview (reduced motion, or paused before it ran) rests: everything drawn, or the hottest day. */
export function restingP(preview: SamplePreview): number {
  if (preview.kind !== "heat") return 1;
  const peak = preview.address.indexOf(Math.max(...preview.address));
  return peak / Math.max(1, preview.days.length - 1);
}

/** The years sweep over the first 65% of the loop; the card's own tornado then draws slowly until 90%; the rest holds. */
const SWEEP = 0.65;
const FOCUS_END = 0.9;

export interface TornadoFrame {
  year: number;
  /** How much of each track is drawn, 0 to 1. */
  drawn: number[];
  /** The card's own track is drawing now (its funnel shows). */
  focusDrawing: boolean;
}

export function tornadoFrame(preview: TornadoPreview, p: number): TornadoFrame {
  const years = preview.to - preview.from + 1;
  const sweep = clamp(p / SWEEP);
  const yearF = preview.from + sweep * years;
  const focus = clamp((p - SWEEP) / (FOCUS_END - SWEEP));
  const drawn = preview.tracks.map(([year, , , , , , own]) => (own ? focus : clamp((yearF - year) * 2.5)));
  return { year: Math.min(preview.to, Math.floor(yearF)), drawn, focusDrawing: focus > 0 && focus < 1 };
}

export interface NightFrame {
  seconds: number;
  clock: string;
  /** Flashes [0, flashesSeen) and reports [0, reportsSeen) have happened. */
  flashesSeen: number;
  reportsSeen: number;
}

const upTo = (rows: Array<[number, number, number]>, seconds: number) => {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][0] <= seconds) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

export function nightFrame(preview: NightPreview, p: number): NightFrame {
  const seconds = (clamp(p) * (preview.endMs - preview.startMs)) / 1000;
  const ms = preview.startMs + seconds * 1000;
  const multiDay = preview.endMs - preview.startMs > 18 * 3_600_000;
  const clock = formatAtOffset(ms, preview.offsetMin, multiDay ? { weekday: "short", hour: "numeric" } : { hour: "numeric", minute: "2-digit" });
  return { seconds, clock, flashesSeen: upTo(preview.flashes, seconds), reportsSeen: upTo(preview.reports, seconds) };
}

export interface HeatFrame {
  dayF: number;
  /** "Jun 28" */
  label: string;
  /** Feels-like at the address now, blended between days. */
  addressF: number;
}

export function heatFrame(preview: HeatPreview, p: number): HeatFrame {
  const last = preview.days.length - 1;
  const dayF = clamp(p) * last;
  const d0 = Math.floor(dayF);
  const d1 = Math.min(last, d0 + 1);
  const label = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(Date.parse(`${preview.days[Math.round(dayF)]}T12:00:00Z`));
  return { dayF, label, addressF: lerp(preview.address[d0], preview.address[d1], dayF - d0) };
}

/** A cell's feels-like at a fractional day. */
export const cellValue = (values: number[], dayF: number) => {
  const d0 = Math.floor(dayF);
  const d1 = Math.min(values.length - 1, d0 + 1);
  return lerp(values[d0], values[d1], dayF - d0);
};
