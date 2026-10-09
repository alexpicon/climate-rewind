/**
 * Writes public/data/sample-previews.json: the small moving maps behind the landing page's "Start here" cards, read from the shipped
 * data only, about what each card's hook names.
 *
 *   - Nashville: every tornado track in the state index within the card's box, by date, and which one is the EF3 that passed closest;
 *   - San Antonio: the storm night its card opens (lib/lookup.ts selectReplayNight on data/index): the GOES-16 lightning flashes
 *     (public/data/lightning) and the flood reports, each at its time and place;
 *   - Asheville: Helene, Sep 25 to 28, 2024: every flood report within about 100 km, with the lightning of the first night;
 *   - Bellevue: the regional heat grid of the 2021 heat dome (data/heat/bellevue.json), day by day.
 *
 *   npm run sample-previews      (offline; re-run when data/index, data/heat or the lightning files change)
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
const { selectReplayNight } = await import("../lib/lookup.ts");
const { distanceToSegmentKm } = await import("../lib/geo.ts");

const ROOT = process.cwd();
type FloodRow = import("../lib/types.ts").FloodRow;
const OUT = path.join(ROOT, "public", "data", "sample-previews.json");
const round = (x: number, places = 3) => Math.round(x * 10 ** places) / 10 ** places;
const ratingOf = (ef: string) => (/^EF(\d)$/.exec(ef) ? Number(ef.slice(2)) : -1);
type Box = [number, number, number, number];
const snapshot = (slug: string) => JSON.parse(readFileSync(path.join(ROOT, "data", "samples", `${slug}.json`), "utf8")) as { address: string; lat: number; lon: number };

async function tornadoes(slug: string, state: string, halfLat: number, halfLon: number) {
  const home = snapshot(slug);
  const box: Box = [round(home.lat - halfLat), round(home.lat + halfLat), round(home.lon - halfLon), round(home.lon + halfLon)];
  const index = await loadStateIndex(state);
  if (!index) throw new Error(`no index for ${state}`);
  const inside = ([lat, lon]: [number, number]) => lat >= box[0] && lat <= box[1] && lon >= box[2] && lon <= box[3];
  const rows = index.tornadoes.filter((t) => inside(t.begin) || inside(t.end)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const near = rows
    .map((t) => ({ t, km: distanceToSegmentKm([home.lat, home.lon], t.begin, t.end) }))
    .filter(({ t }) => ratingOf(t.ef) >= 3)
    .sort((a, b) => a.km - b.km)[0];
  if (!near) throw new Error(`no EF3 or stronger near ${slug}`);
  return {
    kind: "tornadoes" as const,
    box,
    home: [round(home.lat, 4), round(home.lon, 4)],
    from: Number(rows[0].start.slice(0, 4)),
    to: Number(rows[rows.length - 1].start.slice(0, 4)),
    focusKm: round(near.km, 2),
    /** [year, EF rating (-1 unknown), begin lat, lon, end lat, lon, 1 for the card's own] */
    tracks: rows.map((t) => [Number(t.start.slice(0, 4)), ratingOf(t.ef), round(t.begin[0]), round(t.begin[1]), round(t.end[0]), round(t.end[1]), t.id === near.t.id ? 1 : 0]),
  };
}

/** Flood reports and lightning flashes in a window around an address: [seconds since startMs, lat, lon] each. */
function storm(slug: string, flashFile: string, reportRows: FloodRow[], startMs: number, endMs: number, box: Box, offsetMin: number) {
  const home = snapshot(slug);
  const [south, north, west, east] = box;
  const file = JSON.parse(readFileSync(path.join(ROOT, "public", flashFile), "utf8")) as { startUtc: string; flashes: Array<[number, number, number, number, number]> };
  const offset = Date.parse(file.startUtc) - startMs;
  const inside = (lat: number, lon: number) => lat >= south && lat <= north && lon >= west && lon <= east;
  const flashes = file.flashes
    .map(([s, lat, lon]) => [Math.round((offset + s * 1000) / 1000), round(lat), round(lon)])
    .filter(([s, lat, lon]) => s >= 0 && s * 1000 <= endMs - startMs && inside(lat, lon))
    .sort((a, b) => a[0] - b[0]);
  const reports = reportRows
    .filter((r) => !r.dupOf)
    .map((r) => ({ ms: Date.parse(r.start), at: r.placed ?? r.filed }))
    .filter((r) => r.at && r.ms >= startMs && r.ms <= endMs && inside(r.at[0], r.at[1]))
    .sort((a, b) => a.ms - b.ms)
    .map((r) => [Math.round((r.ms - startMs) / 1000), round(r.at![0]), round(r.at![1])]);
  return { kind: "night" as const, box: box.map((x) => round(x)) as Box, home: [round(home.lat, 4), round(home.lon, 4)], startMs, endMs, offsetMin, flashes, reports };
}

