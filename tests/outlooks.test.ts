/**
 * The official outlooks at a point (IEM, HeatRisk, NWS feels-like) and the local record. No test reaches the network: every
 * outside call is a fake, and the record files are the real shipped ones or small temporary ones.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildOutlook,
  clearOutlookCache,
  feelsLikeByLocalDay,
  heatRiskUrl,
  iemUrl,
  outlookDates,
  parseHeatRiskValue,
  parseIemOutlooks,
  type OutlookDeps,
} from "@/lib/outlooks";
import { findOutlookRecord, isOutlookRecord, loadOutlookRecords, rankFeels, type OutlookRecordFile } from "@/lib/outlook-record";
import { ok, httpError } from "./helpers";

const NOW = new Date("2026-10-08T19:00:00Z");

describe("outlookDates", () => {
  it("counts the NWS outlook day from 12Z: before 12Z it is still yesterday's Day 1", () => {
    expect(outlookDates(new Date("2026-10-08T19:00:00Z"))).toEqual(["2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(outlookDates(new Date("2026-10-08T09:00:00Z"))).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(outlookDates(new Date("2026-12-31T20:00:00Z"))[2]).toBe("2027-01-02");
  });
});

describe("parseIemOutlooks", () => {
  it("takes the highest ERO level per day, and no row means no risk area", () => {
    const { flood } = parseIemOutlooks(
      [
        { day: 3, outlook_type: "E", threshold: "SLGT", category: "CATEGORICAL" },
        { day: 3, outlook_type: "E", threshold: "MRGL", category: "CATEGORICAL" },
        { day: "2", outlook_type: "E", threshold: "MRGL", category: "CATEGORICAL" },
        { day: 3, outlook_type: "C", threshold: "SLGT", category: "CATEGORICAL" },
      ],
      NOW,
    );
    expect(flood).toEqual([
      { day: 1, date: "2026-10-08", level: "none" },
      { day: 2, date: "2026-10-09", level: "MRGL" },
      { day: 3, date: "2026-10-10", level: "SLGT" },
    ]);
  });

  it("accepts the 2026 Enhanced level and ignores levels it does not know", () => {
    const { flood } = parseIemOutlooks(
      [
        { day: 1, outlook_type: "E", threshold: "ENH", category: "CATEGORICAL" },
        { day: 2, outlook_type: "E", threshold: "FUTURE", category: "CATEGORICAL" },
      ],
      NOW,
    );
    expect(flood.map((d) => d.level)).toEqual(["ENH", "none", "none"]);
  });

  it("reads SPC tornado probability on Days 1 and 2 (highest wins), the any-severe probability on Day 3, and skips SIGN and CIG hatching", () => {
    const { tornado } = parseIemOutlooks(
      [
        { day: 1, outlook_type: "C", threshold: "0.02", category: "TORNADO" },
        { day: 1, outlook_type: "C", threshold: "0.10", category: "TORNADO" },
        { day: 1, outlook_type: "C", threshold: "SIGN", category: "TORNADO" },
        { day: 1, outlook_type: "C", threshold: "CIG2", category: "TORNADO" },
        { day: 1, outlook_type: "C", threshold: "0.30", category: "HAIL" },
        { day: 2, outlook_type: "C", threshold: "0.05", category: "TORNADO" },
        { day: 3, outlook_type: "C", threshold: "0.15", category: "ANY SEVERE" },
        { day: 3, outlook_type: "C", threshold: "0.45", category: "TORNADO" },
      ],
      NOW,
    );
    expect(tornado).toEqual([
      { day: 1, date: "2026-10-08", kind: "tornado", percent: 10 },
      { day: 2, date: "2026-10-09", kind: "tornado", percent: 5 },
      { day: 3, date: "2026-10-10", kind: "severe", percent: 15 },
    ]);
  });
});

describe("HeatRisk", () => {
  it("builds the identify request for 12Z of the day at the point", () => {
    const url = heatRiskUrl(36.168175, -86.777516, "2026-10-08");
    expect(url).toContain("NWS_HeatRisk/ImageServer/identify");
    expect(url).toContain(`time=${Date.parse("2026-10-08T12:00:00Z")}`);
    expect(decodeURIComponent(url)).toContain('"x":-86.7775');
  });

  it("reads the pixel value, and treats NoData as no value", () => {
    expect(parseHeatRiskValue("2")).toBe(2);
    expect(parseHeatRiskValue(0)).toBe(0);
    expect(parseHeatRiskValue("NoData")).toBeNull();
    expect(parseHeatRiskValue("7")).toBeNull();
    expect(parseHeatRiskValue("1.5")).toBeNull();
    expect(parseHeatRiskValue(undefined)).toBeNull();
  });
});

describe("feelsLikeByLocalDay", () => {
  /** Hourly apparent temperature (C): `hours` values from a start, each hour `value(i)`. */
  const hourly = (start: string, hours: number, value: (i: number) => number) =>
    Array.from({ length: hours }, (_, i) => ({ validTime: `${new Date(Date.parse(start) + i * 3_600_000).toISOString().replace(".000Z", "+00:00")}/PT1H`, value: value(i) }));

  it("is the daily maximum in F for each local day, from a grid that covers the whole day", () => {
    // 2026-10-08 05:00 Chicago time is 10:00Z. 66 hours cover Oct 8 (19 h), Oct 9 (24 h) and Oct 10 (23 h).
    const values = hourly("2026-10-08T10:00:00Z", 66, (i) => 20 + (i % 24 === 8 ? 10 : 0));
    const days = feelsLikeByLocalDay(values, "America/Chicago", NOW);
    expect(days.map((d) => d.date)).toEqual(["2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(days[1].feelsF).toBe(86);
  });

  it("leaves out a day it has too few hours for (an evening-only today is not the day's high)", () => {
    const values = hourly("2026-10-09T01:00:00Z", 60, () => 25);
    const days = feelsLikeByLocalDay(values, "America/Chicago", NOW);
    expect(days.map((d) => d.date)).not.toContain("2026-10-08");
    expect(days.map((d) => d.date)).toContain("2026-10-09");
  });

  it("skips null values and unreadable periods", () => {
    expect(feelsLikeByLocalDay([{ validTime: "garbage", value: 20 }, { validTime: "2026-10-08T10:00:00+00:00/PT1H", value: null }], "America/Chicago", NOW)).toEqual([]);
  });
});

