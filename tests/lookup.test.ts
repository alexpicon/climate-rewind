import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDataCaches, loadHeatGrid, loadStateIndex } from "@/lib/index-store";
import {
  findNearbyFloods,
  findNearbyTornadoes,
  gridMatchesWeek,
  lookupAddress,
  selectReplayNight,
  summarizeHeat,
  tierOf,
  type LookupDeps,
} from "@/lib/lookup";
import { LookupError, clearHeatCache, fetchDailyFeelsLike, geocodeAddress } from "@/lib/sources";
import type { Detective, FloodRow, StateIndex } from "@/lib/types";
import {
  CENSUS_NASHVILLE,
  FEMA_ZONE_X,
  NASHVILLE,
  NO_ALERTS,
  fakeFetch,
  flood,
  hang,
  heatYear,
  httpError,
  ok,
  openMeteoReply,
  tornado,
} from "./helpers";

const placedDetective = (matchType: Detective["matchType"]): Detective => ({
  verdict: "placed",
  clues: ["Rosa Parks Blvd"],
  match: "ROSA L PARKS BLVD, NASHVILLE, TN",
  matchType,
  confidence: "high",
  model: "test",
  ranAt: "2026-10-07T00:00:00Z",
});

// ---------------------------------------------------------------- tiers and the 5 km filter

describe("tierOf", () => {
  it("is 'mentioned' when the detective placed it from an address or intersection", () => {
    expect(tierOf(flood({ id: "a", coordPrecision: "placeholder", detective: placedDetective("address") }))).toBe("mentioned");
    expect(tierOf(flood({ id: "b", coordPrecision: "placeholder", detective: placedDetective("intersection") }))).toBe("mentioned");
  });

  it("does not count a named-area placement as 'mentioned'", () => {
    expect(tierOf(flood({ id: "c", coordPrecision: "placeholder", detective: placedDetective("named_area") }))).toBe("citywide");
  });

  it("is 'about1km' for precise or rounded NWS coordinates", () => {
    expect(tierOf(flood({ id: "d", coordPrecision: "precise" }))).toBe("about1km");
    expect(tierOf(flood({ id: "e", coordPrecision: "rounded" }))).toBe("about1km");
  });

  it("is 'citywide' for placeholders and missing coordinates with no placement", () => {
    expect(tierOf(flood({ id: "f", coordPrecision: "placeholder" }))).toBe("citywide");
    expect(tierOf(flood({ id: "g", coordPrecision: "none", filed: null }))).toBe("citywide");
  });

  it("ignores a detective that said 'unknown'", () => {
    const unknown: Detective = { ...placedDetective(null), verdict: "unknown", match: null };
    expect(tierOf(flood({ id: "h", coordPrecision: "rounded", detective: unknown }))).toBe("about1km");
  });
});

