/**
 * The "Storm nights" picker's data: the top 5 nights by report count within 15 km, plus any other night with at least
 * 2 reports newer than 2023, the busiest as the default; the API field; the light /api/replay route; and the check
 * that flips the detective wording.
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getReplay } from "@/app/api/replay/route";
import { loadAiJobs } from "@/lib/ai-jobs-server";
import { clearDetectiveStatusCache, countDetective, detectiveCounts, detectiveHasRun, indexHasDetective } from "@/lib/detective-status";
import { clearDataCaches } from "@/lib/index-store";
import { listStormNights, lookupAddress, lookupReplay, selectReplayNight, type LookupDeps } from "@/lib/lookup";
import { clearHeatCache } from "@/lib/sources";
import type { Detective, FloodRow, StateIndex } from "@/lib/types";
import { CENSUS_NASHVILLE, FEMA_ZONE_X, NASHVILLE, NO_ALERTS, fakeFetch, flood, heatYear, ok, openMeteoReply } from "./helpers";

/** `n` reports, 10 minutes apart, starting at the given local time (written with a UTC-6 offset, like the NWS rows). */
function night(prefix: string, startLocal: string, n: number): FloodRow[] {
  const t0 = Date.parse(`${startLocal}Z`); // the local clock reading, treated as UTC only to do the arithmetic
  return Array.from({ length: n }, (_, i) => {
    const start = `${new Date(t0 + i * 600_000).toISOString().slice(0, 19)}-06:00`;
    return flood({ id: `${prefix}-${i}`, start, filed: NASHVILLE, coordPrecision: "rounded" });
  });
}

const OLD_NIGHTS = [
  night("a", "2015-03-01T20:00:00", 9),
  night("b", "2016-02-03T08:00:00", 6),
  night("c", "2017-06-10T20:00:00", 12),
  night("d", "2018-07-01T20:00:00", 3),
  night("e", "2019-05-05T20:00:00", 4),
  night("f", "2020-04-04T20:00:00", 2),
  night("g", "2021-03-27T22:00:00", 18),
];

describe("listStormNights", () => {
  it("lists the 5 busiest nights, most reports first, each with its date and report count", () => {
    const nights = listStormNights(OLD_NIGHTS.flat(), NASHVILLE);
    expect(nights.map((n) => [n.date, n.reports])).toEqual([
      ["2021-03-27", 18],
      ["2017-06-10", 12],
      ["2015-03-01", 9],
      ["2016-02-03", 6],
      ["2019-05-05", 4],
    ]);
    expect(nights.every((n) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(n.id))).toBe(true);
  });

  it("adds any other night newer than 2023 that has 2 or more reports, even if it is not in the top 5", () => {
    const recent = [night("h", "2024-09-27T09:00:00", 2), night("i", "2025-07-04T20:00:00", 3), night("j", "2024-10-01T20:00:00", 1), night("k", "2023-12-30T20:00:00", 3)];
    const nights = listStormNights([...OLD_NIGHTS, ...recent].flat(), NASHVILLE);
    const dates = nights.map((n) => n.date);
    expect(dates.slice(0, 5)).toEqual(["2021-03-27", "2017-06-10", "2015-03-01", "2016-02-03", "2019-05-05"]);
    // newest first after the top 5; a single report and a 2023 night do not qualify
    expect(dates.slice(5)).toEqual(["2025-07-04", "2024-09-27"]);
    expect(dates).not.toContain("2024-10-01");
    expect(dates).not.toContain("2023-12-30");
  });

  it("a recent night that is already in the top 5 is listed once", () => {
    const nights = listStormNights([...OLD_NIGHTS, night("h", "2025-07-04T20:00:00", 20)].flat(), NASHVILLE);
    expect(nights[0]).toMatchObject({ date: "2025-07-04", reports: 20 });
    expect(nights.filter((n) => n.date === "2025-07-04")).toHaveLength(1);
  });

  it("never lists two nights that overlap: reports inside the busiest night's radar window do not start another night", () => {
    // 6 reports each a minute apart, then 3 more 8 hours later: the first 6 hours are one night; the later three are another.
    const rows = [...night("x", "2022-05-01T20:00:00", 30), ...night("y", "2022-05-02T05:00:00", 3)];
    const nights = listStormNights(rows, NASHVILLE);
    const windows = nights.map((n) => [Date.parse(n.startUtc), Date.parse(n.endUtc)]);
    for (let i = 0; i < windows.length; i += 1) for (let j = i + 1; j < windows.length; j += 1) expect(windows[i][1] < windows[j][0] || windows[j][1] < windows[i][0]).toBe(true);
  });

  it("is empty when nothing was reported within 15 km, and ignores duplicates", () => {
    expect(listStormNights([], NASHVILLE)).toEqual([]);
    expect(listStormNights([flood({ id: "far", filed: [40, -80] })], NASHVILLE)).toEqual([]);
    const dup = night("p", "2021-03-27T22:00:00", 3).map((r) => ({ ...r, dupOf: "other" }));
    expect(listStormNights(dup, NASHVILLE)).toEqual([]);
  });
});