describe("rankFeels", () => {
  // Ten years, 2000-2009, every day 70 F except: one very hot day on 2005-07-04 (110) and a hot week around 2005-07-04 (95).
  const start = "2000-01-01";
  const series: Array<number | null> = [];
  for (let ms = Date.UTC(2000, 0, 1); ms < Date.UTC(2010, 0, 1); ms += 86_400_000) {
    const d = new Date(ms).toISOString().slice(0, 10);
    series.push(d === "2005-07-04" ? 110 : d >= "2005-07-01" && d <= "2005-07-07" ? 95 : 70);
  }

  it("counts the days this hot or hotter over all days and over the same time of year", () => {
    const rank = rankFeels({ start, feelsF: series }, "2026-07-04", 95)!;
    expect(rank.allAtLeast).toBe(7);
    expect(rank.allTotal).toBe(series.length);
    // Days within a week of July 4 in each of 10 years: 15 each.
    expect(rank.seasonTotal).toBe(150);
    expect(rank.seasonAtLeast).toBe(7);
    expect(rank.since).toBe(2000);
  });

  it("says nothing was ever this hot with a count of 0", () => {
    expect(rankFeels({ start, feelsF: series }, "2026-07-04", 120)).toMatchObject({ allAtLeast: 0, seasonAtLeast: 0 });
  });

  it("ignores missing days and returns null for an empty history", () => {
    expect(rankFeels({ start, feelsF: series.map(() => null) }, "2026-07-04", 95)).toBeNull();
    const withGap = [...series];
    withGap[0] = null;
    expect(rankFeels({ start, feelsF: withGap }, "2026-07-04", 95)!.allTotal).toBe(series.length - 1);
  });
});

// ---------------------------------------------------------------- the whole picture

const IEM_BODY = {
  data: [
    { day: 3, outlook_type: "E", threshold: "SLGT", category: "CATEGORICAL" },
    { day: 3, outlook_type: "C", threshold: "TSTM", category: "CATEGORICAL" },
  ],
};

const hourlyGrid = (start: string, hours: number, celsius: number) => ({
  properties: {
    apparentTemperature: {
      uom: "wmoUnit:degC",
      values: Array.from({ length: hours }, (_, i) => ({ validTime: `${new Date(Date.parse(start) + i * 3_600_000).toISOString().replace(".000Z", "+00:00")}/PT1H`, value: celsius })),
    },
  },
});