describe("findNearbyFloods", () => {
  it("keeps reports within 5 km and drops the rest", () => {
    const floods = [
      flood({ id: "near", filed: [36.17, -86.78] }), // ~0.3 km
      flood({ id: "edge", filed: [36.21, -86.7775] }), // ~4.6 km north
      flood({ id: "far", filed: [36.23, -86.7775] }), // ~6.9 km north
    ];
    const { reports } = findNearbyFloods(floods, NASHVILLE);
    expect(reports.map((r) => r.id)).toEqual(["near", "edge"]);
  });

  it("uses the detective's placed point instead of the filed point when there is one", () => {
    const moved = flood({
      id: "moved",
      filed: [36.17, -86.78], // filed right at the address...
      placed: [36.08, -86.7], // ...but the words name a street ~12 km away
      coordPrecision: "placeholder",
      detective: placedDetective("address"),
    });
    const pulledIn = flood({ id: "pulled", filed: [36.4, -86.2], placed: [36.168, -86.777], coordPrecision: "placeholder" });
    const { reports } = findNearbyFloods([moved, pulledIn], NASHVILLE);
    expect(reports.map((r) => r.id)).toEqual(["pulled"]);
  });

  it("attaches distance and tier, sorted nearest first, and counts the tiers", () => {
    const floods = [
      flood({ id: "b", filed: [36.19, -86.777], coordPrecision: "precise" }),
      flood({ id: "a", filed: [36.17, -86.78], coordPrecision: "placeholder" }),
      flood({ id: "c", filed: [36.17, -86.7776], placed: [36.1685, -86.7776], coordPrecision: "placeholder", detective: placedDetective("address") }),
    ];
    const { reports, tierCounts } = findNearbyFloods(floods, NASHVILLE);
    expect(reports.map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(reports[0].tier).toBe("mentioned");
    expect(reports[1].distanceKm).toBeCloseTo(0.28, 1);
    expect(tierCounts).toEqual({ mentioned: 1, about1km: 1, citywide: 1 });
  });

  it("skips duplicates and rows with no usable point", () => {
    const floods = [
      flood({ id: "dup", dupOf: "SE-1" }),
      flood({ id: "nowhere", filed: null, coordPrecision: "none" }),
      flood({ id: "real" }),
    ];
    expect(findNearbyFloods(floods, NASHVILLE).reports.map((r) => r.id)).toEqual(["real"]);
  });
});

// ---------------------------------------------------------------- replay night

describe("selectReplayNight", () => {
  it("returns null when nothing was reported within 15 km", () => {
    const far = flood({ id: "far", filed: [35.74, -86.92] }); // ~48 km away
    expect(selectReplayNight([far], NASHVILLE)).toBeNull();
    expect(selectReplayNight([], NASHVILLE)).toBeNull();
  });

  it("picks the night with the most reports within 15 km", () => {
    const busy = ["22:50", "23:10", "23:40"].map((t, i) => flood({ id: `busy-${i}`, start: `2021-03-27T${t}:00-05:00` }));
    const quiet = ["2019-02-23T10:00:00-06:00", "2019-02-23T11:00:00-06:00"].map((start, i) => flood({ id: `quiet-${i}`, start }));
    const replay = selectReplayNight([...quiet, ...busy], NASHVILLE);
    expect(replay?.reportIds.sort()).toEqual(["busy-0", "busy-1", "busy-2"]);
    expect(replay?.date).toBe("2021-03-27");
  });

  it("keeps a night that crosses midnight together", () => {
    const night = [
      flood({ id: "late", start: "2021-03-27T23:30:00-05:00" }),
      flood({ id: "after-midnight", start: "2021-03-28T00:40:00-05:00" }),
      flood({ id: "one-am", start: "2021-03-28T01:10:00-05:00" }),
    ];
    const other = [flood({ id: "elsewhere", start: "2020-05-01T12:00:00-05:00" })];
    const replay = selectReplayNight([...other, ...night], NASHVILLE);
    expect(replay?.reportIds).toHaveLength(3);
    expect(replay?.date).toBe("2021-03-27"); // the local date the night began
  });

  it("prefers the earlier night on a tie", () => {
    const later = flood({ id: "later", start: "2022-06-01T12:00:00-05:00" });
    const earlier = flood({ id: "earlier", start: "2020-06-01T12:00:00-05:00" });
    expect(selectReplayNight([later, earlier], NASHVILLE)?.reportIds).toEqual(["earlier"]);
  });

  it("builds a 5-minute-aligned radar window padded around the reports", () => {
    const replay = selectReplayNight(
      [
        flood({ id: "x", start: "2021-03-27T22:55:00-05:00" }), // 03:55Z
        flood({ id: "y", start: "2021-03-28T00:50:00-05:00" }), // 05:50Z
      ],
      NASHVILLE,
    );
    expect(replay?.startUtc).toBe("2021-03-28T02:25:00.000Z"); // 03:55Z minus 90 minutes
    expect(replay?.endUtc).toBe("2021-03-28T07:20:00.000Z"); // 05:50Z plus 90 minutes
    expect(replay?.frameMinutes).toBe(5);
    const minutes = (Date.parse(replay!.endUtc) - Date.parse(replay!.startUtc)) / 60_000;
    expect(minutes % 5).toBe(0);
  });

  it("never lets the window run longer than 7 hours, and never cuts the reports that define the night", () => {
    const spread = ["2021-03-27T12:00:00-05:00", "2021-03-27T15:00:00-05:00", "2021-03-27T17:30:00-05:00"].map((start, i) =>
      flood({ id: `s${i}`, start }),
    );
    const replay = selectReplayNight(spread, NASHVILLE)!;
    const window = Date.parse(replay.endUtc) - Date.parse(replay.startUtc);
    expect(window).toBeLessThanOrEqual(7 * 3_600_000);
    expect(replay.reportIds).toHaveLength(3);
    expect(replay.reports.map((r) => r.id)).toEqual(["s0", "s1", "s2"]); // all three fall inside the window
  });

  it("lists regional reports in the window for the map, but not duplicates or reports far outside the box", () => {
    const replay = selectReplayNight(
      [
        flood({ id: "home", start: "2021-03-27T22:55:00-05:00" }),
        flood({ id: "regional", start: "2021-03-27T23:20:00-05:00", filed: [35.74, -86.92] }), // ~48 km away
        flood({ id: "dup", start: "2021-03-27T23:21:00-05:00", dupOf: "SE-9" }),
        flood({ id: "too-far", start: "2021-03-27T23:22:00-05:00", filed: [33.0, -86.9] }), // ~350 km
        flood({ id: "wrong-time", start: "2021-03-25T23:20:00-05:00", filed: [35.74, -86.92] }),
      ],
      NASHVILLE,
    );
    expect(replay?.reports.map((r) => r.id)).toEqual(["home", "regional"]);
    expect(replay?.reportIds).toEqual(["home"]);
    expect(replay?.bounds[0]).toBeLessThan(NASHVILLE[1]);
  });
});

// ---------------------------------------------------------------- tornadoes

describe("findNearbyTornadoes", () => {
  it("measures to the track segment, not just its end points", () => {
    // Both ends are ~16 km from the address, but the track passes ~0.5 km north of it.
    const passing = tornado({ id: "passing", begin: [36.1727, -86.95], end: [36.1727, -86.6] });
    const [hit] = findNearbyTornadoes([passing], NASHVILLE);
    expect(hit.minDistanceKm).toBeLessThan(1);
    expect(hit.closest[1]).toBeCloseTo(NASHVILLE[1], 2);
  });

  it("drops tornadoes farther than 10 km and sorts the rest by date", () => {
    const list = [
      tornado({ id: "new", start: "2023-12-09T16:39:00-06:00", begin: [36.2, -86.8], end: [36.2, -86.7] }),
      tornado({ id: "far", begin: [36.4, -86.9], end: [36.4, -86.7] }), // ~26 km north
      tornado({ id: "old", start: "2000-02-13T18:04:00-06:00", begin: [36.15, -86.87], end: [36.15, -86.8] }),
    ];
    expect(findNearbyTornadoes(list, NASHVILLE).map((t) => t.id)).toEqual(["old", "new"]);
  });
});

// ---------------------------------------------------------------- heat

describe("summarizeHeat", () => {
  const days = heatYear(2012, { "2012-06-28": 104, "2012-06-29": 113.14, "2012-06-30": 110, "2012-01-03": 101 }).concat(
    heatYear(2013, { "2013-07-01": 100 }),
  );

  it("counts days at or above 100 F per year", () => {
    const { byYear } = summarizeHeat(days)!;
    expect(byYear["2012"]).toBe(4);
    expect(byYear["2013"]).toBe(1);
  });

  it("finds the hottest day and the week centred on it", () => {
    const heat = summarizeHeat(days)!;
    expect(heat.hottest).toEqual({ date: "2012-06-29", feelsF: 113.1 });
    expect(heat.worstWeek.start).toBe("2012-06-26");
    expect(heat.worstWeek.end).toBe("2012-07-02");
    expect(heat.worstWeek.daily).toHaveLength(7);
    expect(heat.worstWeek.daily[3]).toEqual({ date: "2012-06-29", feelsF: 113.1 });
  });

  it("shifts the week inward when the hottest day is at the start of the record", () => {
    const heat = summarizeHeat(heatYear(2000, { "2000-01-01": 120 }))!;
    expect(heat.worstWeek.start).toBe("2000-01-01");
    expect(heat.worstWeek.daily).toHaveLength(7);
  });

  it("returns null for no data", () => {
    expect(summarizeHeat([])).toBeNull();
  });
});

describe("gridMatchesWeek", () => {
  const grid = { days: ["2012-06-26", "2012-07-02"] } as Parameters<typeof gridMatchesWeek>[0];
  it("only matches the same week", () => {
    expect(gridMatchesWeek(grid, { start: "2012-06-26", end: "2012-07-02", daily: [] })).toBe(true);
    expect(gridMatchesWeek(grid, { start: "2010-08-01", end: "2010-08-07", daily: [] })).toBe(false);
  });
});

// ---------------------------------------------------------------- geocoder

describe("geocodeAddress", () => {
  it("returns the matched address, coordinates, state and county", async () => {
    const address = await geocodeAddress("100 James Robertson Pkwy, Nashville, TN", fakeFetch({ census: () => ok(CENSUS_NASHVILLE) }));
    expect(address).toMatchObject({ state: "TN", county: "Davidson", city: "NASHVILLE", lat: NASHVILLE[0], lon: NASHVILLE[1] });
  });

  it("answers 404 with a clear message when there is no street-address match", async () => {
    const fetchFn = fakeFetch({ census: () => ok({ result: { addressMatches: [] } }) });
    await expect(geocodeAddress("Nashville, TN", fetchFn)).rejects.toMatchObject({ status: 404 });
    await expect(geocodeAddress("Nashville, TN", fetchFn)).rejects.toThrow(/street address/);
  });

  it("answers 400 for an empty or very long address without calling the Census", async () => {
    const fetchFn = fakeFetch({}); // any request would throw
    await expect(geocodeAddress("   ", fetchFn)).rejects.toMatchObject({ status: 400 });
    await expect(geocodeAddress("x".repeat(500), fetchFn)).rejects.toMatchObject({ status: 400 });
  });

  it("answers 502 when the Census is down", async () => {
    await expect(geocodeAddress("1 Main St", fakeFetch({ census: () => httpError(503) }))).rejects.toMatchObject({ status: 502 });
  });
});

describe("fetchDailyFeelsLike", () => {
  beforeEach(() => clearHeatCache());

  it("asks Open-Meteo once for repeat lookups of the same spot", async () => {
    let calls = 0;
    const fetchFn = fakeFetch({ meteo: () => (calls += 1, ok(openMeteoReply(heatYear(2024)))) });
    const now = () => new Date("2026-10-07T20:00:00Z");
    const first = await fetchDailyFeelsLike(36.1682, -86.7712, fetchFn, now);
    const second = await fetchDailyFeelsLike(36.1683, -86.7713, fetchFn, now);
    expect(calls).toBe(1);
    expect(second.value).toEqual(first.value);
  });

  it("does not cache a failure", async () => {
    let calls = 0;
    const fetchFn = fakeFetch({ meteo: () => (calls += 1, httpError(429)) });
    await fetchDailyFeelsLike(36.1, -86.7, fetchFn);
    await fetchDailyFeelsLike(36.1, -86.7, fetchFn);
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------- the whole lookup

const emptyIndex = (overrides: Partial<StateIndex> = {}): StateIndex => ({
  state: "TN",
  built: "2026-10-07T00:00:00Z",
  sources: [],
  floods: [],
  tornadoes: [],
  ...overrides,
});

const baseRoutes = {
  census: () => ok(CENSUS_NASHVILLE),
  fema: () => ok(FEMA_ZONE_X),
  nws: () => ok(NO_ALERTS),
  meteo: () => ok(openMeteoReply(heatYear(2024, { "2024-07-10": 108 }))),
};

const makeDeps = (routes: Parameters<typeof fakeFetch>[0], index: StateIndex | null = emptyIndex()): LookupDeps => ({
  fetch: fakeFetch({ ...baseRoutes, ...routes }),
  loadIndex: async () => index,
  loadHeatGrid: async () => null,
  now: () => new Date("2026-10-07T20:00:00Z"),
});

describe("lookupAddress", () => {
  beforeEach(() => clearHeatCache());

  it("returns the contract payload when everything answers", async () => {
    const index = emptyIndex({
      floods: [flood({ id: "f1", filed: [36.17, -86.78], coordPrecision: "placeholder" })],
      tornadoes: [tornado({ id: "t1", begin: [36.17, -86.9], end: [36.17, -86.7] })],
    });
    const payload = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", makeDeps({}, index));

    expect(payload.address.matched).toBe("100 JAMES ROBERTSON PKWY, NASHVILLE, TN, 37201");
    expect(payload.fema).toEqual({ zone: "X", subtype: "AREA OF MINIMAL FLOOD HAZARD", sfha: false });
    expect(payload.live).toEqual({ checkedAt: "2026-10-07T20:00:00.000Z", alerts: [] });
    expect(payload.floods.reports).toHaveLength(1);
    expect(payload.floods.tierCounts.citywide).toBe(1);
    expect(payload.stormReplay?.reportIds).toEqual(["f1"]);
    expect(payload.tornadoes).toHaveLength(1);
    expect(payload.heat?.hottest.feelsF).toBe(108);
    expect(payload.coverage).toBe("indexed");
    // This fake archive has no rain or wind columns, so the extremes say so; nothing else has a notice.
    expect(payload.notices).toEqual({ extremes: expect.stringContaining("Open-Meteo") });
    expect(payload.extremes).toMatchObject({ wettest: null, windiest: null, hottest: { feelsF: 108 } });
  });

  it("returns real alert details, motion and polygon when the NWS has an active alert", async () => {
    const polygon = { type: "Polygon", coordinates: [[[-87, 36], [-86, 36], [-86, 37], [-87, 36]]] };
    const nws = () =>
      ok({
        features: [
          {
            id: "urn:alert:1",
            geometry: polygon,
            properties: {
              event: "Severe Thunderstorm Warning",
              headline: "Severe Thunderstorm Warning issued...",
              ends: "2026-10-07T21:00:00-05:00",
              severity: "Severe",
              urgency: "Immediate",
              parameters: { eventMotionDescription: ["2026-10-08T02:00:00Z...storm...262DEG...28KT...36.15,-86.9"] },
            },
          },
        ],
      });
    const payload = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", makeDeps({ nws }));
    expect(payload.live?.alerts).toHaveLength(1);
    expect(payload.live?.alerts[0]).toMatchObject({
      event: "Severe Thunderstorm Warning",
      ends: "2026-10-07T21:00:00-05:00",
      polygon,
      motion: expect.stringContaining("262DEG"),
    });
  });

  it("says so when the state has not been indexed: empty floods and tornadoes, 'not yet indexed'", async () => {
    const payload = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", makeDeps({}, null));
    expect(payload.coverage).toBe("not yet indexed");
    expect(payload.floods).toEqual({ reports: [], tierCounts: { mentioned: 0, about1km: 0, citywide: 0 } });
    expect(payload.stormReplay).toBeNull();
    expect(payload.tornadoes).toEqual([]);
    expect(payload.notices.index).toMatch(/not indexed/);
    expect(payload.fema).not.toBeNull(); // live sources still work
  });

  it("marks a fixture index as such", async () => {
    const payload = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", makeDeps({}, emptyIndex({ fixture: true })));
    expect(payload.coverage).toBe("fixture");
    expect(payload.notices.index).toMatch(/development sample/);
  });

  it("fails with the Census message when the address does not match", async () => {
    const deps = makeDeps({ census: () => ok({ result: { addressMatches: [] } }) });
    await expect(lookupAddress("nowhere", deps)).rejects.toBeInstanceOf(LookupError);
  });

  it("degrades FEMA, alerts and heat to null with a notice when the services error", async () => {
    const deps = makeDeps({ fema: () => httpError(500), nws: () => httpError(503), meteo: () => httpError(429) });
    const payload = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", deps);
    expect(payload.fema).toBeNull();
    expect(payload.live).toBeNull();
    expect(payload.heat).toBeNull();
    expect(payload.notices.fema).toMatch(/FEMA/);
    expect(payload.notices.live).toMatch(/Weather Service/);
    expect(payload.notices.heat).toBe("The climate data service is busy right now. Try again in a minute.");
  });

  it("says FEMA has no zone when the point is unmapped (not an error)", async () => {
    const payload = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", makeDeps({ fema: () => ok({ features: [] }) }));
    expect(payload.fema).toBeNull();
    expect(payload.notices.fema).toMatch(/no mapped flood zone/);
  });

  describe("timeouts", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("gives up on FEMA, alerts and heat after 8 seconds and still returns a payload", async () => {
      const deps = makeDeps({ fema: hang, nws: hang, meteo: hang });
      const pending = lookupAddress("100 James Robertson Pkwy, Nashville, TN", deps);

      await vi.advanceTimersByTimeAsync(7_900);
      let settled = false;
      void pending.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false); // still waiting inside the 8 s budget

      await vi.advanceTimersByTimeAsync(200);
      const payload = await pending;
      expect(payload.fema).toBeNull();
      expect(payload.live).toBeNull();
      expect(payload.heat).toBeNull();
      expect(payload.notices.fema).toMatch(/8 seconds/);
      expect(payload.notices.live).toMatch(/8 seconds/);
      expect(payload.notices.heat).toMatch(/8 seconds/);
      expect(payload.address.state).toBe("TN"); // the rest of the payload is intact
    });

    it("times out the geocoder with a 502 and a plain message", async () => {
      const deps = makeDeps({ census: hang });
      const pending = lookupAddress("100 James Robertson Pkwy, Nashville, TN", deps);
      const assertion = expect(pending).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/8 seconds/) });
      await vi.advanceTimersByTimeAsync(8_100);
      await assertion;
    });
  });
});

