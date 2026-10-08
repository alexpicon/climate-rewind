/**
 * Your street's flood trigger. Fixtures only: every outside call (Open-Meteo archive, api.weather.gov points and gridpoints) is faked by URL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFloodTrigger,
  clearRainCache,
  compareForecast,
  floodDates,
  forecastByLocalDay,
  parseIsoDuration,
  rainOnFloodDates,
  rainRanges,
  triggerOf,
} from "@/lib/flood-trigger";
import { lookupAddress, type LookupDeps } from "@/lib/lookup";
import { clearHeatCache } from "@/lib/sources";
import type { FloodTrigger, StateIndex } from "@/lib/types";
import { dayPossessive, formatInches, triggerCopy, TRIGGER_FINE_PRINT } from "@/lib/ui/trigger-text";
import { CENSUS_NASHVILLE, FEMA_ZONE_X, NASHVILLE, flood, hang, heatYear, httpError, ok, openMeteoReply } from "./helpers";

const NOW = new Date("2026-10-08T14:00:00Z"); // 9 AM in Nashville
const POINTS = { properties: { forecastGridData: "https://api.weather.gov/gridpoints/OHX/50,57", timeZone: "America/Chicago" } };

/** Flood reports on given local dates, all within 5 km. */
const reportsOn = (dates: string[]) => dates.map((date, i) => flood({ id: `r${i}`, start: `${date}T22:55:00-05:00`, filed: [36.17, -86.78] }));

/** An archive reply: rain by date. Dates not listed are 0. */
function archive(rain: Record<string, number>, from = "2021-03-01", to = "2021-12-31") {
  const days: string[] = [];
  for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= Date.parse(`${to}T00:00:00Z`); ms += 86_400_000) days.push(new Date(ms).toISOString().slice(0, 10));
  return { daily: { time: days, precipitation_sum: days.map((d) => rain[d] ?? 0) } };
}

/** A gridpoint reply: one 24 h period per local day starting at local midnight (CDT = UTC-5), in millimetres. */
function grid(mmPerDay: number[], uom = "wmoUnit:mm") {
  return {
    properties: {
      updateTime: "2026-10-08T12:00:00+00:00",
      quantitativePrecipitation: {
        uom,
        values: mmPerDay.map((value, i) => ({ validTime: `2026-10-${String(8 + i).padStart(2, "0")}T05:00:00+00:00/P1D`, value })),
      },
    },
  };
}

// Dates and totals (a day and the day before, whichever is larger): 2.2, 3.0, 1.8, 2.6. The median is 2.4 in.
const DATES = ["2021-04-02", "2021-05-11", "2021-07-04", "2021-09-20"];
const RAIN = { "2021-04-01": 2.2, "2021-04-02": 0.4, "2021-05-11": 3.0, "2021-07-04": 1.8, "2021-09-20": 2.6 };

function fetchFor(handlers: { archive?: () => Response | Promise<Response>; points?: () => Response | Promise<Response>; grid?: () => Response | Promise<Response> }) {
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    if (url.includes("archive-api.open-meteo.com")) return (handlers.archive ?? (() => ok(archive(RAIN))))();
    if (url.includes("api.weather.gov/points/")) return (handlers.points ?? (() => ok(POINTS)))();
    if (url.includes("api.weather.gov/gridpoints/")) return (handlers.grid ?? (() => ok(grid([0, 79, 0]))))();
    throw new Error(`unrouted URL in test: ${url}`);
  };
  return { fetchFn, calls };
}

const build = (reports: ReturnType<typeof reportsOn>, handlers: Parameters<typeof fetchFor>[0] = {}) => {
  const { fetchFn, calls } = fetchFor(handlers);
  return buildFloodTrigger({ lat: NASHVILLE[0], lon: NASHVILLE[1] }, reports, { fetch: fetchFn, now: () => NOW }).then((trigger) => ({ trigger, calls }));
};

beforeEach(() => clearRainCache());

// ---------------------------------------------------------------- history