function deps(overrides: Partial<{ iem: () => Response; risk: () => Response; points: () => Response; grid: () => Response; records: OutlookRecordFile[] }> = {}): OutlookDeps & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    now: () => NOW,
    loadRecords: async () => overrides.records ?? [],
    fetch: async (url) => {
      urls.push(url);
      if (url.includes("mesonet.agron.iastate.edu")) return (overrides.iem ?? (() => ok(IEM_BODY)))();
      if (url.includes("NWS_HeatRisk")) return (overrides.risk ?? (() => ok({ value: "1" })))();
      if (url.includes("api.weather.gov/points")) return (overrides.points ?? (() => ok({ properties: { forecastGridData: "https://api.weather.gov/gridpoints/OHX/50,57", timeZone: "America/Chicago" } })))();
      if (url.includes("api.weather.gov/gridpoints")) return (overrides.grid ?? (() => ok(hourlyGrid("2026-10-08T05:00:00Z", 80, 30))))();
      throw new Error(`unrouted URL in test: ${url}`);
    },
  };
}

describe("buildOutlook", () => {
  beforeEach(() => clearOutlookCache());

  it("returns the three official outlooks and says there is no local record for an address that is not a sample", async () => {
    const d = deps();
    const outlook = await buildOutlook(36.2, -86.7, d);
    expect(outlook.flood.days?.map((x) => x.level)).toEqual(["none", "none", "SLGT"]);
    expect(outlook.tornado.days?.map((x) => x.percent)).toEqual([0, 0, 0]);
    expect(outlook.heat.risk?.map((x) => x.level)).toEqual([1, 1, 1]);
    expect(outlook.heat.forecast?.[0].feelsF).toBe(86);
    expect(outlook.heat.forecast?.[0].rank).toBeNull();
    expect(outlook.flood.record).toBeNull();
    expect(outlook.recordSlug).toBeNull();
    expect(outlook.recordNotice).toMatch(/four sample addresses/);
    expect(d.urls.filter((u) => u.includes("NWS_HeatRisk"))).toHaveLength(3);
    expect(d.urls).toContain(iemUrl(36.2, -86.7));
  });

  it("adds the record and the heat ranking when the point is a sample address", async () => {
    const record = makeRecord();
    const outlook = await buildOutlook(36.168, -86.7775, deps({ records: [record] }));
    expect(outlook.recordSlug).toBe("test-sample");
    expect(outlook.flood.record?.hitDays).toBe(3);
    expect(outlook.recordNotice).toBeNull();
    expect(outlook.heat.hasHistory).toBe(true);
    expect(outlook.heat.forecast?.[0].rank?.allTotal).toBe(730);
  });

  it("says why the ranking is missing when a sample has no saved heat history yet", async () => {
    const record = { ...makeRecord(), heat: null };
    const outlook = await buildOutlook(36.168, -86.7775, deps({ records: [record] }));
    expect(outlook.heat.hasHistory).toBe(false);
    expect(outlook.heat.notices.history).toMatch(/not saved yet/);
    expect(outlook.flood.record).not.toBeNull();
  });

  it("degrades one source at a time, with a plain notice, and never invents a value", async () => {
    const outlook = await buildOutlook(36.2, -86.7, deps({ iem: () => httpError(503), risk: () => httpError(500), points: () => httpError(404) }));
    expect(outlook.flood.days).toBeNull();
    expect(outlook.flood.notice).toMatch(/Iowa Environmental Mesonet.*503/);
    expect(outlook.tornado.days).toBeNull();
    expect(outlook.heat.risk).toBeNull();
    expect(outlook.heat.notices.risk).toMatch(/HeatRisk/);
    expect(outlook.heat.forecast).toBeNull();
    expect(outlook.heat.notices.forecast).toMatch(/National Weather Service forecast/);
  });

  it("reuses a complete answer for ten minutes but retries a source that failed", async () => {
    const good = deps();
    await buildOutlook(36.2, -86.7, good);
    const calls = good.urls.length;
    await buildOutlook(36.2, -86.7, good);
    expect(good.urls.length).toBe(calls);

    clearOutlookCache();
    const failing = deps({ iem: () => httpError(503) });
    await buildOutlook(36.2, -86.7, failing);
    const failedCalls = failing.urls.length;
    await buildOutlook(36.2, -86.7, failing);
    expect(failing.urls.length).toBeGreaterThan(failedCalls);
  });

  it("treats an HeatRisk answer of NoData on every day as no value", async () => {
    const outlook = await buildOutlook(36.2, -86.7, deps({ risk: () => ok({ value: "NoData" }) }));
    expect(outlook.heat.risk).toBeNull();
    expect(outlook.heat.notices.risk).toMatch(/no value/);
  });
});