// ---------------------------------------------------------------- the shipped data files

const FIXTURES = path.join(process.cwd(), "tests", "fixtures");

describe("development fixture (tests/fixtures/index/TN.json.gz)", () => {
  beforeEach(() => clearDataCaches());

  it("loads the fixture from the folder it is given and marks it as a fixture", async () => {
    const index = await loadStateIndex("TN", FIXTURES);
    expect(index?.fixture).toBe(true);
    expect(index?.floods.length).toBeGreaterThan(50);
    expect(index?.tornadoes.length).toBeGreaterThan(10);
  });

  it("keeps the fixture and the shipped file apart even for the same state", async () => {
    const fixture = await loadStateIndex("TN", FIXTURES);
    const shipped = await loadStateIndex("TN");
    expect(fixture).not.toBe(shipped);
    expect(shipped?.fixture).toBeUndefined();
  });

  it("returns null for a state with no index, and for junk that could escape the data folder", async () => {
    expect(await loadStateIndex("ZZ", FIXTURES)).toBeNull();
    expect(await loadStateIndex("../../etc/passwd", FIXTURES)).toBeNull();
    expect(await loadHeatGrid("../index/TN", FIXTURES)).toBeNull();
  });

  it("caches the index after the first read", async () => {
    const first = await loadStateIndex("TN", FIXTURES);
    expect(await loadStateIndex("tn", FIXTURES)).toBe(first);
  });

  it("replays the Mar 27-28 2021 night for the Nashville sample address, including the 5 city-point reports", async () => {
    const index = (await loadStateIndex("TN", FIXTURES))!;
    const replay = selectReplayNight(index.floods, NASHVILLE)!;
    expect(replay.date).toBe("2021-03-27");

    const cityPointIds = index.floods
      .filter((f) => f.filed?.[0] === 36.17 && f.filed?.[1] === -86.78)
      .map((f) => f.id);
    expect(cityPointIds).toHaveLength(5);
    expect(replay.reportIds).toEqual(expect.arrayContaining(cityPointIds));
    expect(replay.reports.length).toBeGreaterThan(replay.reportIds.length); // regional reports ride along

    const { tierCounts } = findNearbyFloods(index.floods, NASHVILLE);
    expect(tierCounts.citywide).toBe(4); // the 95 Wallace Rd report left the 5 km circle when placed
  });

  it("finds the closest-ever EF3 (about 0.65 km) among the Nashville tornadoes", async () => {
    const index = (await loadStateIndex("TN", FIXTURES))!;
    const nearby = findNearbyTornadoes(index.tornadoes, NASHVILLE);
    const closest = nearby.reduce((a, b) => (a.minDistanceKm < b.minDistanceKm ? a : b));
    expect(closest.ef).toBe("EF3");
    expect(closest.minDistanceKm).toBeGreaterThan(0.4);
    expect(closest.minDistanceKm).toBeLessThan(0.9);
    expect(nearby.every((t) => t.minDistanceKm <= 10)).toBe(true);
  });
});

