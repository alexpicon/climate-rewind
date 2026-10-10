/**
 * Build-time snapshots for the sample addresses, and the caches for every other address. No network: every outside call is faked,
 * and a fake that is hit when it should not be fails the test.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/lookup/route";
import { buildFloodTrigger, clearRainCache, floodDates, shiftDate } from "@/lib/flood-trigger";
import { clearDataCaches, loadStateIndex } from "@/lib/index-store";
import { findNearbyFloods, lookupAddress, type LookupDeps } from "@/lib/lookup";
import { gridKey, LruCache, snapToGrid } from "@/lib/lru";
import { clearSnapshotCache, findSnapshot, isSnapshot, loadSampleSnapshots, SNAPSHOT_RADIUS_M, type SampleSnapshot } from "@/lib/samples";
import { clearHeatCache, fetchDailyFeelsLike } from "@/lib/sources";
import { PREPARED_ADDRESSES } from "@/lib/ui/prepared";
import { SAMPLE_ADDRESSES } from "@/lib/ui/tabs";
import { CENSUS_NASHVILLE, FEMA_ZONE_X, NASHVILLE, flood, heatYear, httpError, ok, openMeteoReply } from "./helpers";

const SHIPPED = path.join(process.cwd(), "data", "samples");
const NOW = new Date("2026-10-08T14:00:00Z");

const snapshot = (over: Partial<SampleSnapshot> = {}): SampleSnapshot => ({
  slug: "nashville",
  address: "100 James Robertson Pkwy, Nashville, TN",
  lat: NASHVILLE[0],
  lon: NASHVILLE[1],
  built: "2026-10-08T00:00:00Z",
  heat: {
    byYear: { "2012": 7 },
    hottest: { date: "2012-06-29", feelsF: 113.1 },
    worstWeek: { start: "2012-06-26", end: "2012-07-02", daily: [{ date: "2012-06-26", feelsF: 99 }, { date: "2012-06-29", feelsF: 113.1 }, { date: "2012-07-02", feelsF: 95 }] },
    source: "test",
  },
  rain: null,
  ...over,
});

describe("least-recently-used cache and the 0.05 degree cell", () => {
  it("drops the entry untouched the longest, and reading an entry keeps it", () => {
    const cache = new LruCache<number>(2, 1000);
    cache.set("a", 1, 0);
    cache.set("b", 2, 0);
    expect(cache.get("a", 1)).toBe(1); // a is now newer than b
    cache.set("c", 3, 2);
    expect(cache.get("b", 3)).toBeUndefined();
    expect(cache.get("a", 3)).toBe(1);
    expect(cache.get("c", 3)).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("forgets an entry after its time is up", () => {
    const cache = new LruCache<string>(5, 1000);
    cache.set("k", "v", 0);
    expect(cache.get("k", 999)).toBe("v");
    expect(cache.get("k", 1000)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("snaps to 0.05 degrees: points a few km apart share a key, points in the next cell do not", () => {
    expect(snapToGrid(36.168)).toBe(36.15);
    expect(snapToGrid(-86.777)).toBe(-86.8);
    expect(gridKey(36.168, -86.777).key).toBe("36.15,-86.80");
    expect(gridKey(36.171, -86.781).key).toBe("36.15,-86.80");
    expect(gridKey(36.19, -86.777).key).not.toBe("36.15,-86.80");
  });
});

describe("live data for any other address is cached by 0.05 degree cell", () => {
  beforeEach(() => {
    clearHeatCache();
    clearRainCache();
  });

  it("two addresses in one cell make one heat request, asked for the two highs it needs at the cell's centre", async () => {
    const urls: string[] = [];
    const fetchFn = async (url: string) => {
      urls.push(url);
      return ok(openMeteoReply(heatYear(2024, { "2024-07-10": 108 })));
    };
    const first = await fetchDailyFeelsLike(36.168, -86.777, fetchFn, () => NOW);
    const second = await fetchDailyFeelsLike(36.171, -86.781, fetchFn, () => NOW);
    expect(first.value).not.toBeNull();
    expect(second.value).toEqual(first.value);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("latitude=36.15&longitude=-86.80");
    expect(urls[0]).toContain("daily=apparent_temperature_max");
    // Only what the heat tab needs: the feels-like high and the air temperature high (it counts the higher of the two).
    expect(urls[0].match(/daily=([^&]*)/)?.[1]).toBe("apparent_temperature_max,temperature_2m_max");
  });

  it("a failure is not cached, and keeps the honest message (HTTP 429)", async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return calls === 1 ? httpError(429) : ok(openMeteoReply(heatYear(2024)));
    };
    const failed = await fetchDailyFeelsLike(36.168, -86.777, fetchFn, () => NOW);
    expect(failed.value).toBeNull();
    expect(failed.notice).toBe("The climate data service is busy right now. Try again in a minute.");
    const again = await fetchDailyFeelsLike(36.168, -86.777, fetchFn, () => NOW);
    expect(again.value).not.toBeNull();
    // 1: Open-Meteo 429, 2: the NASA POWER fallback (also failed here), 3: the retry, answered by Open-Meteo. Nothing failed was cached.
    expect(calls).toBe(3);
  });

  it("the rain history of a cell is reused for another address in it", async () => {
    const dates = ["2021-04-02", "2021-05-11", "2021-07-04"];
    const reports = dates.map((date, i) => flood({ id: `r${i}`, start: `${date}T22:55:00-05:00`, filed: [36.17, -86.78] }));
    const urls: string[] = [];
    const fetchFn = async (url: string) => {
      if (url.includes("archive-api")) {
        urls.push(url);
        const start = /start_date=([\d-]+)/.exec(url)![1];
        const end = /end_date=([\d-]+)/.exec(url)![1];
        const days: string[] = [];
        for (let ms = Date.parse(start); ms <= Date.parse(end); ms += 86_400_000) days.push(new Date(ms).toISOString().slice(0, 10));
        return ok({ daily: { time: days, precipitation_sum: days.map(() => 1) } });
      }
      return httpError(503); // forecast: not what this test is about
    };
    await buildFloodTrigger({ lat: 36.168, lon: -86.777 }, reports, { fetch: fetchFn, now: () => NOW });
    const firstCount = urls.length;
    await buildFloodTrigger({ lat: 36.171, lon: -86.781 }, reports, { fetch: fetchFn, now: () => NOW });
    expect(firstCount).toBeGreaterThan(0);
    expect(urls).toHaveLength(firstCount);
  });
});

describe("finding a snapshot", () => {
  it("uses it within 200 m of the sample and not beyond", () => {
    const snaps = [snapshot()];
    expect(SNAPSHOT_RADIUS_M).toBe(200);
    expect(findSnapshot(NASHVILLE[0], NASHVILLE[1], snaps)).toBe(snaps[0]);
    expect(findSnapshot(NASHVILLE[0] + 0.0015, NASHVILLE[1], snaps)).toBe(snaps[0]); // about 167 m north
    expect(findSnapshot(NASHVILLE[0] + 0.0025, NASHVILLE[1], snaps)).toBeNull(); // about 278 m north
    expect(findSnapshot(36.1, -86.7, snaps)).toBeNull();
    expect(findSnapshot(NASHVILLE[0], NASHVILLE[1], [])).toBeNull();
  });

  it("takes the closest when two are in range", () => {
    const near = snapshot({ slug: "near" });
    const far = snapshot({ slug: "far", lat: NASHVILLE[0] + 0.001 });
    expect(findSnapshot(NASHVILLE[0], NASHVILLE[1], [far, near])?.slug).toBe("near");
  });

  it("reads a folder of snapshots, skipping a malformed or misnamed file, and survives a missing folder", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samples-"));
    writeFileSync(path.join(dir, "nashville.json"), JSON.stringify(snapshot()));
    writeFileSync(path.join(dir, "broken.json"), "{ not json");
    writeFileSync(path.join(dir, "wrong-shape.json"), JSON.stringify({ slug: "x" }));
    writeFileSync(path.join(dir, "Notes.txt"), "hello");
    clearSnapshotCache();
    expect((await loadSampleSnapshots(dir)).map((s) => s.slug)).toEqual(["nashville"]);
    expect(await loadSampleSnapshots(path.join(dir, "nope"))).toEqual([]);
  });

  it("rejects a heat part with no days", () => {
    expect(isSnapshot(snapshot())).toBe(true);
    expect(isSnapshot(snapshot({ heat: { ...snapshot().heat!, worstWeek: { start: "a", end: "b", daily: [] } } }))).toBe(false);
  });
});

describe("the flood trigger with known rain", () => {
  const dates = ["2021-04-02", "2021-05-11", "2021-07-04"];
  const reports = dates.map((date, i) => flood({ id: `r${i}`, start: `${date}T22:55:00-05:00`, filed: [36.17, -86.78] }));
  const POINTS = { properties: { forecastGridData: "https://api.weather.gov/gridpoints/OHX/50,57", timeZone: "America/Chicago" } };
  const forecastOnly = (calls: string[]) => async (url: string) => {
    calls.push(url);
    if (url.includes("archive-api")) throw new Error("the archive must not be called when the snapshot covers every date");
    if (url.includes("/points/")) return ok(POINTS);
    return ok({ properties: { updateTime: "x", quantitativePrecipitation: { uom: "wmoUnit:mm", values: [{ validTime: "2026-10-09T05:00:00+00:00/P1D", value: 25.4 }] } } });
  };
  const known = { "2021-04-01": 0.5, "2021-04-02": 1, "2021-05-10": 0, "2021-05-11": 2, "2021-07-03": 1, "2021-07-04": 3 };

  beforeEach(() => clearRainCache());

  it("makes no Open-Meteo request when the snapshot covers every date the gauges did not (only NOAA is asked)", async () => {
    const calls: string[] = [];
    const trigger = await buildFloodTrigger({ lat: NASHVILLE[0], lon: NASHVILLE[1] }, reports, { fetch: forecastOnly(calls), now: () => NOW, knownRain: known });
    expect(trigger).toMatchObject({ status: "ready", triggerIn: 2 });
    expect(trigger.history.map((d) => d.rainIn)).toEqual([1, 2, 3]);
    expect(trigger.forecast?.peak.inches).toBe(1);
    expect(calls.some((url) => url.includes("open-meteo"))).toBe(false);
    expect(calls.every((url) => url.includes("api.weather.gov") || url.includes("ncei.noaa.gov"))).toBe(true);
  });

  it("a null day before is fine (a seeded value already includes it), a missing one is fetched live", async () => {
    const calls: string[] = [];
    const seeded = { "2021-04-02": 1, "2021-04-01": null, "2021-05-11": 2, "2021-05-10": null, "2021-07-04": 3, "2021-07-03": null };
    const trigger = await buildFloodTrigger({ lat: NASHVILLE[0], lon: NASHVILLE[1] }, reports, { fetch: forecastOnly(calls), now: () => NOW, knownRain: seeded });
    expect(trigger.history.map((d) => d.rainIn)).toEqual([1, 2, 3]);

    // One date not in the snapshot: only that date is asked of the archive, the others still come from the snapshot.
    const archiveUrls: string[] = [];
    const partial = { "2021-04-02": 1, "2021-04-01": 0, "2021-05-11": 2, "2021-05-10": 0 };
    const live = async (url: string) => {
      if (url.includes("archive-api")) {
        archiveUrls.push(url);
        return ok({ daily: { time: ["2021-07-03", "2021-07-04"], precipitation_sum: [0.2, 3] } });
      }
      return httpError(503);
    };
    clearRainCache();
    const mixed = await buildFloodTrigger({ lat: NASHVILLE[0], lon: NASHVILLE[1] }, reports, { fetch: live, now: () => NOW, knownRain: partial });
    expect(archiveUrls).toHaveLength(1);
    expect(archiveUrls[0]).toContain("start_date=2021-07-03&end_date=2021-07-04");
    expect(mixed.history.map((d) => d.rainIn)).toEqual([1, 2, 3]);
  });

  it("without a snapshot the archive failing is still shown honestly", async () => {
    const trigger = await buildFloodTrigger({ lat: NASHVILLE[0], lon: NASHVILLE[1] }, reports, { fetch: async () => httpError(429), now: () => NOW });
    expect(trigger.status).toBe("unavailable");
    expect(trigger.notices.history).toBe("The climate data service is busy right now. Try again in a minute.");
  });
});

describe("a lookup of a sample address", () => {
  const index = { state: "TN", built: "x", sources: [], floods: [2015, 2016, 2017].map((y, i) => flood({ id: `r${i}`, start: `${y}-04-02T22:55:00-05:00`, filed: [36.17, -86.78] })), tornadoes: [] };
  const rain = { byDate: { "2015-04-01": 0, "2015-04-02": 1, "2016-04-01": 0, "2016-04-02": 2, "2017-04-01": 0, "2017-04-02": 3 }, source: "test" };
  const deps = (calls: string[], snaps: SampleSnapshot[] | undefined, geocode = CENSUS_NASHVILLE): LookupDeps => ({
    fetch: async (url) => {
      calls.push(url);
      if (url.includes("geocoding.geo.census.gov")) return ok(geocode);
      if (url.includes("hazards.fema.gov")) return ok(FEMA_ZONE_X);
      if (url.includes("api.weather.gov/alerts")) return ok({ features: [] });
      if (url.includes("api.weather.gov")) return httpError(503);
      if (url.includes("archive-api.open-meteo.com")) return httpError(429); // a rate-limited day
      throw new Error(`unrouted URL in test: ${url}`);
    },
    loadIndex: async () => index,
    loadHeatGrid: async () => null,
    now: () => NOW,
    loadSnapshots: snaps ? async () => snaps : undefined,
  });

  beforeEach(() => {
    clearHeatCache();
    clearRainCache();
  });

  it("gets the heat summary and the rain history from the snapshot even while Open-Meteo says 429; alerts, FEMA and the forecast stay live", async () => {
    const calls: string[] = [];
    const payload = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", deps(calls, [snapshot({ rain })]));
    expect(payload.heat?.hottest).toEqual({ date: "2012-06-29", feelsF: 113.1 });
    expect(payload.heat?.worstWeek.start).toBe("2012-06-26");
    expect(payload.floodTrigger).toMatchObject({ status: "ready", triggerIn: 2 });
    expect(payload.notices.heat).toBeUndefined();
    // The only archive call left is the wettest and windiest days (no snapshot part for them in this fixture).
    expect(calls.some((url) => url.includes("archive-api") && !url.includes("wind_gusts_10m_max"))).toBe(false);
    expect(calls.some((url) => url.includes("hazards.fema.gov"))).toBe(true);
    expect(calls.some((url) => url.includes("api.weather.gov/alerts"))).toBe(true);
    expect(calls.some((url) => url.includes("api.weather.gov/points"))).toBe(true);
    expect(payload.floodTrigger.notices.forecast).toMatch(/503/); // the forecast is live, and says so when it is down
  });

  it("a heat-only snapshot still covers heat, and the rain stays live (and honest about a 429)", async () => {
    const calls: string[] = [];
    const payload = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", deps(calls, [snapshot()]));
    expect(payload.heat).not.toBeNull();
    expect(payload.floodTrigger.status).toBe("unavailable");
    expect(payload.floodTrigger.notices.history).toBe("The climate data service is busy right now. Try again in a minute.");
  });

  it("an address 1 km away is not a sample: it is live, and the honest 429 shows", async () => {
    const calls: string[] = [];
    const elsewhere = { result: { addressMatches: [{ ...CENSUS_NASHVILLE.result.addressMatches[0], coordinates: { x: NASHVILLE[1], y: NASHVILLE[0] + 0.01 } }] } };
    const payload = await lookupAddress("somewhere else", deps(calls, [snapshot({ rain })], elsewhere));
    expect(payload.heat).toBeNull();
    expect(payload.notices.heat).toBe("The climate data service is busy right now. Try again in a minute.");
    expect(calls.some((url) => url.includes("archive-api"))).toBe(true);
  });

  it("a snapshot loader that fails is the same as no snapshot", async () => {
    const calls: string[] = [];
    const broken = deps(calls, []);
    const payload = await lookupAddress("x", { ...broken, loadSnapshots: async () => Promise.reject(new Error("disk")) });
    expect(payload.heat).toBeNull();
    expect(payload.address.state).toBe("TN");
  });
});

describe("the snapshots that ship in data/samples", () => {
  const files = readdirSync(SHIPPED).filter((f) => f.endsWith(".json"));
  const read = (name: string) => JSON.parse(readFileSync(path.join(SHIPPED, name), "utf8")) as SampleSnapshot;

  it("there is one for each prepared address (the samples and the landing page's moments), and each is well formed", () => {
    expect(files.sort()).toEqual(["asheville.json", "bellevue.json", "flushing.json", "fort-myers.json", "lahaina.json", "mayfield.json", "nashville.json", "portland.json", "rolling-fork.json", "san-antonio.json"]);
    expect(SAMPLE_ADDRESSES).toHaveLength(4);
    for (const file of files) expect(isSnapshot(read(file)), file).toBe(true);
  });

  it("the prepared addresses are the ones in the files", () => {
    const addresses = files.map((f) => read(f).address).sort();
    expect(addresses).toEqual(PREPARED_ADDRESSES.map((s) => s.address).sort());
  });

  it("every heat part is captured, and where a regional grid ships, its week is the grid's week", async () => {
    for (const file of files) {
      const snap = read(file);
      expect(snap.heat, `${file} heat`).not.toBeNull();
      expect(snap.heat!.worstWeek.daily).toHaveLength(7);
      const gridFile = path.join("data", "heat", `${snap.slug}.json`);
      if (!existsSync(gridFile)) continue;
      const grid = JSON.parse(readFileSync(gridFile, "utf8")) as { days: string[] };
      expect(snap.heat!.worstWeek.start, file).toBe(grid.days[0]);
      expect(snap.heat!.worstWeek.end, file).toBe(grid.days[grid.days.length - 1]);
      expect(snap.heat!.worstWeek.daily).toHaveLength(7);
      expect(snap.heat!.worstWeek.daily.map((d) => d.date)).toContain(snap.heat!.hottest.date);
    }
  });

  it("Bellevue's hottest day is Jun 28, 2021, 114.7 F feels-like (a day, not a week), above its 107.7 F air temperature", () => {
    const heat = read("bellevue.json").heat!;
    expect(heat.hottest).toEqual({ date: "2021-06-28", feelsF: 114.7, airF: 107.7 });
  });

  it("each snapshot's rain covers every flood date within 5 km of its address, from today's index (a stale snapshot fails here)", async () => {
    clearDataCaches();
    for (const file of files) {
      const snap = read(file);
      const index = await loadStateIndex(snap.address.slice(-2));
      expect(index, file).not.toBeNull();
      const dates = floodDates(findNearbyFloods(index!.floods, [snap.lat, snap.lon]).reports);
      if (dates.length < 3) {
        expect(snap.rain, `${file}: fewer than 3 flood dates needs no rain`).toBeNull();
        continue;
      }
      if (!snap.rain) continue; // not captured yet: the lookup falls back to the live archive; the script says so
      for (const date of dates) {
        expect(Object.hasOwn(snap.rain.byDate, date), `${file} ${date}`).toBe(true);
        expect(Object.hasOwn(snap.rain.byDate, shiftDate(date, -1)), `${file} ${shiftDate(date, -1)}`).toBe(true);
      }
    }
  });
});

describe("the real /api/lookup route reading the shipped snapshots", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    clearSnapshotCache();
    clearHeatCache();
    clearRainCache();
    clearDataCaches();
  });

  it("Bellevue: heat from the snapshot, 2 flood reports and an honest 'not enough history', while Open-Meteo is rate limited", async () => {
    vi.stubEnv("MEMORIA_SAMPLES_DIR", SHIPPED);
    clearSnapshotCache();
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("geocoding.geo.census.gov"))
        return ok({
          result: { addressMatches: [{ matchedAddress: "450 110TH AVE NE, BELLEVUE, WA, 98004", coordinates: { x: -122.193518, y: 47.614205 }, addressComponents: { state: "WA", city: "BELLEVUE" }, geographies: { Counties: [{ NAME: "King County" }] } }] },
        });
      if (url.includes("hazards.fema.gov")) return ok(FEMA_ZONE_X);
      if (url.includes("api.weather.gov")) return ok({ features: [] });
      if (url.includes("archive-api.open-meteo.com")) return httpError(429);
      throw new Error(`unrouted URL: ${url}`);
    });
    const response = await GET(new Request("http://x/api/lookup?address=" + encodeURIComponent("450 110th Ave NE, Bellevue, WA")));
    const body = (await response.json()) as import("@/lib/types").LookupPayload;
    expect(response.status).toBe(200);
    expect(body.coverage).toBe("indexed");
    expect(body.heat?.hottest).toEqual({ date: "2021-06-28", feelsF: 114.7, airF: 107.7 });
    expect(body.heat?.worstWeek).toMatchObject({ start: "2021-06-25", end: "2021-07-01" });
    expect(body.heat?.regionalSlug).toBe("bellevue");
    expect(body.floodTrigger).toMatchObject({ status: "insufficient", floodDays: 1 });
    expect(body.floods.reports).toHaveLength(2);
    expect(body.tornadoes).toEqual([]);
    // Heat and rain come from the snapshot; only the wettest and windiest days are asked of the archive until the snapshot holds them.
    expect(urls.some((url) => url.includes("archive-api") && !url.includes("wind_gusts_10m_max"))).toBe(false);
  });
});
