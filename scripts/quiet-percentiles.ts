/**
 * Writes data/quiet-percentiles.json: for each indexed state, how many flood reports sit within 5 km of ~500 random points, as a
 * histogram. The app uses it to say "quieter than X% of the places we sampled in <state>" (lib/quiet.ts). Offline: it reads only
 * data/index/<ST>.json.gz.
 *
 *   npm run quiet-percentiles
 *   npm run quiet-percentiles -- --points 500 --seed 7
 *
 * The points are drawn uniformly inside the bounding box of the state's records and kept only if a flood or tornado record lies
 * within 40 km (open water and empty country far from any record are left out). They are seeded, so the same index gives the same
 * file. Reports exist where people are and where spotters file them, so "quiet" here means fewer reports than the sample, not less risk.
 *
 * Needs Node 22.7 or newer. Run from the repo root.
 */
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, next) {
      if ((s.startsWith("./") || s.startsWith("../")) && !/\\.[cm]?[jt]s$|\\.json$/.test(s)) { try { return await next(s + ".ts", c); } catch {} }
      return next(s, c);
    }`),
);

const { haversineKm } = await import("../lib/geo.ts");
const { loadStateIndex } = await import("../lib/index-store.ts");
const { reportPoint } = await import("../lib/lookup.ts");
const { FLOOD_RADIUS_KM } = await import("../lib/constants.ts");
type Coord = import("../lib/types.ts").Coord;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const POINTS = Number(arg("points") ?? 500);
const SEED = Number(arg("seed") ?? 7);
/** A sample point must have a record this close, so the sample is places with records around, not open water. */
const NEAR_RECORD_KM = 40;
const MAX_TRIES = POINTS * 200;

/** mulberry32: a small seeded generator, so the file is reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DATA = path.join(process.cwd(), "data");
const states = readdirSync(path.join(DATA, "index"))
  .map((name) => /^([A-Z]{2})\.json\.gz$/.exec(name)?.[1])
  .filter((code): code is string => Boolean(code))
  .sort();

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];

const out: Record<string, { points: number; hist: Record<string, number> }> = {};
for (const state of states) {
  const index = await loadStateIndex(state);
  if (!index) continue;
  const floods: Coord[] = [];
  for (const flood of index.floods) {
    if (flood.dupOf) continue;
    const point = reportPoint(flood);
    if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])) floods.push(point);
  }
  const validPoint = (p: Coord | null | undefined): p is Coord => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const records: Coord[] = [...floods, ...index.tornadoes.map((t) => t.begin).filter(validPoint)];
  if (records.length < 20) {
    console.log(`${state}: skipped (${records.length} records)`);
    continue;
  }
  // The box of the records, ignoring the 0.5% at each end (a stray mis-filed coordinate would stretch it across the country).
  const lats = records.map((p) => p[0]).sort((a, b) => a - b);
  const lons = records.map((p) => p[1]).sort((a, b) => a - b);
  const [south, north, west, east] = [quantile(lats, 0.005), quantile(lats, 0.995), quantile(lons, 0.005), quantile(lons, 0.995)];

  // Records in 0.5 degree cells, so "any record within 40 km" looks at 9 cells, not all of them.
  const CELL = 0.5;
  const cellOf = (p: Coord) => `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`;
  const grid = new Map<string, Coord[]>();
  for (const p of records) {
    const key = cellOf(p);
    const list = grid.get(key);
    if (list) list.push(p);
    else grid.set(key, [p]);
  }
  const hasRecordNear = (p: Coord) => {
    const [ci, cj] = [Math.floor(p[0] / CELL), Math.floor(p[1] / CELL)];
    for (let i = ci - 1; i <= ci + 1; i += 1) {
      for (let j = cj - 1; j <= cj + 1; j += 1) {
        for (const r of grid.get(`${i},${j}`) ?? []) if (haversineKm(p, r) <= NEAR_RECORD_KM) return true;
      }
    }
    return false;
  };

  const random = rng(SEED + state.charCodeAt(0) * 31 + state.charCodeAt(1));
  const hist: Record<string, number> = {};
  let kept = 0;
  for (let tries = 0; kept < POINTS && tries < MAX_TRIES; tries += 1) {
    const p: Coord = [south + random() * (north - south), west + random() * (east - west)];
    if (!hasRecordNear(p)) continue;
    let count = 0;
    for (const f of floods) if (Math.abs(f[0] - p[0]) < 0.06 && haversineKm(p, f) <= FLOOD_RADIUS_KM) count += 1;
    hist[String(count)] = (hist[String(count)] ?? 0) + 1;
    kept += 1;
  }
  out[state] = { points: kept, hist };
  const zero = hist["0"] ?? 0;
  console.log(`${state}: ${kept} points, ${Math.round((100 * zero) / Math.max(1, kept))}% with no report within ${FLOOD_RADIUS_KM} km, max ${Math.max(...Object.keys(hist).map(Number))}`);
}

const file = {
  built: new Date().toISOString(),
  method:
    `For each state, ${POINTS} random points inside the area of its flood and tornado records, kept only if a record lies within ${NEAR_RECORD_KM} km (open water and empty country are left out). ` +
    `For each point we counted the distinct flood reports within ${FLOOD_RADIUS_KM} km. Reports are filed where people are, so this compares an address with places that have records around them, not with every square mile.`,
  radiusKm: FLOOD_RADIUS_KM,
  states: out,
};
writeFileSync(path.join(DATA, "quiet-percentiles.json"), `${JSON.stringify(file)}\n`);
console.log(`wrote data/quiet-percentiles.json (${Object.keys(out).length} states)`);
