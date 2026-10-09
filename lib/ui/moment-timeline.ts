/**
 * The small timelines on the landing page's moment cards (public/data/moments.json, written by scripts/moment-timelines.ts). Each is a
 * pure function of progress `p` (0 to 1): which marks have been reached, the running totals, and the words beside the playhead.
 */
import { formatAtOffset } from "./text";

export interface TornadoNight {
  kind: "tornadoes";
  state: string;
  startMs: number;
  endMs: number;
  offsetMin: number;
  marks: Array<{ t: number; ef: number; deaths: number; injuries: number; lengthMi: number; focus: boolean }>;
}

export interface StormNightTimeline {
  kind: "night";
  startMs: number;
  endMs: number;
  offsetMin: number;
  binMinutes: number;
  /** Lightning flashes in each bin. */
  lightning: number[];
  /** Flood report times, UTC ms. */
  reports: number[];
}

export interface AreaYears {
  kind: "years";
  from: number;
  /** Events and deaths filed each year, from `from`. */
  counts: number[];
  deaths: number[];
  highlightYear: number;
  highlightDeaths: number;
}

export type MomentTimeline = TornadoNight | StormNightTimeline | AreaYears;

export interface MomentsFile {
  built: string;
  moments: Record<string, MomentTimeline>;
}

/** How long a card's timeline plays. */
export const TIMELINE_MS = 7000;

export interface TimelineFrame {
  /** Where the playhead is, 0 to 1 along the strip. */
  x: number;
  /** The clock or year beside the playhead. */
  when: string;
  /** "23 tornadoes so far · 61 deaths" */
  totals: string;
  /** Marks [0, reached) have been passed. */
  reached: number;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const clock = (ms: number, offsetMin: number) => formatAtOffset(ms, offsetMin, { hour: "numeric", minute: "2-digit" });

/** Where a moment of the night sits along its strip, 0 to 1. */
export const nightX = (t: { startMs: number; endMs: number }, ms: number) => (ms - t.startMs) / (t.endMs - t.startMs);

export function timelineFrame(timeline: MomentTimeline, p: number): TimelineFrame {
  const x = Math.min(1, Math.max(0, p));
  if (timeline.kind === "years") {
    const years = timeline.counts.length;
    // The year the playhead is in counts as soon as the playhead enters it.
    const reached = Math.min(years, Math.floor(x * years) + 1);
    const events = timeline.counts.slice(0, reached).reduce((a, b) => a + b, 0);
    const deaths = timeline.deaths.slice(0, reached).reduce((a, b) => a + b, 0);
    return { x, when: String(timeline.from + Math.max(0, reached - 1)), totals: `${plural(events, "event", "events")} so far · ${plural(deaths, "death", "deaths")}`, reached };
  }
  const now = timeline.startMs + x * (timeline.endMs - timeline.startMs);
  if (timeline.kind === "tornadoes") {
    const reached = timeline.marks.filter((m) => m.t <= now).length;
    const deaths = timeline.marks.slice(0, reached).reduce((sum, m) => sum + m.deaths, 0);
    return { x, when: clock(now, timeline.offsetMin), totals: `${plural(reached, "tornado record", "tornado records")} so far · ${plural(deaths, "death", "deaths")}`, reached };
  }
  const bins = Math.min(timeline.lightning.length, Math.floor((now - timeline.startMs) / (timeline.binMinutes * 60_000)) + 1);
  const flashes = timeline.lightning.slice(0, bins).reduce((a, b) => a + b, 0);
  const reports = timeline.reports.filter((t) => t <= now).length;
  return { x, when: clock(now, timeline.offsetMin), totals: `${plural(flashes, "lightning flash", "lightning flashes")} · ${plural(reports, "flood report", "flood reports")}`, reached: bins };
}

/** The strip's start and end, in words. */
export function timelineEnds(timeline: MomentTimeline): [string, string] {
  if (timeline.kind === "years") return [String(timeline.from), String(timeline.from + timeline.counts.length - 1)];
  return [clock(timeline.startMs, timeline.offsetMin), clock(timeline.endMs, timeline.offsetMin)];
}

/** One sentence for a screen reader: what the whole timeline shows. */
export function timelineSummary(timeline: MomentTimeline): string {
  if (timeline.kind === "years") {
    const events = timeline.counts.reduce((a, b) => a + b, 0);
    return `${plural(events, "event", "events")} filed since ${timeline.from}; ${timeline.highlightYear} stands out, with ${plural(timeline.highlightDeaths, "death", "deaths")} in one event.`;
  }
  if (timeline.kind === "tornadoes") {
    const focus = timeline.marks.find((m) => m.focus);
    return `${plural(timeline.marks.length, "tornado record", "tornado records")} in ${timeline.state} that night${focus ? `; the EF${focus.ef} at ${clock(focus.t, timeline.offsetMin)} is this card's` : ""}.`;
  }
  const flashes = timeline.lightning.reduce((a, b) => a + b, 0);
  return `${plural(flashes, "lightning flash", "lightning flashes")} and ${plural(timeline.reports.length, "flood report", "flood reports")} over the night.`;
}

/** Where the card's own moment sits on the strip (0 to 1) and its label: the card's tornado, or the event's year. Null for a night. */
export function timelineHighlight(timeline: MomentTimeline): { x: number; label: string } | null {
  if (timeline.kind === "years") {
    const i = timeline.highlightYear - timeline.from;
    return { x: (i + 0.5) / timeline.counts.length, label: `${timeline.highlightYear} · ${plural(timeline.highlightDeaths, "death", "deaths")}` };
  }
  if (timeline.kind === "tornadoes") {
    const focus = timeline.marks.find((m) => m.focus);
    return focus ? { x: nightX(timeline, focus.t), label: `EF${focus.ef} · ${clock(focus.t, timeline.offsetMin)}` } : null;
  }
  return null;
}
