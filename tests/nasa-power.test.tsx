/**
 * NASA POWER (MERRA-2) as the fallback when Open-Meteo is rate limited or down. Fixtures only: every outside call is faked by URL.
 * The heat index is the National Weather Service's Rothfusz formula; the expected values below are the NWS heat index chart's.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { HeatPanel } from "@/components/views/heat/HeatPanel";
import { TriggerCard } from "@/components/panel/TriggerCard";
import { buildFloodTrigger, clearRainCache, fetchRainForDates } from "@/lib/flood-trigger";
import { lookupAddress, type LookupDeps } from "@/lib/lookup";
import { clearPowerCaches, fetchPowerHeat, fetchPowerRain, heatDaysFromPower, heatIndexF, humidityAtHigh, powerUrl, rainFromPower } from "@/lib/nasa-power";
import { clearHeatCache, fetchDailyFeelsLike } from "@/lib/sources";
import type { LookupPayload } from "@/lib/types";
import { heatLabels } from "@/lib/ui/data-source";
import { triggerFinePrint } from "@/lib/ui/trigger-text";
import { buildSources } from "@/lib/ai/sources";
import { CENSUS_NASHVILLE, FEMA_ZONE_X, flood, httpError, NASHVILLE, NO_ALERTS, fakeFetch, ok, openMeteoReply, heatYear } from "./helpers";
import { lookupFixture, outlookFixture } from "./ai-fixtures";

const NOW = new Date("2026-10-08T14:00:00Z");

/** A POWER reply: one entry per YYYYMMDD with the parameters given. -999 is POWER's missing-value mark. */
function power(days: Record<string, Partial<Record<"T2M_MAX" | "QV2M" | "PS" | "RH2M" | "PRECTOTCORR", number>>>) {
  const parameter: Record<string, Record<string, number>> = {};
  for (const [date, values] of Object.entries(days)) {
    for (const [name, value] of Object.entries(values)) (parameter[name] ??= {})[date] = value as number;
  }
  return { type: "Feature", properties: { parameter }, header: { fill_value: -999, time_standard: "LST" } };
}

beforeEach(() => {
  clearHeatCache();
  clearPowerCaches();
  clearRainCache();
});

describe("the NWS heat index (Rothfusz)", () => {
  it("matches the NWS chart", () => {
    expect(heatIndexF(90, 60)).toBeCloseTo(99.7, 1); // chart: 100
    expect(heatIndexF(100, 40)).toBeCloseTo(109.3, 1); // chart: 109
    expect(heatIndexF(110, 40)).toBeCloseTo(135.7, 1); // chart: 136
    expect(heatIndexF(85, 90)).toBeCloseTo(101.8, 1); // chart: 102 (the humid-and-mild adjustment)
    expect(heatIndexF(96, 45)).toBeCloseTo(104.0, 1);
  });

  it("uses the simple formula when it is not hot, and the dry-air adjustment when it is very dry", () => {
    expect(heatIndexF(70, 50)).toBeCloseTo(69.05, 1);
    expect(heatIndexF(95, 10)).toBeCloseTo(89.45, 1);
    expect(heatIndexF(95, 10)).toBeLessThan(heatIndexF(95, 20));
  });

  it("is steady at the edges of humidity", () => {
    expect(Number.isFinite(heatIndexF(105, 0))).toBe(true);
    expect(heatIndexF(105, 140)).toBe(heatIndexF(105, 100));
  });
});

describe("humidity at the day's high", () => {
  it("works it out from the day's specific humidity and the surface pressure (the air is driest when it is hottest)", () => {
    // Nashville, 2012-06-29: high 42.74 C, 10.77 g/kg, 98.79 kPa. The whole-day average humidity POWER reports is 38%; at the high it is about 20%.
    expect(humidityAtHigh(42.74, 10.77, 98.79, 38.08)).toBeCloseTo(19.9, 0);
  });

  it("falls back to the day's average humidity when specific humidity or pressure is missing, and to null when there is nothing", () => {
    expect(humidityAtHigh(30, -999, 98, 55)).toBe(55);
    expect(humidityAtHigh(30, 10, undefined, 55)).toBe(55);
    expect(humidityAtHigh(30, undefined, undefined, undefined)).toBeNull();
    expect(humidityAtHigh(30, undefined, undefined, -999)).toBeNull();
  });
});

