/**
 * Writes data/samples/<slug>.json for every prepared address (the samples and the landing page's moments, lib/ui/prepared.ts): the heat summary (26 years of daily feels-like highs) and the rain
 * on each flood date within 5 km, both from the Open-Meteo archive. The app reads these instead of calling Open-Meteo for the
 * samples (lib/samples.ts), so a judge clicking them over and over cannot use up the free daily allowance.
 *
 *   npm run snapshot-samples
 *   npm run snapshot-samples -- --only nashville --refresh
 *   npm run snapshot-samples -- --heat-cache ../memoria-pipeline/raw/heat --rain-seed /tmp/ft-nashville.json
 *
 * Safe to run again: a part that is already complete is kept (use --refresh to fetch it again). When Open-Meteo answers 429,
 * a per-minute or per-hour limit is retried with a growing wait; a "daily limit" answer stops that part at once (the allowance
 * resets at 00:00 UTC) and the run says so and exits 1. Parts that could not be fetched stay as they were.
 *
 * Fallbacks, used only when the live call fails, and named in the file's `source`:
 *   --heat-cache <dirs>  comma-separated folders holding point_<slug>_2000-<last year>.json from pipeline/heat_grid.py (the same archive request, saved earlier)
 *   --rain-seed <file>   a floodTrigger JSON from a live /api/lookup (its history values are already the larger of a day and the
 *                        day before); only for the address named by --only
 *
 * Needs Node 22.7 or newer. Run from the repo root.
 */
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";