describe("the history", () => {
  it("counts distinct local dates (two reports the same day are one)", () => {
    const rows = [...reportsOn(["2021-03-27", "2021-03-27", "2021-03-28"]), flood({ id: "late", start: "2021-03-27T23:59:00-05:00" })];
    expect(floodDates(rows)).toEqual(["2021-03-27", "2021-03-28"]);
  });

  it("takes the larger of the day and the day before, and skips a day with no total of its own", () => {
    const rain = new Map<string, number | null>([
      ["2021-04-01", 2.2],
      ["2021-04-02", 0.4],
      ["2021-05-10", 0.1],
      ["2021-05-11", 0.9],
      ["2021-06-01", null],
    ]);
    expect(rainOnFloodDates(["2021-04-02", "2021-05-11", "2021-06-01"], rain)).toEqual([
      { date: "2021-04-02", rainIn: 2.2 },
      { date: "2021-05-11", rainIn: 0.9 },
    ]);
  });

  it("the headline number is the median total, and needs at least 3 dates", () => {
    const days = [
      { date: "a", rainIn: 2.2 },
      { date: "b", rainIn: 1.8 },
      { date: "c", rainIn: 3 },
    ];
    expect(triggerOf(days)).toBe(2.2); // odd count: the middle one
    expect(triggerOf([...days, { date: "d", rainIn: 2.6 }])).toBe(2.4); // even count: the mean of the middle two
    expect(triggerOf(days.slice(0, 2))).toBeNull();
    expect(triggerOf([])).toBeNull();
  });

  it("one very light day cannot drag the number down (the old 'as little as 0.08 in' was noise)", () => {
    // Nashville's real totals, 22 flood dates, including a 0.08 in day: the lowest is 0.08, the median is not.
    const nashville = [0.77, 0.73, 0.44, 0.37, 1.64, 2.05, 0.91, 1.21, 2.35, 0.9, 0.17, 1.18, 1.49, 0.08, 0.17, 1.05, 1.05, 3.32, 1.51, 1.88, 0.97, 0.76];
    const median = triggerOf(nashville.map((rainIn, i) => ({ date: `d${i}`, rainIn })));
    expect(Math.min(...nashville)).toBe(0.08);
    expect(median).toBe(1.01); // the 11th and 12th of 22 sorted totals: (0.97 + 1.05) / 2
  });
});

// ---------------------------------------------------------------- the forecast

describe("the official forecast", () => {
  it("reads ISO durations", () => {
    expect(parseIsoDuration("PT6H")).toBe(6 * 3_600_000);
    expect(parseIsoDuration("P1D")).toBe(86_400_000);
    expect(parseIsoDuration("PT1H30M")).toBe(90 * 60_000);
    expect(parseIsoDuration("P7DT23H")).toBe((7 * 24 + 23) * 3_600_000);
    expect(parseIsoDuration("soon")).toBeNull();
    expect(parseIsoDuration("P")).toBeNull();
  });

  it("sums periods per local day and splits a period that crosses local midnight", () => {
    // 2026-10-09T03:00Z is 22:00 CDT on the 8th; PT6H runs to 04:00 CDT on the 9th: 2 h on the 8th, 4 h on the 9th.
    const days = forecastByLocalDay(
      [
        { validTime: "2026-10-08T22:00:00+00:00/PT5H", value: 25.4 }, // 17:00 to 22:00 CDT on the 8th
        { validTime: "2026-10-09T03:00:00+00:00/PT6H", value: 25.4 }, // 22:00 CDT to 04:00 CDT
        { validTime: "2026-10-09T09:00:00+00:00/PT6H", value: 25.4 }, // 04:00 to 10:00 on the 9th
      ],
      "America/Chicago",
      NOW,
    );
    expect(days).toEqual([
      { date: "2026-10-08", inches: 1.33 }, // 1 + 1/3
      { date: "2026-10-09", inches: 1.67 }, // 2/3 + 1
    ]); // the 10th has no data and is left out, never shown as dry
  });

  it("uses the address's own time zone to decide what 'today' is", () => {
    // 03:00 UTC on the 9th is still the 8th in Nashville.
    const days = forecastByLocalDay([{ validTime: "2026-10-09T01:00:00+00:00/PT2H", value: 25.4 }], "America/Chicago", new Date("2026-10-09T03:00:00Z"));
    expect(days[0].date).toBe("2026-10-08");
  });

  it("compares with the median: below under 80% of it, near within 20% either way, above past 120%", () => {
    expect(compareForecast(1.91, 2.4)).toBe("below");
    expect(compareForecast(1.92, 2.4)).toBe("near"); // exactly 80%
    expect(compareForecast(2.4, 2.4)).toBe("near");
    expect(compareForecast(2.88, 2.4)).toBe("near"); // exactly 120%
    expect(compareForecast(2.89, 2.4)).toBe("above");
    expect(compareForecast(0, 0.9)).toBe("below");
  });
});

// ---------------------------------------------------------------- the whole signal

