/** Measured rain on flood days from NOAA's station records (lib/rain-gauge.ts), and the flood trigger using it first. Fake fetch only. */
import { beforeEach, describe, expect, it } from "vitest";
import { buildFloodTrigger, clearRainCache } from "@/lib/flood-trigger";
import { clearGaugeCache, fetchGaugeRain, gaugeRainOnDates, readInTheMorning, readingsFrom, stationsFrom, type GaugeStation } from "@/lib/rain-gauge";
import { rainLabel } from "@/lib/ui/data-source";

const NASHVILLE: [number, number] = [36.1682, -86.7775];
const NOW = new Date("2026-10-09T12:00:00Z");

const searchResult = (id: string, name: string, lon: number, lat: number, coverage = 99, start = "1948-01-01T00:00:00", end = "2026-10-03T23:59:59") => ({
  stations: [{ id, name, dataTypes: [{ id: "WT03", coverage: 14 }, { id: "PRCP", coverage, startDate: start, endDate: end }] }],
  boundingPoints: [{ coordinates: [lon, lat] as [number, number] }],
});
const SEARCH = {
  results: [
    searchResult("USC00406803", "OLD HICKORY DAM, TN US", -86.655, 36.295),
    searchResult("USW00013897", "NASHVILLE INTERNATIONAL AIRPORT, TN US", -86.68815, 36.11054),
    searchResult("USC00499999", "SPOTTY GAUGE, TN US", -86.78, 36.17, 40),
    searchResult("USC00488888", "CLOSED GAUGE, TN US", -86.78, 36.17, 99, "1950-01-01T00:00:00", "1990-12-31T23:59:59"),
    searchResult("USC00477777", "FAR GAUGE, TN US", -85.5, 36.17),
  ],
};

describe("stationsFrom", () => {
  it("keeps good, open stations within 25 km, nearest first", () => {
    const stations = stationsFrom(SEARCH, NASHVILLE[0], NASHVILLE[1], "2015-01-01", "2025-12-31");
    expect(stations.map((s) => s.id)).toEqual(["USW00013897", "USC00406803"]);
    expect(stations[0].km).toBeCloseTo(10.2, 0);
  });
});

describe("gaugeRainOnDates", () => {
  const airport: GaugeStation = { id: "USW00013897", name: "NASHVILLE INTERNATIONAL AIRPORT, TN US", km: 10.2 };
  const coop: GaugeStation = { id: "USC00406803", name: "OLD HICKORY DAM, TN US", km: 15.1 };

  it("an airport counts the day before and the day itself", () => {
    const readings = readingsFrom([
      { STATION: airport.id, DATE: "2021-03-26", PRCP: "0.10" },
      { STATION: airport.id, DATE: "2021-03-27", PRCP: "5.75" },
      { STATION: airport.id, DATE: "2021-03-28", PRCP: "9.00" },
    ]);
    expect(gaugeRainOnDates(["2021-03-27"], [airport], readings)).toEqual([{ date: "2021-03-27", rainIn: 5.75, station: airport.name, stationKm: 10.2, gauges: 1 }]);
  });

  it("a morning gauge counts through the next morning's reading, and needs it", () => {
    const readings = readingsFrom([
      { STATION: coop.id, DATE: "2021-03-27", PRCP: "0.50" },
      { STATION: coop.id, DATE: "2021-03-28", PRCP: "6.10" },
    ]);
    expect(readInTheMorning(coop.id)).toBe(true);
    expect(gaugeRainOnDates(["2021-03-27"], [coop], readings)[0].rainIn).toBe(6.1);
    expect(gaugeRainOnDates(["2021-03-28"], [coop], readings)).toEqual([]);
  });

  it("counts only the stations that read the day, and leaves out a date no gauge read", () => {
    const readings = readingsFrom([{ STATION: coop.id, DATE: "2021-05-12", PRCP: "2.00" }, { STATION: airport.id, DATE: "2021-05-11", PRCP: "" }]);
    expect(gaugeRainOnDates(["2021-05-11", "2021-07-04"], [airport, coop], readings)).toEqual([{ date: "2021-05-11", rainIn: 2, station: coop.name, stationKm: 15.1, gauges: 1 }]);
  });

  it("takes the median across the gauges, so one that folded a missed day into the next cannot decide the date", () => {
    const third: GaugeStation = { id: "US1TNDV0047", name: "BERRY HILL 1.6 WNW, TN US", km: 5 };
    const readings = readingsFrom([
      // The airport, midnight to midnight.
      { STATION: airport.id, DATE: "2021-03-27", PRCP: "5.75" },
      // Shelby Bottoms, read at 8 am: 0.00 on the 28th, then the folded 4.64 on the 29th (outside the window).
      { STATION: coop.id, DATE: "2021-03-26", PRCP: "1.37" },
      { STATION: coop.id, DATE: "2021-03-28", PRCP: "0.00" },
      { STATION: coop.id, DATE: "2021-03-29", PRCP: "4.64" },
      // A volunteer gauge read the morning after.
      { STATION: third.id, DATE: "2021-03-28", PRCP: "6.10" },
    ]);
    expect(gaugeRainOnDates(["2021-03-27"], [third, airport, coop], readings)).toEqual([{ date: "2021-03-27", rainIn: 5.75, station: third.name, stationKm: 5, gauges: 3 }]);
  });

  it("leaves out a reading NOAA's quality checks flagged", () => {
    const readings = readingsFrom([
      { STATION: airport.id, DATE: "2021-03-27", PRCP: "9.99", PRCP_ATTRIBUTES: ",X,W,2400" },
      { STATION: airport.id, DATE: "2021-03-28", PRCP: "1.00", PRCP_ATTRIBUTES: ",,W,2400" },
    ]);
    expect(readings.get(airport.id)?.has("2021-03-27")).toBe(false);
    expect(readings.get(airport.id)?.get("2021-03-28")).toBe(1);
  });
});