describe("reading a POWER reply", () => {
  it("turns daily highs into heat-index highs, local dates, one decimal", () => {
    const days = heatDaysFromPower(power({ "20120628": { T2M_MAX: 41.01, QV2M: 8.43, PS: 99.07, RH2M: 37.25 }, "20120629": { T2M_MAX: 42.74, QV2M: 10.77, PS: 98.79, RH2M: 38.08 } }));
    expect(days.map((d) => d.date)).toEqual(["2012-06-28", "2012-06-29"]);
    expect(days[1].feelsF).toBeCloseTo(110.2, 0);
    expect(days[1].feelsF).toBe(Math.round(days[1].feelsF * 10) / 10);
  });

  it("leaves out a day with no temperature (-999) or no humidity at all, and never invents one", () => {
    const days = heatDaysFromPower(power({ "20200101": { T2M_MAX: -999, RH2M: 50 }, "20200102": { T2M_MAX: 30 }, "20200103": { T2M_MAX: 30, RH2M: 50 } }));
    expect(days.map((d) => d.date)).toEqual(["2020-01-03"]);
    expect(heatDaysFromPower({})).toEqual([]);
  });

  it("converts millimetres of rain to inches, and a missing day is null (not dry)", () => {
    const rain = rainFromPower(power({ "20210402": { PRECTOTCORR: 25.4 }, "20210403": { PRECTOTCORR: 0 }, "20210404": { PRECTOTCORR: -999 } }));
    expect([...rain]).toEqual([["2021-04-02", 1], ["2021-04-03", 0], ["2021-04-04", null]]);
  });

  it("asks for local solar days on the 0.05 degree cell, with no key", () => {
    const url = powerUrl(36.16, -86.78, ["PRECTOTCORR"], "2021-04-01", "2021-04-02");
    expect(url).toBe("https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR&community=RE&longitude=-86.78&latitude=36.16&start=20210401&end=20210402&format=JSON&time-standard=LST");
    expect(url).not.toMatch(/key|token/i);
  });
});

describe("fetchPowerHeat and fetchPowerRain", () => {
  it("keeps a good answer for the cell (one request), and does not keep a failure", async () => {
    let calls = 0;
    const fetchFn = async () => (calls += 1, calls === 1 ? httpError(503) : ok(power({ "20240710": { T2M_MAX: 38, QV2M: 12, PS: 99, RH2M: 40 } })));
    const failed = await fetchPowerHeat(36.168, -86.777, fetchFn, () => NOW);
    expect(failed.value).toBeNull();
    expect(failed.notice).toBe("The NASA POWER (MERRA-2) weather archive returned an error (HTTP 503).");
    expect((await fetchPowerHeat(36.168, -86.777, fetchFn, () => NOW)).value).toHaveLength(1);
    await fetchPowerHeat(36.171, -86.78, fetchFn, () => NOW); // same 0.05 degree cell
    expect(calls).toBe(2);
  });

  it("says plainly when POWER has no rain for the range", async () => {
    const result = await fetchPowerRain(36.1, -86.7, "2021-04-01", "2021-04-02", async () => ok(power({})), () => NOW);
    expect(result.notice).toBe("The NASA POWER (MERRA-2) weather archive had no rainfall records for this address.");
  });
});