/** The storm replay's night that the lightning was fetched for (the night San Antonio's card opens). */
async function replayNight(slug: string, state: string, flashFile: string, offsetMin: number) {
  const home = snapshot(slug);
  const { nightId } = JSON.parse(readFileSync(path.join(ROOT, "public", flashFile), "utf8")) as { nightId: string };
  const index = await loadStateIndex(state);
  if (!index) throw new Error(`no index for ${state}`);
  const replay = selectReplayNight(index.floods, [home.lat, home.lon], nightId);
  if (!replay || replay.nightId !== nightId) throw new Error(`${nightId} is not a storm night for ${slug}`);
  const [west, south, east, north] = replay.bounds;
  return storm(slug, flashFile, replay.reports, Date.parse(replay.startUtc), Date.parse(replay.endUtc), [south, north, west, east], offsetMin);
}

/** Every flood report around an address in a window of days (Helene over the mountains), with the lightning of its first night. */
async function floodDays(slug: string, state: string, flashFile: string, fromUtc: string, toUtc: string, halfLat: number, halfLon: number, offsetMin: number) {
  const home = snapshot(slug);
  const index = await loadStateIndex(state);
  if (!index) throw new Error(`no index for ${state}`);
  const box: Box = [home.lat - halfLat, home.lat + halfLat, home.lon - halfLon, home.lon + halfLon];
  return storm(slug, flashFile, index.floods, Date.parse(fromUtc), Date.parse(toUtc), box, offsetMin);
}

function heat(slug: string) {
  const home = snapshot(slug);
  const grid = JSON.parse(readFileSync(path.join(ROOT, "data", "heat", `${slug}.json`), "utf8")) as { days: string[]; step: number; bounds: { lat: [number, number]; lon: [number, number] }; cells: Array<[number, number, number[]]> };
  const daily = (JSON.parse(readFileSync(path.join(ROOT, "data", "samples", `${slug}.json`), "utf8")) as { heat: { worstWeek: { daily: Array<{ date: string; feelsF: number }> } } }).heat.worstWeek.daily;
  if (daily.map((d) => d.date).join() !== grid.days.join()) throw new Error(`${slug}: the grid's days are not the address's worst week`);
  return {
    kind: "heat" as const,
    box: [grid.bounds.lat[0], grid.bounds.lat[1], grid.bounds.lon[0], grid.bounds.lon[1]] as Box,
    home: [round(home.lat, 4), round(home.lon, 4)],
    days: grid.days,
    step: grid.step,
    cells: grid.cells.map(([lat, lon, values]) => [lat, lon, values.map((v) => Math.round(v))]),
    /** Feels-like at the address itself, each day. */
    address: daily.map((d) => d.feelsF),
  };
}

const previews = {
  nashville: await tornadoes("nashville", "TN", 0.32, 0.42),
  "san-antonio": await replayNight("san-antonio", "TX", "data/lightning/san-antonio/2021-05-01T1805.json", -300),
  asheville: await floodDays("asheville", "NC", "data/lightning/asheville/2024-09-25T2300.json", "2024-09-25T22:00:00Z", "2024-09-28T12:00:00Z", 0.9, 1.2, -240),
  bellevue: heat("bellevue"),
};

writeFileSync(OUT, JSON.stringify({ built: new Date().toISOString(), previews }));
console.log(`wrote ${path.relative(ROOT, OUT)}:`);
for (const [slug, p] of Object.entries(previews)) {
  if (p.kind === "tornadoes") console.log(`  ${slug}: ${p.tracks.length} tornado tracks ${p.from} to ${p.to}, the closest EF3+ ${p.focusKm} km away`);
  if (p.kind === "night") console.log(`  ${slug}: ${p.flashes.length} flashes and ${p.reports.length} flood reports over ${(p.endMs - p.startMs) / 3_600_000} h`);
  if (p.kind === "heat") console.log(`  ${slug}: ${p.cells.length} cells over ${p.days.length} days, the address peaking at ${Math.max(...p.address)}°F`);
}