function makeRecord(): OutlookRecordFile {
  const counts = (days: number, hitDays: number) => ({ days, hitDays });
  const byCategory = { none: counts(90, 0), MRGL: counts(8, 1), SLGT: counts(2, 2), MDT: counts(0, 0), HIGH: counts(0, 0) };
  const feelsF = Array.from({ length: 730 }, () => 75);
  return {
    slug: "test-sample",
    address: "1 Test St",
    lat: 36.168175,
    lon: -86.777516,
    built: "2026-10-08T00:00:00Z",
    flood: { radiusKm: 10, window: { start: "2016-10-01", end: "2025-12-31" }, days: 100, daysMissing: 0, hitDays: 3, reportsWithin10Km: 4, redefined: "2022-02-10", byCategory, beforeRedefinition: byCategory, sinceRedefinition: byCategory },
    tornado: { radiusMi: 25, window: { start: "2016-10-01", end: "2025-06-30" }, days: 100, daysMissing: 0, hitDays: 1, byProbability: { none: counts(98, 0), "2": counts(1, 1), "5": counts(1, 0), "10+": counts(0, 0) } },
    heat: { source: "test", start: "2000-01-01", feelsF },
    sources: [],
  };
}

describe("records on disk", () => {
  it("the shipped record files are well formed, one per sample address, and every count is internally consistent", async () => {
    const records = await loadOutlookRecords(path.join(process.cwd(), "data", "outlook-record"));
    expect(records.map((r) => r.slug).sort()).toEqual(["asheville", "bellevue", "nashville", "san-antonio"]);
    for (const r of records) {
      const cats = Object.values(r.flood.byCategory);
      expect(cats.reduce((n, c) => n + c.days, 0)).toBe(r.flood.days);
      expect(cats.reduce((n, c) => n + c.hitDays, 0)).toBe(r.flood.hitDays);
      const tors = Object.values(r.tornado.byProbability);
      expect(tors.reduce((n, c) => n + c.days, 0)).toBe(r.tornado.days);
      expect(tors.reduce((n, c) => n + c.hitDays, 0)).toBe(r.tornado.hitDays);
      // The two eras add up to the whole record.
      for (const key of Object.keys(r.flood.byCategory) as Array<keyof typeof r.flood.byCategory>) {
        expect(r.flood.beforeRedefinition[key].days + r.flood.sinceRedefinition[key].days).toBe(r.flood.byCategory[key].days);
      }
      expect(r.flood.window.start).toBe("2016-10-01");
      expect(r.flood.redefined).toBe("2022-02-10");
      expect(r.heat === null || r.heat.feelsF.length >= 9000).toBe(true);
    }
  });

  it("finds a sample's record within 200 m and not farther", async () => {
    const records = await loadOutlookRecords(path.join(process.cwd(), "data", "outlook-record"));
    expect(findOutlookRecord(36.168175, -86.777516, records)?.slug).toBe("nashville");
    expect(findOutlookRecord(36.1682, -86.7776, records)?.slug).toBe("nashville");
    expect(findOutlookRecord(36.175, -86.777516, records)).toBeNull();
  });

  it("skips a malformed or unreadable file instead of failing", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "outlook-record-"));
    writeFileSync(path.join(dir, "broken.json"), "{ nope");
    writeFileSync(path.join(dir, "empty.json"), JSON.stringify({ slug: "x", lat: 1, lon: 2 }));
    writeFileSync(path.join(dir, "ok.json"), JSON.stringify(makeRecord()));
    const records = await loadOutlookRecords(dir);
    expect(records.map((r) => r.slug)).toEqual(["test-sample"]);
    expect(isOutlookRecord({ slug: "x" })).toBe(false);
    expect(await loadOutlookRecords(path.join(dir, "missing"))).toEqual([]);
  });
});