describe("buildFloodTrigger", () => {
  it("fewer than 3 flood dates: 'not enough history', and no outside call at all", async () => {
    const { trigger, calls } = await build(reportsOn(["2021-04-02", "2021-05-11"]));
    expect(calls).toEqual([]);
    expect(trigger).toMatchObject({ status: "insufficient", floodDays: 2, triggerIn: null, history: [], forecast: null });
    expect(triggerCopy(trigger)).toMatchObject({ tone: "none", headline: "Not enough history at this address yet." });
  });

  it("above: tomorrow's official forecast is well past the typical rain on days with flood reports", async () => {
    // 79 mm is 3.1 in, forecast for tomorrow (the 9th).
    const { trigger } = await build(reportsOn(DATES), { grid: () => ok(grid([0, 79, 0])) });
    expect(trigger.status).toBe("ready");
    expect(trigger.floodDays).toBe(4);
    expect(trigger.triggerIn).toBe(2.4);
    expect(trigger.history.map((d) => d.rainIn)).toEqual([2.2, 3, 1.8, 2.6]);
    expect(trigger.forecast).toMatchObject({ verdict: "above", peak: { date: "2026-10-09", inches: 3.11 }, updated: "2026-10-08T12:00:00+00:00" });
    expect(trigger.forecast?.days.map((d) => d.date)).toEqual(["2026-10-08", "2026-10-09", "2026-10-10"]);

    const copy = triggerCopy(trigger);
    expect(copy.tone).toBe("above");
    expect(copy.headline).toBe("Tomorrow’s official forecast (3.1 in) is above the typical rain on days with flood reports here.");
    expect(copy.context[0]).toBe("On days with flood reports here, the typical rain was 2.4 in.");
    expect(copy.context[1]).toBe("On 4 of the 4 days with flood reports here, the rain was under 3.1 in.");
  });

  it("below: a dry week is well below the trigger", async () => {
    const { trigger } = await build(reportsOn(DATES), { grid: () => ok(grid([0, 5, 0])) });
    expect(trigger.forecast).toMatchObject({ verdict: "below", peak: { inches: 0.2 } });
    expect(triggerCopy(trigger)).toMatchObject({
      tone: "below",
      headline: "The next 3 days’ forecast (up to 0.2 in a day) is well below the typical rain on days with flood reports here.",
    });
  });

  it("below with no rain at all says so plainly", async () => {
    const { trigger } = await build(reportsOn(DATES), { grid: () => ok(grid([0, 0, 0])) });
    expect(triggerCopy(trigger).headline).toBe("The next 3 days’ forecast (no measurable rain) is well below the typical rain on days with flood reports here.");
  });

  it("near: within 20% of the typical rain, on either side", async () => {
    const { trigger } = await build(reportsOn(DATES), { grid: () => ok(grid([0, 0, 60])) }); // 2.36 in on the 10th
    expect(trigger.forecast?.verdict).toBe("near");
    expect(triggerCopy(trigger).headline).toBe("Saturday’s official forecast (2.4 in) is close to the typical rain on days with flood reports here.");
    expect(triggerCopy(trigger).context).toEqual(["On days with flood reports here, the typical rain was 2.4 in."]); // no "N of M days under" line: near the median it would only say "about half"
    const highEdge = await build(reportsOn(DATES), { grid: () => ok(grid([0, 0, 70])) }); // 2.76 in: 115% of 2.4
    expect(highEdge.trigger.forecast?.verdict).toBe("near");
    const lowEdge = await build(reportsOn(DATES), { grid: () => ok(grid([0, 0, 50])) }); // 1.97 in: 82% of 2.4
    expect(lowEdge.trigger.forecast?.verdict).toBe("near");
    const under = await build(reportsOn(DATES), { grid: () => ok(grid([0, 0, 45])) }); // 1.77 in: 74%
    expect(under.trigger.forecast?.verdict).toBe("below");
  });

  it("a forecast that fails: the history still shows, with a plain note, and the verdict is absent", async () => {
    for (const handlers of [{ points: () => httpError(503) }, { grid: () => httpError(500) }, { points: hang }]) {
      clearRainCache();
      vi.useFakeTimers();
      const pending = build(reportsOn(DATES), handlers);
      await vi.advanceTimersByTimeAsync(8_100);
      const { trigger } = await pending;
      vi.useRealTimers();
      expect(trigger.status).toBe("ready");
      expect(trigger.triggerIn).toBe(2.4);
      expect(trigger.forecast).toBeNull();
      expect(trigger.notices.forecast).toMatch(/National Weather Service forecast/);
      const copy = triggerCopy(trigger);
      expect(copy.tone).toBe("history");
      expect(copy.headline).toBe("On days with flood reports here, the typical rain was 2.4 in.");
      expect(copy.notice).toMatch(/National Weather Service forecast/);
    }
  });

  it("a points reply with no grid link, or a grid in other units, is not trusted", async () => {
    const noLink = await build(reportsOn(DATES), { points: () => ok({ properties: { timeZone: "America/Chicago" } }) });
    expect(noLink.trigger.forecast).toBeNull();
    expect(noLink.trigger.notices.forecast).toMatch(/no rain forecast/);

    const elsewhere = await build(reportsOn(DATES), { points: () => ok({ properties: { ...POINTS.properties, forecastGridData: "https://evil.example/grid" } }) });
    expect(elsewhere.calls.some((url) => url.includes("evil.example"))).toBe(false);
    expect(elsewhere.trigger.forecast).toBeNull();

    const inches = await build(reportsOn(DATES), { grid: () => ok(grid([0, 3, 0], "wmoUnit:in")) });
    expect(inches.trigger.forecast).toBeNull();
  });

  it("the rain history failing means no trigger and no verdict, never a made-up number", async () => {
    const { trigger } = await build(reportsOn(DATES), { archive: () => httpError(429) });
    expect(trigger).toMatchObject({ status: "unavailable", triggerIn: null, forecast: null });
    expect(trigger.notices.history).toMatch(/Open-Meteo/);
    expect(triggerCopy(trigger).tone).toBe("error");
  });

  it("asks the archive in inches, for just the days around the flood dates (a flood date and the day before)", async () => {
    const { calls } = await build(reportsOn(DATES));
    const archiveCalls = calls.filter((url) => url.includes("archive-api"));
    expect(archiveCalls).toHaveLength(4); // four dates months apart: four one-day-pair requests, not six months of data
    expect(archiveCalls[0]).toContain("start_date=2021-04-01");
    expect(archiveCalls[0]).toContain("end_date=2021-04-02");
    expect(archiveCalls.every((url) => url.includes("daily=precipitation_sum") && url.includes("precipitation_unit=inch") && url.includes("models=era5"))).toBe(true);
  });
});