describe("heat: Open-Meteo first, NASA POWER when it fails", () => {
  const POWER_OK = power({ "20240709": { T2M_MAX: 36, QV2M: 11, PS: 99, RH2M: 45 }, "20240710": { T2M_MAX: 40, QV2M: 12, PS: 99, RH2M: 40 } });

  it("a 429 from Open-Meteo is answered by NASA POWER, and the answer says so", async () => {
    const urls: string[] = [];
    const fetchFn = fakeFetch({ meteo: () => httpError(429), power: (url) => (urls.push(url), ok(POWER_OK)) });
    const result = await fetchDailyFeelsLike(39.7392, -104.9903, fetchFn, () => NOW);
    expect(result.source).toBe("nasa-power");
    expect(result.notice).toBeUndefined();
    expect(result.value?.map((d) => d.date)).toEqual(["2024-07-09", "2024-07-10"]);
    expect(urls[0]).toContain("parameters=T2M_MAX,QV2M,PS,RH2M");
    expect(urls[0]).toContain("start=20000101&end=20251231");
  });

  it("a good Open-Meteo answer never touches NASA POWER", async () => {
    const result = await fetchDailyFeelsLike(36.1, -86.7, fakeFetch({ meteo: () => ok(openMeteoReply(heatYear(2024, { "2024-07-10": 108 }))) }), () => NOW);
    expect(result.source).toBe("open-meteo");
  });

  it("a timeout or an empty Open-Meteo answer falls back too", async () => {
    const empty = await fetchDailyFeelsLike(36.1, -86.7, fakeFetch({ meteo: () => ok({ daily: { time: [], apparent_temperature_max: [] } }), power: () => ok(POWER_OK) }), () => NOW);
    expect(empty.source).toBe("nasa-power");
  });

  it("when both fail, both reasons are in the notice", async () => {
    const result = await fetchDailyFeelsLike(36.1, -86.7, fakeFetch({ meteo: () => httpError(429), power: () => httpError(500) }), () => NOW);
    expect(result.value).toBeNull();
    expect(result.notice).toBe("The Open-Meteo weather archive returned an error (HTTP 429). The fallback did not work either: The NASA POWER (MERRA-2) weather archive returned an error (HTTP 500).");
  });

  it("a lookup keeps going: heat comes from POWER, is marked, and the regional Open-Meteo map is not linked to it", async () => {
    const deps: LookupDeps = {
      fetch: fakeFetch({ census: () => ok(CENSUS_NASHVILLE), fema: () => ok(FEMA_ZONE_X), nws: () => ok(NO_ALERTS), meteo: () => httpError(429), power: () => ok(POWER_OK) }),
      loadIndex: async () => ({ state: "TN", built: "x", sources: [], floods: [], tornadoes: [] }),
      loadHeatGrid: async () => ({ slug: "nashville", label: "x", source: "x", days: ["2024-07-04", "2024-07-10"], step: 0.5, bounds: { lon: [-90, -85], lat: [34, 37] }, cells: [] }),
      now: () => NOW,
    };
    const payload = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", deps);
    expect(payload.heat?.provider).toBe("nasa-power");
    expect(payload.heat?.regionalSlug).toBeNull();
    expect(payload.notices.heat).toBeUndefined();
    expect(payload.heat?.hottest.date).toBe("2024-07-10");
  });

  it("a normal lookup carries no provider mark", async () => {
    const deps: LookupDeps = {
      fetch: fakeFetch({ census: () => ok(CENSUS_NASHVILLE), fema: () => ok(FEMA_ZONE_X), nws: () => ok(NO_ALERTS), meteo: () => ok(openMeteoReply(heatYear(2024, { "2024-07-10": 108 }))) }),
      loadIndex: async () => null,
      loadHeatGrid: async () => null,
      now: () => NOW,
    };
    expect((await lookupAddress("x", deps)).heat?.provider).toBeUndefined();
  });
});