describe("selectReplayNight with a chosen night", () => {
  const rows = OLD_NIGHTS.flat();
  const nights = listStormNights(rows, NASHVILLE);

  it("defaults to the night with the most reports (same as the first picker entry)", () => {
    const replay = selectReplayNight(rows, NASHVILLE)!;
    expect(replay.nightId).toBe(nights[0].id);
    expect(replay.reportIds).toHaveLength(18);
  });

  it("returns the chosen night, with its own window and reports", () => {
    const feb = nights.find((n) => n.date === "2016-02-03")!;
    const replay = selectReplayNight(rows, NASHVILLE, feb.id)!;
    expect(replay.nightId).toBe(feb.id);
    expect(replay.date).toBe("2016-02-03");
    expect(replay.reportIds).toHaveLength(6);
    expect(replay.startUtc).toBe(feb.startUtc);
  });

  it("falls back to the busiest night for an id it does not know", () => {
    expect(selectReplayNight(rows, NASHVILLE, "1999-01-01T00:00")?.nightId).toBe(nights[0].id);
  });
});

describe("lookupReplay and the API fields", () => {
  const rows = OLD_NIGHTS.flat();
  const index: StateIndex = { state: "TN", built: "x", sources: [], floods: rows, tornadoes: [] };
  const deps = { loadIndex: async () => index };
  const nights = listStormNights(rows, NASHVILLE);

  it("returns another night from the index alone", async () => {
    const replay = await lookupReplay("TN", NASHVILLE[0], NASHVILLE[1], nights[1].id, deps);
    expect(replay?.nightId).toBe(nights[1].id);
  });

  it("returns null for a night that is not in the records, a bad id, or an unindexed state", async () => {
    expect(await lookupReplay("TN", NASHVILLE[0], NASHVILLE[1], "1999-01-01T00:00", deps)).toBeNull();
    expect(await lookupReplay("TN", NASHVILLE[0], NASHVILLE[1], "not-a-night", deps)).toBeNull();
    expect(await lookupReplay("ZZ", NASHVILLE[0], NASHVILLE[1], nights[0].id, { loadIndex: async () => null })).toBeNull();
  });

  it("/api/lookup returns stormNights as an additive field and honours ?night=", async () => {
    const lookupDeps: LookupDeps = {
      fetch: fakeFetch({
        census: () => ok(CENSUS_NASHVILLE),
        fema: () => ok(FEMA_ZONE_X),
        nws: () => ok(NO_ALERTS),
        meteo: () => ok(openMeteoReply(heatYear(2024))),
      }),
      loadIndex: async () => index,
      loadHeatGrid: async () => null,
      now: () => new Date("2026-10-07T12:00:00Z"),
    };
    const base = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", lookupDeps);
    expect(base.stormNights.map((n) => n.reports)).toEqual([18, 12, 9, 6, 4]);
    expect(base.stormReplay?.nightId).toBe(base.stormNights[0].id);
    const chosen = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", lookupDeps, { night: base.stormNights[3].id });
    expect(chosen.stormReplay?.nightId).toBe(base.stormNights[3].id);
    expect(chosen.stormNights).toEqual(base.stormNights);
  });

  describe("/api/replay route", () => {
    beforeEach(() => clearDataCaches());
    const call = (query: string) => getReplay(new Request(`http://localhost/api/replay?${query}`));

    it("rejects missing or bad parameters with a 400 and plain words", async () => {
      expect((await call("")).status).toBe(400);
      expect((await call("state=TN&lat=abc&lon=-86&night=x")).status).toBe(400);
      expect((await call("state=TN&lat=95&lon=-86&night=x")).status).toBe(400);
      expect((await call("state=../../etc&lat=36&lon=-86&night=x")).status).toBe(400);
      const body = (await (await call("")).json()) as { error: string };
      expect(body.error).toMatch(/state/i);
    });

    it("404s for a night that is not in the records", async () => {
      const response = await call("state=TN&lat=36.168&lon=-86.778&night=1999-01-01T00:00");
      expect(response.status).toBe(404);
    });
  });
});