// The lib files import each other without ".ts"; this lets Node resolve them (the app itself is bundled, so it never needs this).
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, next) {
      if ((s.startsWith("./") || s.startsWith("../")) && !/\\.[cm]?[jt]s$|\\.json$/.test(s)) { try { return await next(s + ".ts", c); } catch {} }
      return next(s, c);
    }`),
);

const { PREPARED_ADDRESSES } = await import("../lib/ui/prepared.ts");
const { geocodeAddress, heatArchiveUrl, heatDaysFromArchive } = await import("../lib/sources.ts");
const { floodDates, rainArchiveUrl, rainFromArchive, rainRanges, shiftDate } = await import("../lib/flood-trigger.ts");
const { findNearbyFloods, summarizeHeat } = await import("../lib/lookup.ts");
const { extremesArchiveUrl, extremesFromArchive } = await import("../lib/extremes.ts");
const { loadStateIndex, slugify } = await import("../lib/index-store.ts");
type SampleSnapshot = import("../lib/samples.ts").SampleSnapshot;
const { MIN_FLOOD_DAYS } = await import("../lib/flood-trigger.ts");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const OUT_DIR = path.join(process.cwd(), "data", "samples");
const only = arg("only");
const refresh = flag("refresh");
const heatCacheDirs = (arg("heat-cache") ?? "").split(",").filter(Boolean);
const rainSeedFile = arg("rain-seed");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const asFetch = (url: string, init?: RequestInit) => fetch(url, init);

class DailyLimit extends Error {}

/** GET JSON from Open-Meteo. Per-minute and per-hour limits are waited out; a daily limit throws DailyLimit at once. */
async function archiveJson<T>(url: string, label: string): Promise<T> {
  const waits = [5, 20, 60, 120, 240];
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    } catch (error) {
      if (attempt >= waits.length) throw new Error(`${label}: ${String(error)}`);
      await sleep(waits[attempt] * 1000);
      continue;
    }
    if (response.ok) return (await response.json()) as T;
    const body = await response.text();
    if (/daily/i.test(body)) throw new DailyLimit(`${label}: ${body.slice(0, 120)}`);
    if ((response.status === 429 || response.status >= 500) && attempt < waits.length) {
      console.log(`  ${label}: HTTP ${response.status}, waiting ${waits[attempt]} s`);
      await sleep(waits[attempt] * 1000);
      continue;
    }
    throw new Error(`${label}: HTTP ${response.status} ${body.slice(0, 120)}`);
  }
}

const rainCovers = (snapshot: SampleSnapshot | null, dates: string[]) =>
  Boolean(snapshot?.rain && !snapshot.rain.seeded && dates.every((d) => Object.hasOwn(snapshot.rain!.byDate, d) && Object.hasOwn(snapshot.rain!.byDate, shiftDate(d, -1))));

let incomplete = 0;
for (const sample of PREPARED_ADDRESSES) {
  const address = await geocodeAddress(sample.address, asFetch);
  const slug = slugify(address.city ?? sample.label);
  if (only && only !== slug) continue;
  console.log(`\n${slug}: ${address.matched} (${address.lat.toFixed(5)}, ${address.lon.toFixed(5)})`);

  const file = path.join(OUT_DIR, `${slug}.json`);
  const existing: SampleSnapshot | null = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as SampleSnapshot) : null;
  const snapshot: SampleSnapshot = {
    slug,
    address: sample.address,
    lat: address.lat,
    lon: address.lon,
    built: new Date().toISOString(),
    heat: existing?.heat ?? null,
    rain: existing?.rain ?? null,
    extremes: existing?.extremes ?? null,
  };

  // ---- heat
  const lastYear = new Date().getUTCFullYear() - 1;
  if (snapshot.heat && !refresh) {
    console.log("  heat: kept");
  } else {
    try {
      const data = await archiveJson<Parameters<typeof heatDaysFromArchive>[0]>(heatArchiveUrl(address.lat, address.lon, lastYear), "heat");
      const summary = summarizeHeat(heatDaysFromArchive(data));
      if (!summary) throw new Error("no temperature data");
      snapshot.heat = { byYear: summary.byYear, hottest: summary.hottest, worstWeek: summary.worstWeek, source: `Open-Meteo archive, daily apparent_temperature_max, 2000-${lastYear}, fetched ${snapshot.built}` };
      console.log(`  heat: fetched, hottest ${summary.hottest.date} ${summary.hottest.feelsF} F`);
    } catch (error) {
      const cached = heatCacheDirs.map((dir) => path.join(dir, `point_${slug}_2000-${lastYear}.json`)).find((candidate) => existsSync(candidate)) ?? null;
      if (cached) {
        const summary = summarizeHeat(heatDaysFromArchive(JSON.parse(readFileSync(cached, "utf8"))));
        if (!summary) throw error;
        snapshot.heat = { byYear: summary.byYear, hottest: summary.hottest, worstWeek: summary.worstWeek, source: `Open-Meteo archive, daily apparent_temperature_max, 2000-${lastYear}, from the pipeline's saved copy of the same request (${path.basename(cached)})` };
        console.log(`  heat: live failed (${(error as Error).message.slice(0, 80)}); used ${cached}, hottest ${summary.hottest.date} ${summary.hottest.feelsF} F`);
      } else {
        console.log(`  heat: NOT captured (${(error as Error).message})`);
        incomplete += 1;
      }
    }
  }

  // ---- wettest and windiest days (the address-extremes card)
  if (snapshot.extremes && !refresh) {
    console.log("  extremes: kept");
  } else {
    try {
      const found = extremesFromArchive(await archiveJson<Parameters<typeof extremesFromArchive>[0]>(extremesArchiveUrl(address.lat, address.lon, lastYear), "extremes"));
      if (!found) throw new Error("no rain or wind data");
      snapshot.extremes = { wettest: found.wettest, windiest: found.windiest, source: `Open-Meteo archive, daily precipitation_sum and wind_gusts_10m_max, 2000-${lastYear}, fetched ${snapshot.built}` };
      console.log(`  extremes: fetched, wettest ${found.wettest?.date} ${found.wettest?.inches} in, windiest ${found.windiest?.date} ${found.windiest?.mph} mph`);
    } catch (error) {
      console.log(`  extremes: NOT captured (${(error as Error).message})`);
      incomplete += 1;
    }
  }

  // ---- rain on the flood dates
  const index = await loadStateIndex(address.state);
  const dates = index ? floodDates(findNearbyFloods(index.floods, [address.lat, address.lon]).reports) : [];
  if (dates.length < MIN_FLOOD_DAYS) {
    snapshot.rain = null;
    console.log(`  rain: not needed (${dates.length} flood date${dates.length === 1 ? "" : "s"} within 5 km; the trigger needs ${MIN_FLOOD_DAYS})`);
  } else if (rainCovers(snapshot, dates) && !refresh) {
    console.log(`  rain: kept (${dates.length} flood dates)`);
  } else {
    try {
      const byDate: Record<string, number | null> = {};
      for (const range of rainRanges(dates)) {
        const data = await archiveJson<Parameters<typeof rainFromArchive>[0]>(rainArchiveUrl(address.lat, address.lon, range.start, range.end), `rain ${range.start}..${range.end}`);
        for (const [date, inches] of rainFromArchive(data)) byDate[date] = inches;
      }
      snapshot.rain = { byDate, source: `Open-Meteo archive (ERA5), daily precipitation_sum in inches, for ${dates.length} flood dates and the day before each, fetched ${snapshot.built}` };
      console.log(`  rain: fetched for ${dates.length} flood dates`);
    } catch (error) {
      const seeded = rainSeedFile && only === slug ? (JSON.parse(readFileSync(rainSeedFile, "utf8")) as { history?: Array<{ date: string; rainIn: number }> }) : null;
      const history = new Map((seeded?.history ?? []).map((day) => [day.date, day.rainIn]));
      if (seeded && dates.every((d) => history.has(d))) {
        const byDate: Record<string, number | null> = {};
        for (const date of dates) {
          byDate[date] = history.get(date) as number;
          byDate[shiftDate(date, -1)] ??= null; // the day before is already folded into the value above
        }
        snapshot.rain = {
          byDate,
          seeded: true,
          source: `Open-Meteo archive (ERA5) rain on ${dates.length} flood dates, copied from a live /api/lookup answer (each value is already the larger of the day and the day before); run npm run snapshot-samples again when Open-Meteo is available to replace it with the day-by-day totals`,
        };
        console.log(`  rain: live failed (${(error as Error).message.slice(0, 80)}); seeded from ${rainSeedFile}`);
      } else {
        console.log(`  rain: NOT captured (${(error as Error).message})`);
        incomplete += 1;
      }
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(file, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(`  wrote ${path.relative(process.cwd(), file)}`);
}

if (incomplete > 0) {
  console.log(`\n${incomplete} part${incomplete === 1 ? "" : "s"} not captured. If it said "daily limit", run this again after 00:00 UTC; finished parts are kept.`);
  process.exit(1);
}
console.log("\nAll samples are complete.");