describe("the flood trigger's rain: ERA5 first, NASA POWER when Open-Meteo fails", () => {
  const DATES = ["2021-04-02", "2021-05-11", "2021-07-04"];
  const reports = DATES.map((date, i) => flood({ id: `r${i}`, start: `${date}T22:55:00-05:00`, filed: [36.17, -86.78] }));
  // Each flood date and the day before, in mm (25.4 mm = 1 in). The larger of the two is used: 2.0, 3.0, 1.0 in.
  const MM = power({
    "20210401": { PRECTOTCORR: 50.8 }, "20210402": { PRECTOTCORR: 5.08 },
    "20210510": { PRECTOTCORR: 0 }, "20210511": { PRECTOTCORR: 76.2 },
    "20210703": { PRECTOTCORR: 25.4 }, "20210704": { PRECTOTCORR: 2.54 },
  });
  const POINTS = { properties: { forecastGridData: "https://api.weather.gov/gridpoints/OHX/50,57", timeZone: "America/Chicago" } };
  const GRID = { properties: { updateTime: "2026-10-08T12:00:00+00:00", quantitativePrecipitation: { uom: "wmoUnit:mm", values: [{ validTime: "2026-10-08T05:00:00+00:00/P1D", value: 2.54 }] } } };

  function fetchFor(archive: (url: string) => Response, powerRoute: (url: string) => Response = () => ok(MM)) {
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url);
      if (url.includes("archive-api.open-meteo.com")) return archive(url);
      if (url.includes("power.larc.nasa.gov")) return powerRoute(url);
      if (url.includes("api.weather.gov/points/")) return ok(POINTS);
      if (url.includes("api.weather.gov/gridpoints/")) return ok(GRID);
      throw new Error(`unrouted URL in test: ${url}`);
    };
    return { fetchFn, calls };
  }

  it("a 429 gives a ready trigger from NASA POWER, marked, with the right inches and the NWS forecast untouched", async () => {
    const { fetchFn, calls } = fetchFor(() => httpError(429));
    const trigger = await buildFloodTrigger({ lat: NASHVILLE[0], lon: NASHVILLE[1] }, reports, { fetch: fetchFn, now: () => NOW });
    expect(trigger.status).toBe("ready");
    expect(trigger.rainSource).toBe("nasa-power");
    expect(trigger.history).toEqual([{ date: "2021-04-02", rainIn: 2 }, { date: "2021-05-11", rainIn: 3 }, { date: "2021-07-04", rainIn: 1 }]);
    expect(trigger.triggerIn).toBe(2);
    expect(trigger.forecast?.peak.inches).toBe(0.1);
    // One POWER request for the whole span, not one per range.
    expect(calls.filter((u) => u.includes("power.larc.nasa.gov"))).toHaveLength(1);
    expect(calls.find((u) => u.includes("power.larc.nasa.gov"))).toContain("parameters=PRECTOTCORR");
  });

  it("with Open-Meteo working there is no POWER call and no mark", async () => {
    const era5 = { daily: { time: ["2021-04-01", "2021-04-02", "2021-05-10", "2021-05-11", "2021-07-03", "2021-07-04"], precipitation_sum: [2, 0.2, 0, 3, 1, 0.1] } };
    const { fetchFn, calls } = fetchFor(() => ok(era5));
    const trigger = await buildFloodTrigger({ lat: NASHVILLE[0], lon: NASHVILLE[1] }, reports, { fetch: fetchFn, now: () => NOW });
    expect(trigger.status).toBe("ready");
    expect(trigger.rainSource).toBeUndefined();
    expect(calls.some((u) => u.includes("power.larc.nasa.gov"))).toBe(false);
  });

  it("a snapshot for some dates plus POWER for the rest is 'mixed'", async () => {
    const { fetchFn } = fetchFor(() => httpError(429));
    const known = { "2021-04-01": 2, "2021-04-02": 0.2 };
    const trigger = await buildFloodTrigger({ lat: NASHVILLE[0], lon: NASHVILLE[1] }, reports, { fetch: fetchFn, now: () => NOW, knownRain: known });
    expect(trigger.rainSource).toBe("mixed");
    expect(trigger.history.map((d) => d.rainIn)).toEqual([2, 3, 1]);
  });

  it("some ranges from Open-Meteo and some from POWER is 'mixed' too, and POWER is asked only for the ranges that failed", async () => {
    const far = ["2015-04-02", "2021-05-11"];
    const { fetchFn, calls } = fetchFor((url) => (url.includes("start_date=2015") ? ok({ daily: { time: ["2015-04-01", "2015-04-02"], precipitation_sum: [1, 0] } }) : httpError(429)));
    const result = await fetchRainForDates(36.1, -86.7, far, fetchFn, () => NOW);
    expect(result.origin).toBe("mixed");
    expect(result.rain?.get("2015-04-01")).toBe(1);
    expect(result.rain?.get("2021-05-11")).toBe(3);
    expect(calls.find((u) => u.includes("power.larc.nasa.gov"))).toContain("start=20210510&end=20210511");
  });

  it("both down: unavailable, with Open-Meteo's reason first and the fallback's after", async () => {
    const { fetchFn } = fetchFor(() => httpError(429), () => httpError(503));
    const trigger = await buildFloodTrigger({ lat: NASHVILLE[0], lon: NASHVILLE[1] }, reports, { fetch: fetchFn, now: () => NOW });
    expect(trigger.status).toBe("unavailable");
    expect(trigger.notices.history).toBe("The Open-Meteo weather archive returned an error (HTTP 429). The fallback did not work either: The NASA POWER (MERRA-2) weather archive returned an error (HTTP 503).");
  });
});

