/**
 * Writes public/data/moments.json: the small timelines on the landing page's moment cards, read from the shipped data only.
 *
 *   - tornado nights (Mayfield, Rolling Fork): every tornado in the state index that touched down that evening, with its rating and
 *     casualties, and which one the card is about;
 *   - Ida's night over New York: the GOES-16 lightning flashes per ten minutes (public/data/lightning) and the times of the flood
 *     reports the storm replay itself shows that night (lib/lookup.ts selectReplayNight on data/index/NY), so the card and the
 *     replay count the same reports;
 *   - Lahaina and Ian: the events of the card's hazard (wildfires; hurricanes, tropical storms and storm surge) and their deaths
 *     filed each year since 2000 for the address's county and forecast zones (the same events the area replay plays when opened from
 *     the card), with the event's year marked.
 *
 *   npm run moment-timelines      (offline; re-run when data/index, data/events or the lightning files change)
 *
 * Needs Node 22.7 or newer. Run from the repo root.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";

register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, next) {
      if ((s.startsWith("./") || s.startsWith("../")) && !/\\.[cm]?[jt]s$|\\.json$/.test(s)) { try { return await next(s + ".ts", c); } catch {} }
      return next(s, c);
    }`),
);

const { loadStateIndex } = await import("../lib/index-store.ts");
const { buildAreaReplay } = await import("../lib/area-replay.ts");
const { selectReplayNight } = await import("../lib/lookup.ts");
const { TROPICAL } = await import("../lib/ui/landing-moments.ts");

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public", "data", "moments.json");
const ratingOf = (ef: string) => (/^EF(\d)$/.exec(ef) ? Number(ef.slice(2)) : -1);

async function tornadoNight(state: string, fromLocal: string, toLocal: string, focusId: string) {
  const index = await loadStateIndex(state);
  if (!index) throw new Error(`no index for ${state}`);
  const from = Date.parse(fromLocal);
  const to = Date.parse(toLocal);
  const marks = index.tornadoes
    .filter((t) => Date.parse(t.start) >= from && Date.parse(t.start) <= to)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .map((t) => ({ t: Date.parse(t.start), ef: ratingOf(t.ef), deaths: t.deaths, injuries: t.injuries, lengthMi: t.lengthMi, focus: t.id === focusId }));
  if (!marks.some((m) => m.focus)) throw new Error(`${focusId} is not in ${state} that night`);
  // The strip runs from half an hour before the first touchdown to half an hour after the last, on the half hour.
  const HALF_HOUR = 30 * 60_000;
  const startMs = Math.floor((marks[0].t - HALF_HOUR) / HALF_HOUR) * HALF_HOUR;
  const endMs = Math.ceil((marks[marks.length - 1].t + HALF_HOUR) / HALF_HOUR) * HALF_HOUR;
  return { kind: "tornadoes" as const, state, startMs, endMs, offsetMin: Number(fromLocal.slice(-6, -3)) * 60, marks };
}

async function stormNight(lightningFile: string, state: string, origin: [number, number], nightId: string, binMinutes: number) {
  const index = await loadStateIndex(state);
  if (!index) throw new Error(`no index for ${state}`);
  const replay = selectReplayNight(index.floods, origin, nightId);
  if (!replay || replay.nightId !== nightId) throw new Error(`night ${nightId} is not a storm night here`);
  const startMs = Date.parse(replay.startUtc);
  const endMs = Date.parse(replay.endUtc);
  const night = JSON.parse(readFileSync(path.join(ROOT, "public", lightningFile), "utf8")) as { startUtc: string; flashes: Array<[number, number, number, number, number]> };
  const bins = new Array<number>(Math.ceil((endMs - startMs) / (binMinutes * 60_000))).fill(0);
  const offset = Date.parse(night.startUtc) - startMs;
  for (const [seconds] of night.flashes) {
    const bin = Math.floor((offset + seconds * 1000) / (binMinutes * 60_000));
    if (bin >= 0 && bin < bins.length) bins[bin] += 1;
  }
  const reports = (replay.reports ?? []).map((f) => Date.parse(f.start)).sort((a, b) => a - b);
  return { kind: "night" as const, startMs, endMs, offsetMin: -240, binMinutes, lightning: bins, reports };
}

async function areaYears(lat: number, lon: number, state: string, county: string, highlightId: string, kinds: readonly string[], noun: [string, string]) {
  const all = await buildAreaReplay(lat, lon, state, county);
  if (!all) throw new Error(`no area events for ${state} ${county}`);
  const wanted = new Set(kinds);
  const replay = { ...all, events: all.events.filter(([, type]) => wanted.has(all.types[type] ?? "")) };
  const years = Array.from({ length: 2025 - replay.since + 1 }, (_, i) => replay.since + i);
  const counts = years.map(() => 0);
  const deaths = years.map(() => 0);
  for (const [day, , , dead] of replay.events) {
    const year = new Date(Date.UTC(replay.since, 0, 1) + day * 86_400_000).getUTCFullYear();
    const i = year - replay.since;
    if (i >= 0 && i < years.length) {
      counts[i] += 1;
      deaths[i] += dead;
    }
  }
  const events = (await import("../lib/area-events.ts")).selectAreaEvents;
  const found = await events(lat, lon, state, county);
  const highlight = found?.events.find((e) => e.id === highlightId);
  if (!highlight) throw new Error(`${highlightId} is not among the area's events`);
  return { kind: "years" as const, from: replay.since, noun, counts, deaths, highlightYear: Number(highlight.start.slice(0, 4)), highlightDeaths: highlight.deaths };
}

const moments = {
  mayfield: await tornadoNight("KY", "2021-12-10T18:00:00-06:00", "2021-12-11T06:00:00-06:00", "SE-994196"),
  "rolling-fork": await tornadoNight("MS", "2023-03-24T17:00:00-05:00", "2023-03-25T05:00:00-05:00", "SE-1102153"),
  ida: await stormNight("data/lightning/ida-queens/2021-09-02T0200.json", "NY", [40.758019717113, -73.829301134074], "2021-09-02T02:00", 10),
  lahaina: await areaYears(20.872265460535, -156.677377427357, "HI", "HIC009", "SE-1118193", ["Wildfire"], ["wildfire", "wildfires"]),
  ian: await areaYears(26.641921862769, -81.869795800037, "FL", "FLC071", "SE-1058654", TROPICAL, ["tropical storm record", "tropical storm records"]),
};

writeFileSync(OUT, JSON.stringify({ built: new Date().toISOString(), moments }));
console.log(`wrote ${path.relative(ROOT, OUT)}:`);
for (const [id, m] of Object.entries(moments)) {
  if (m.kind === "tornadoes") console.log(`  ${id}: ${m.marks.length} tornadoes in ${m.state} that night`);
  if (m.kind === "night") console.log(`  ${id}: ${m.lightning.reduce((a, b) => a + b, 0)} flashes in ${m.lightning.length} bins, ${m.reports.length} flood reports`);
  if (m.kind === "years") console.log(`  ${id}: ${m.counts.reduce((a, b) => a + b, 0)} events, ${m.highlightYear} marked (${m.highlightDeaths} deaths)`);
}