describe("shipped data (data/index, from the pipeline)", () => {
  beforeEach(() => clearDataCaches());

  /** The CONTRACT `detective` shape, field by field, with the placed point that must go with it. */
  function expectContractDetective(row: FloodRow): void {
    const d = row.detective!;
    expect(["placed", "unknown"]).toContain(d.verdict);
    expect(Array.isArray(d.clues) && d.clues.every((c) => typeof c === "string")).toBe(true);
    expect(d.match === null || typeof d.match === "string").toBe(true);
    expect([null, "intersection", "address", "named_area"]).toContain(d.matchType);
    expect([null, "high", "medium", "low"]).toContain(d.confidence);
    expect(d.model).toMatch(/^claude-/);
    expect(Number.isNaN(Date.parse(d.ranAt))).toBe(false);
    if (d.verdict === "placed") {
      // placed: a street-level match is named, and the point it names is in the row
      expect(typeof d.match).toBe("string");
      expect(d.matchType).not.toBeNull();
      expect(row.placed).not.toBeNull();
      const [lat, lon] = row.placed!;
      expect(lat).toBeGreaterThan(24);
      expect(lat).toBeLessThan(50);
      expect(lon).toBeGreaterThan(-125);
      expect(lon).toBeLessThan(-66);
    } else {
      // unknown: it says so, and no pin is moved
      expect(d.match).toBeNull();
      expect(d.matchType).toBeNull();
      expect(row.placed).toBeNull();
    }
  }

  // Koda's detective ran on the 4 sample areas (Nashville, San Antonio, Asheville, Bellevue): rows read / rows re-filed.
  const DETECTIVE_RUN: Record<string, [ran: number, placed: number]> = { TN: [131, 43], TX: [196, 55], NC: [31, 11], WA: [6, 1] };

  it.each(["TN", "TX", "NC", "MO", "AZ", "GA"])("ships a real %s index, not a fixture, with the CONTRACT shape", async (state) => {
    const index = (await loadStateIndex(state))!;
    expect(index).not.toBeNull();
    expect(index.state).toBe(state);
    expect(index.fixture).toBeUndefined();
    expect(index.floods.length).toBeGreaterThan(1000);
    expect(index.tornadoes.length).toBeGreaterThan(50);
    expect(index.built).toMatch(/^2026-10-/);
    // Times are local with an offset, never bare UTC.
    expect(index.floods.slice(0, 200).every((f) => /[+-]\d{2}:\d{2}$/.test(f.start))).toBe(true);

    const withDetective = index.floods.filter((f) => f.detective !== null);
    // A row never has a placed point without a detective verdict behind it.
    expect(index.floods.every((f) => f.detective !== null || f.placed === null)).toBe(true);
    if (state in DETECTIVE_RUN) {
      const [ran, placed] = DETECTIVE_RUN[state];
      expect(withDetective).toHaveLength(ran);
      expect(index.floods.filter((f) => f.placed !== null)).toHaveLength(placed);
      withDetective.forEach(expectContractDetective);
      // The detective only runs on imprecise reports, never on a precise NWS point.
      expect(withDetective.every((f) => f.coordPrecision !== "precise")).toBe(true);
    } else {
      // MO, AZ and GA were not in the detective run: nothing is placed there.
      expect(withDetective).toHaveLength(0);
      expect(index.floods.every((f) => f.placed === null)).toBe(true);
    }
  });

  it("ships a Bellevue (WA) index with the one placed report on 136th Pl NE", async () => {
    const index = (await loadStateIndex("WA"))!;
    expect(index.fixture).toBeUndefined();
    const [ran, placed] = DETECTIVE_RUN.WA;
    expect(index.floods.filter((f) => f.detective !== null)).toHaveLength(ran);
    const moved = index.floods.filter((f) => f.placed !== null);
    expect(moved).toHaveLength(placed);
    expect(moved[0].id).toBe("LSR-SEW-201912201657-0");
    expect(moved[0].quote).toMatch(/136TH PLACE NE/);
    expect(moved[0].detective).toMatchObject({ verdict: "placed", matchType: "intersection" });
    expectContractDetective(moved[0]);
  });

  it("re-filed 110 of the 364 imprecise reports across the 4 sample areas", async () => {
    let ran = 0;
    let placed = 0;
    for (const state of Object.keys(DETECTIVE_RUN)) {
      const index = (await loadStateIndex(state))!;
      ran += index.floods.filter((f) => f.detective !== null).length;
      placed += index.floods.filter((f) => f.placed !== null).length;
    }
    expect([placed, ran]).toEqual([110, 364]);
  });

  it("re-filed 21 of the 130 imprecise reports near the landing page's moments (Mayfield, Rolling Fork, Flushing, Fort Myers)", async () => {
    const MOMENTS_RUN: Record<string, [ran: number, placed: number]> = { KY: [39, 3], MS: [6, 1], NY: [69, 13], FL: [16, 4] };
    for (const [state, [ran, placed]] of Object.entries(MOMENTS_RUN)) {
      const index = (await loadStateIndex(state))!;
      expect([index.floods.filter((f) => f.detective !== null).length, index.floods.filter((f) => f.placed !== null).length], state).toEqual([ran, placed]);
    }
  });

  it("has no index for the territories (all 50 states and DC are indexed)", async () => {
    expect(await loadStateIndex("PR")).toBeNull();
    expect(await loadStateIndex("GU")).toBeNull();
    expect(await loadStateIndex("CO")).not.toBeNull();
  });

  it("replays the Mar 27-28 2021 night for the Nashville sample with the same five city-point reports", async () => {
    const index = (await loadStateIndex("TN"))!;
    const replay = selectReplayNight(index.floods, NASHVILLE)!;
    expect(replay.date).toBe("2021-03-27");
    expect(replay.reportIds).toHaveLength(18);
    const cityPoint = replay.reports.filter((f) => f.filed?.[0] === 36.17 && f.filed?.[1] === -86.78 && f.coordPrecision === "placeholder");
    expect(cityPoint).toHaveLength(5);
  });

  it("counts 42 distinct reports within 5 km of the Nashville sample: 8 mentioned, 21 at a point, 13 at a city point", async () => {
    const index = (await loadStateIndex("TN"))!;
    const { reports, tierCounts } = findNearbyFloods(index.floods, NASHVILLE);
    expect(reports).toHaveLength(42);
    expect(tierCounts).toEqual({ mentioned: 8, about1km: 21, citywide: 13 });

    // Why 44 became 42: the same rows with the detective's placements stripped still give the old 44 (27 at a point, 17 at a city point).
    const unplaced = index.floods.map((f) => ({ ...f, placed: null, detective: null }));
    const before = findNearbyFloods(unplaced, NASHVILLE);
    expect(before.reports).toHaveLength(44);
    expect(before.tierCounts).toEqual({ mentioned: 0, about1km: 27, citywide: 17 });
    // Re-filing only moves pins: 2 city-point reports were re-filed out of the 5 km circle, and none came in.
    const after = new Set(reports.map((r) => r.id));
    const left = before.reports.filter((r) => !after.has(r.id));
    expect(left).toHaveLength(2);
    expect(left.every((r) => r.coordPrecision === "placeholder")).toBe(true);
    expect(reports.every((r) => before.reports.some((b) => b.id === r.id))).toBe(true);
    // The "mentioned" tier is the detective's address or intersection matches, every one of them a real placement.
    const mentioned = reports.filter((r) => r.tier === "mentioned");
    expect(mentioned.every((r) => r.placed !== null && ["address", "intersection"].includes(r.detective?.matchType ?? ""))).toBe(true);
  });

  it("takes tornado deaths and injuries from the index row (the EF3 county segment: 2 and 170)", async () => {
    const index = (await loadStateIndex("TN"))!;
    const closest = findNearbyTornadoes(index.tornadoes, NASHVILLE).find((t) => t.id === "SE-882999")!;
    expect(closest).toMatchObject({ ef: "EF3", deaths: 2, injuries: 170 });
    expect(closest.minDistanceKm).toBeLessThan(0.9);
  });

  it("has 14 distinct reports within 5 km of the Asheville sample and no tornado within 10 km", async () => {
    const index = (await loadStateIndex("NC"))!;
    const asheville: [number, number] = [35.5917595, -82.571739541];
    expect(findNearbyFloods(index.floods, asheville).reports).toHaveLength(14);
    expect(findNearbyTornadoes(index.tornadoes, asheville)).toEqual([]);
  });

  it("has 27 distinct reports within 5 km of the San Antonio sample and a replay night", async () => {
    const index = (await loadStateIndex("TX"))!;
    const sanAntonio: [number, number] = [29.424796, -98.494679];
    const { reports, tierCounts } = findNearbyFloods(index.floods, sanAntonio);
    expect(reports).toHaveLength(27);
    expect(tierCounts).toEqual({ mentioned: 0, about1km: 17, citywide: 10 });
    // Before the detective there were 28; one city-point report was re-filed out of the circle.
    const before = findNearbyFloods(index.floods.map((f) => ({ ...f, placed: null, detective: null })), sanAntonio);
    expect(before.reports).toHaveLength(28);
    expect(before.reports.filter((r) => !reports.some((x) => x.id === r.id)).map((r) => r.coordPrecision)).toEqual(["placeholder"]);
    expect(selectReplayNight(index.floods, sanAntonio)).toMatchObject({ date: "2016-06-02" });
  });
});