describe("keeping inside Open-Meteo's free daily allowance", () => {
  it("shares one request between nearby dates", () => {
    expect(rainRanges(["2021-03-27", "2021-03-28"])).toEqual([{ start: "2021-03-26", end: "2021-03-28" }]);
    expect(rainRanges(["2019-02-06", "2019-02-20", "2019-02-23"])).toEqual([{ start: "2019-02-05", end: "2019-02-23" }]); // 19 days is still 2 calls, not 3
  });

  it("keeps far-apart dates as separate short requests, not one long span of years", () => {
    const ranges = rainRanges(["2015-06-08", "2019-02-06", "2025-05-20"]);
    expect(ranges).toEqual([
      { start: "2015-06-07", end: "2015-06-08" },
      { start: "2019-02-05", end: "2019-02-06" },
      { start: "2025-05-19", end: "2025-05-20" },
    ]);
  });

  it("uses one request when that is cheaper than several", () => {
    expect(rainRanges(["2021-04-02", "2021-04-12"])).toEqual([{ start: "2021-04-01", end: "2021-04-12" }]);
  });

  it("is an empty list for no dates", () => {
    expect(rainRanges([])).toEqual([]);
  });

  it("the 22 flood dates of the Nashville sample cost about 20 calls of the 10,000 a day, not about 290", () => {
    const nashville = ["2015-06-08", "2016-07-07", "2017-04-18", "2017-07-15", "2017-08-31", "2017-09-01", "2019-02-06", "2019-02-20", "2019-02-23", "2019-07-22", "2019-08-13", "2021-03-27", "2021-03-28", "2021-07-31", "2021-08-18", "2021-09-21", "2022-02-17", "2024-05-09", "2025-02-15", "2025-04-03", "2025-04-05", "2025-05-20"];
    const days = (r: { start: string; end: string }) => (Date.parse(r.end) - Date.parse(r.start)) / 86_400_000 + 1;
    const cost = rainRanges(nashville).reduce((sum, r) => sum + Math.max(1, Math.ceil(days(r) / 14)), 0);
    expect(cost).toBeLessThanOrEqual(25);
  });
});

// ---------------------------------------------------------------- the words