describe("the page names the source honestly", () => {
  const nashville = lookupFixture();
  const withPower: LookupPayload = { ...nashville, heat: { ...nashville.heat!, provider: "nasa-power" } };

  it("heat labels", () => {
    expect(heatLabels(nashville.heat)).toMatchObject({ measure: "feels-like", fallback: false, explain: null });
    expect(heatLabels(withPower.heat)).toMatchObject({ measure: "heat index", source: "NASA POWER (MERRA-2)", fallback: true });
    expect(heatLabels(withPower.heat).explain).toContain("Open-Meteo was not answering");
  });

  it("the heat panel says NASA POWER (MERRA-2) and heat index, and not ERA5, when POWER stood in", () => {
    const html = renderToStaticMarkup(<HeatPanel data={withPower} regional={null} />);
    expect(html).toContain("NASA POWER (MERRA-2)");
    expect(html).toContain("heat index high on");
    expect(html).toContain("different measure from the usual feels-like");
    expect(html).not.toContain("ERA5");
    expect(html).not.toContain("feels-like high on");
  });

  it("the heat panel is unchanged when Open-Meteo answered", () => {
    const html = renderToStaticMarkup(<HeatPanel data={nashville} regional={null} />);
    expect(html).toContain("ERA5 via Open-Meteo");
    expect(html).toContain("feels-like high on");
    expect(html).not.toContain("NASA POWER");
  });

  it("the flood trigger fine print and card name the rain source", () => {
    expect(triggerFinePrint({})).toBe("Based on NWS reports near this address and ERA5 rainfall; a history-based signal, not a flood forecast.");
    expect(triggerFinePrint({ rainSource: "nasa-power" })).toBe("Based on NWS reports near this address and NASA POWER (MERRA-2) rainfall; a history-based signal, not a flood forecast.");
    expect(triggerFinePrint({ rainSource: "mixed" })).toContain("ERA5 and NASA POWER (MERRA-2) rainfall");
    const html = renderToStaticMarkup(
      <TriggerCard trigger={{ status: "ready", floodDays: 3, triggerIn: 2, history: [{ date: "2021-04-02", rainIn: 2 }], forecast: null, notices: {}, rainSource: "nasa-power" }} />,
    );
    expect(html).toContain("NASA POWER (MERRA-2) (Open-Meteo was not answering");
    expect(html).toContain("NASA POWER (MERRA-2) rainfall; a history-based signal");
    expect(html).not.toContain("ERA5");
  });

  it("the AI is told the heat history came from NASA POWER, so it can say so", () => {
    const sources = new Map(buildSources({ lookup: withPower, outlook: outlookFixture(), damage: [] }).map((s) => [s.id, s]));
    const history = sources.get("heat-history")!;
    expect(history.origin).toContain("NASA POWER (MERRA-2)");
    expect(history.text).toContain("heat index high of 100 F or more");
    expect(history.text).toContain("different measure from the usual feels-like");
    const normal = new Map(buildSources({ lookup: nashville, outlook: outlookFixture(), damage: [] }).map((s) => [s.id, s]));
    expect(normal.get("heat-history")!.origin).toContain("Open-Meteo");
  });
});