describe("fetchGaugeRain and the flood trigger", () => {
  beforeEach(() => {
    clearGaugeCache();
    clearRainCache();
  });

  const reports = [{ start: "2021-03-27T22:00:00-05:00" }, { start: "2021-05-11T20:00:00-05:00" }, { start: "2021-07-04T18:00:00-05:00" }];
  const json = (body: unknown) => Response.json(body);

  it("asks the station search, then one data request for the nearest stations", async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url);
      if (url.includes("/search/v1/")) return json(SEARCH);
      return json([{ STATION: "USW00013897", DATE: "2021-03-27", PRCP: "5.75" }]);
    };
    const result = await fetchGaugeRain(NASHVILLE[0], NASHVILLE[1], ["2021-03-27"], fetchFn);
    expect(result.days).toEqual([{ date: "2021-03-27", rainIn: 5.75, station: "NASHVILLE INTERNATIONAL AIRPORT, TN US", stationKm: 10.3, gauges: 1 }]);
    expect(calls[1]).toContain("stations=USW00013897,USC00406803");
    expect(calls[1]).toContain("startDate=2021-03-26&endDate=2021-03-28");
  });

  it("a failed search is no days and a plain notice, never a throw", async () => {
    const result = await fetchGaugeRain(NASHVILLE[0], NASHVILLE[1], ["2021-03-27"], async () => new Response("", { status: 503 }));
    expect(result).toEqual({ days: [], notice: "NOAA's station records returned an error (HTTP 503)." });
  });

  it("the trigger uses the gauge where it read the day and the grid for the rest, and says so", async () => {
    const archiveUrls: string[] = [];
    const fetchFn = async (url: string) => {
      if (url.includes("/search/v1/")) return json(SEARCH);
      if (url.includes("/data/v1")) return json([{ STATION: "USW00013897", DATE: "2021-03-27", PRCP: "5.75" }, { STATION: "USW00013897", DATE: "2021-05-11", PRCP: "2.10" }]);
      if (url.includes("archive-api")) {
        archiveUrls.push(url);
        return json({ daily: { time: ["2021-07-03", "2021-07-04"], precipitation_sum: [0, 1.2] } });
      }
      return new Response("", { status: 503 });
    };
    const trigger = await buildFloodTrigger({ lat: NASHVILLE[0], lon: NASHVILLE[1] }, reports, { fetch: fetchFn, now: () => NOW });
    expect(trigger.history).toEqual([
      { date: "2021-03-27", rainIn: 5.75, station: "NASHVILLE INTERNATIONAL AIRPORT, TN US", stationKm: 10.3, gauges: 1 },
      { date: "2021-05-11", rainIn: 2.1, station: "NASHVILLE INTERNATIONAL AIRPORT, TN US", stationKm: 10.3, gauges: 1 },
      { date: "2021-07-04", rainIn: 1.2 },
    ]);
    expect(trigger.triggerIn).toBe(2.1);
    // Only the date no gauge read was asked of Open-Meteo.
    expect(archiveUrls).toHaveLength(1);
    expect(archiveUrls[0]).toContain("start_date=2021-07-03&end_date=2021-07-04");
    expect(rainLabel(trigger)).toBe("NOAA rain gauge measurements (2 of 3 days) and ERA5 rainfall");
  });

  it("gauges: false keeps to the grid", async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url);
      return new Response("", { status: 503 });
    };
    await buildFloodTrigger({ lat: NASHVILLE[0], lon: NASHVILLE[1] }, reports, { fetch: fetchFn, now: () => NOW, gauges: false });
    expect(calls.some((url) => url.includes("ncei.noaa.gov"))).toBe(false);
  });
});

describe("rainLabel", () => {
  it("says gauges when every day was measured, the grid when none was", () => {
    expect(rainLabel({ history: [{ date: "2021-03-27", rainIn: 5.75, station: "X", stationKm: 1 }] })).toBe("NOAA rain gauge measurements");
    expect(rainLabel({ history: [{ date: "2021-03-27", rainIn: 1 }] })).toBe("ERA5 rainfall");
    expect(rainLabel({})).toBe("ERA5 rainfall");
  });
});