describe("detectiveHasRun: the check that flips the wording", () => {
  const detective: Detective = { verdict: "placed", clues: ["x"], match: "m", matchType: "address", confidence: "high", model: "t", ranAt: "t" };
  const withRows = (floods: FloodRow[], extra: Partial<StateIndex> = {}): StateIndex => ({ state: "TN", built: "x", sources: [], floods, tornadoes: [], ...extra });

  it("is false while every detective field is null, true as soon as one real row has a verdict", () => {
    expect(indexHasDetective(null)).toBe(false);
    expect(indexHasDetective(withRows([flood({ id: "a" })]))).toBe(false);
    expect(indexHasDetective(withRows([flood({ id: "a" }), flood({ id: "b", detective })]))).toBe(true);
    // an "unknown" verdict is still a real detective result
    expect(indexHasDetective(withRows([flood({ id: "b", detective: { ...detective, verdict: "unknown", match: null, matchType: null } })]))).toBe(true);
  });

  it("never counts a hand-built fixture", () => {
    expect(indexHasDetective(withRows([flood({ id: "b", detective })], { fixture: true }))).toBe(false);
  });

  describe("on disk", () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(path.join(tmpdir(), "memoria-det-"));
      await mkdir(path.join(dir, "index"));
      clearDataCaches();
      clearDetectiveStatusCache();
    });
    afterEach(() => vi.restoreAllMocks());

    const put = (st: string, idx: StateIndex) => writeFile(path.join(dir, "index", `${st}.json.gz`), gzipSync(JSON.stringify(idx)));

    it("flips from false to true when a state file gains a detective row", async () => {
      await put("TN", withRows([flood({ id: "a" })]));
      await put("TX", withRows([flood({ id: "b" })], { state: "TX" }));
      expect(await detectiveHasRun(dir)).toBe(false);

      await put("TX", withRows([flood({ id: "b", detective })], { state: "TX" }));
      clearDataCaches();
      clearDetectiveStatusCache();
      expect(await detectiveHasRun(dir)).toBe(true);
    });

    it("is false (the honest answer) when the data folder is missing", async () => {
      expect(await detectiveHasRun(path.join(dir, "nope"))).toBe(false);
    });
  });

  it("the shipped data now holds the real detective run, so the pages use the real-results wording with its counts", async () => {
    clearDataCaches();
    clearDetectiveStatusCache();
    expect(await detectiveHasRun()).toBe(true);
    expect(await detectiveCounts()).toEqual({ ran: 494, placed: 131, states: 8 });

    // The same files drive the jobs list on the How it works page and the landing.
    const [detective, damage] = await loadAiJobs(await detectiveHasRun());
    expect(detective.result).toBe("Real run on this site’s data: it re-filed 131 of 494 imprecise flood reports around the sample and featured addresses, in 8 states, and said “I don’t know” on the other 363. These re-filings are not scored against the truth yet.");
    expect(detective.detail).toContain("Real placements are in the data now.");
    expect(damage.status).toBe("pilot");
  });

  it("counts only real rows: placed needs a verdict and a point, a fixture counts as nothing", () => {
    expect(countDetective(null)).toEqual({ ran: 0, placed: 0, states: 0 });
    expect(countDetective(withRows([flood({ id: "b", detective })], { fixture: true }))).toEqual({ ran: 0, placed: 0, states: 0 });
    const rows = [
      flood({ id: "a" }),
      flood({ id: "b", detective, placed: [36.2, -86.8] }),
      flood({ id: "c", detective: { ...detective, verdict: "unknown", match: null, matchType: null } }),
    ];
    expect(countDetective(withRows(rows))).toEqual({ ran: 2, placed: 1, states: 1 });
  });
});