describe("the words", () => {
  const ready = (verdict: "below" | "near" | "above", peakIn: number, triggerIn = 2.4): FloodTrigger => ({
    status: "ready",
    floodDays: 3,
    triggerIn,
    history: [
      { date: "2021-04-02", rainIn: triggerIn },
      { date: "2021-05-11", rainIn: 2.4 },
      { date: "2021-07-04", rainIn: 3 },
    ],
    forecast: { days: [{ date: "2026-10-08", inches: 0 }, { date: "2026-10-09", inches: peakIn }, { date: "2026-10-10", inches: 0 }], peak: { date: "2026-10-09", inches: peakIn }, verdict, updated: null },
    notices: {},
  });

  it("never says a flood 'will' happen or that anything is predicted", () => {
    const all: FloodTrigger[] = [
      ready("above", 3.1),
      ready("near", 1.6),
      ready("below", 0.2),
      ready("below", 0),
      { ...ready("above", 3.1), forecast: null },
      { status: "insufficient", floodDays: 1, triggerIn: null, history: [], forecast: null, notices: {} },
      { status: "unavailable", floodDays: 5, triggerIn: null, history: [], forecast: null, notices: { history: "x" } },
    ];
    for (const trigger of all) {
      const copy = triggerCopy(trigger);
      const text = [copy.headline, ...copy.context, copy.notice ?? "", TRIGGER_FINE_PRINT].join(" ").toLowerCase();
      expect(text).not.toMatch(/will flood|will be flood|predict|forecast(s|ed)? a flood|going to flood/);
    }
    expect(TRIGGER_FINE_PRINT).toBe("Based on NWS reports near this address and ERA5 rainfall; a history-based signal, not a flood forecast.");
  });

  it("formats inches and day names", () => {
    expect(formatInches(0.08)).toBe("0.08");
    expect(formatInches(0.17)).toBe("0.2");
    expect(formatInches(3.11)).toBe("3.1");
    expect(dayPossessive(0, "2026-10-08")).toBe("Today’s");
    expect(dayPossessive(1, "2026-10-09")).toBe("Tomorrow’s");
    expect(dayPossessive(2, "2026-10-10")).toBe("Saturday’s");
  });
});

// ---------------------------------------------------------------- through the whole lookup

describe("the lookup payload", () => {
  beforeEach(() => {
    clearHeatCache();
    clearRainCache();
  });

  const index: StateIndex = { state: "TN", built: "2026-10-07T00:00:00Z", sources: [], floods: reportsOn(DATES), tornadoes: [] };
  const deps = (nws: (url: string) => Response): LookupDeps => ({
    fetch: async (url) => {
      if (url.includes("geocoding.geo.census.gov")) return ok(CENSUS_NASHVILLE);
      if (url.includes("hazards.fema.gov")) return ok(FEMA_ZONE_X);
      if (url.includes("api.weather.gov")) return nws(url);
      if (url.includes("archive-api.open-meteo.com")) return ok(url.includes("precipitation_sum") ? archive(RAIN) : openMeteoReply(heatYear(2024)));
      throw new Error(`unrouted URL in test: ${url}`);
    },
    loadIndex: async () => index,
    loadHeatGrid: async () => null,
    now: () => NOW,
  });

  it("adds floodTrigger without touching anything else", async () => {
    const nws = (url: string) => (url.includes("/points/") ? ok(POINTS) : url.includes("/gridpoints/") ? ok(grid([0, 79, 0])) : ok({ features: [] }));
    const payload = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", deps(nws));
    expect(payload.floodTrigger.status).toBe("ready");
    expect(payload.floodTrigger.triggerIn).toBe(2.4);
    expect(payload.floodTrigger.forecast?.verdict).toBe("above");
    expect(payload.floods.reports).toHaveLength(4);
    expect(payload.live).toEqual({ checkedAt: NOW.toISOString(), alerts: [] });
    expect(payload.notices).toEqual({});
  });

  it("a failing forecast service leaves the rest of the payload alone", async () => {
    const nws = (url: string) => (url.includes("/points/") ? httpError(503) : ok({ features: [] }));
    const payload = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", deps(nws));
    expect(payload.floodTrigger.status).toBe("ready");
    expect(payload.floodTrigger.forecast).toBeNull();
    expect(payload.floodTrigger.notices.forecast).toMatch(/503/);
    expect(payload.live?.alerts).toEqual([]);
    expect(payload.fema).not.toBeNull();
  });

  it("an unindexed state has an 'insufficient' trigger and makes no rain calls", async () => {
    const calls: string[] = [];
    const base = deps(() => ok({ features: [] }));
    const payload = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", {
      ...base,
      fetch: async (url, init) => {
        calls.push(url);
        return base.fetch(url, init);
      },
      loadIndex: async () => null,
    });
    expect(payload.floodTrigger).toMatchObject({ status: "insufficient", floodDays: 0 });
    expect(calls.some((url) => url.includes("/points/") || url.includes("precipitation_sum"))).toBe(false);
  });
});