describe("shipped regional heat grids (data/heat, converted from the pipeline)", () => {
  beforeEach(() => clearDataCaches());

  const WEEKS: Record<string, { first: string; last: string }> = {
    nashville: { first: "2012-06-26", last: "2012-07-02" },
    asheville: { first: "2012-06-27", last: "2012-07-03" },
    "san-antonio": { first: "2023-06-18", last: "2023-06-24" },
  };

  it.each(Object.keys(WEEKS))("ships %s as a 7-day, 875-square HeatGrid", async (slug) => {
    const grid = (await loadHeatGrid(slug))!;
    expect(grid.slug).toBe(slug);
    expect(grid.days).toHaveLength(7);
    expect(grid.cells).toHaveLength(875);
    expect(grid.cells.every(([, , values]) => values.length === 7 && values.every(Number.isFinite))).toBe(true);
    expect(grid.label).toMatch(/^Heat wave, /);
  });

  it.each(Object.entries(WEEKS))("%s matches its own worst week through gridMatchesWeek, and no other", async (slug, { first, last }) => {
    const grid = (await loadHeatGrid(slug))!;
    expect(gridMatchesWeek(grid, { start: first, end: last, daily: [] })).toBe(true);
    expect(gridMatchesWeek(grid, { start: "2010-08-09", end: "2010-08-15", daily: [] })).toBe(false);
  });
});

describe("one heat source per address", () => {
  beforeEach(() => clearHeatCache());

  it("Get ready and the lookup read the identical heat summary for the same address", async () => {
    const { gatherRecord, defaultReadyDeps } = await import("@/lib/ready/ready-route");
    const deps = makeDeps({ meteo: () => ok(openMeteoReply(heatYear(2012, { "2012-06-25": 104 }).concat(heatYear(2025, { "2025-07-09": 102 })))) });
    const payload = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", deps);
    const ready = await gatherRecord(36.17, -86.78, "TN", { ...defaultReadyDeps(deps.fetch), now: deps.now, snapshots: async () => [], loadIndex: async () => null, areaIds: async () => null });
    expect(ready.input.heat).not.toBeNull();
    expect({ ...ready.input.heat, regionalSlug: null }).toEqual({ ...payload.heat, regionalSlug: null });
  });
});
