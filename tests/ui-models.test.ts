import { describe, expect, it } from "vitest";
import { summarizeGrid, streakAt, weekdayOf } from "@/lib/ui/heat-model";
import { resolvePlacement } from "@/lib/ui/placements";
import {
  buildStormModel,
  correctionSlot,
  currentCorrection,
  moveProgress,
  pickCityPointGroup,
  tallyCorrections,
} from "@/lib/ui/storm-model";
import { buildTimeline, cardTornado, casualtyParts, circlePoints, closestTornado, ratingNumber, strongestTornado, swathPolygon } from "@/lib/ui/tornado-model";
import { selectReplayNight } from "@/lib/lookup";
import type { Detective, FloodRow, HeatGrid, NearbyTornado } from "@/lib/types";
import { NASHVILLE, flood, tornado } from "./helpers";

const CITY_POINT: [number, number] = [36.17, -86.78];
const cityPointFlood = (id: string, start: string, extra: Partial<FloodRow> = {}) =>
  flood({ id, start, filed: CITY_POINT, coordPrecision: "placeholder", ...extra });

describe("resolvePlacement", () => {
  const placed: Detective = { verdict: "placed", clues: ["95 Wallace Road"], match: "95 WALLACE RD, NASHVILLE, TN 37211", matchType: "address", confidence: "high", model: "test", ranAt: "x" };

  it("uses a real detective result when there is one", () => {
    const placement = resolvePlacement(flood({ id: "a", placed: [36.08, -86.7], detective: placed }))!;
    expect(placement).toMatchObject({ status: "verified", dest: [36.08, -86.7], label: "95 Wallace Rd", place: ["95 Wallace Road"] });
  });

  it("says 'unknown' for an unknown verdict, never inventing a place", () => {
    const placement = resolvePlacement(flood({ id: "b", detective: { ...placed, verdict: "unknown", match: null, matchType: null } }))!;
    expect(placement.status).toBe("unknown");
    expect(placement.dest).toBeNull();
  });

  it("tags the prototype's placements as sample when the detective has not run", () => {
    const placement = resolvePlacement(flood({ id: "anything", quote: "ROSA PARKS BLVD UNDERWATER NEAR THE FARMERS MARKET WITH CARS STALLED" }))!;
    expect(placement.status).toBe("sample");
    expect(placement.label).toBe("Rosa Parks Blvd");
  });

  it("matches the sample by the report's words, so a shifted id cannot break it or misplace another report", () => {
    expect(resolvePlacement(flood({ id: "LSR-OHX-202103280355-7", quote: "Rosa Parks Blvd underwater near the Farmers Market" }))?.status).toBe("sample");
    // Same words from another office or county are not the Nashville report.
    expect(resolvePlacement(flood({ id: "x", wfo: "MEG", quote: "ROSA PARKS BLVD UNDERWATER NEAR THE FARMERS MARKET" }))).toBeNull();
    expect(resolvePlacement(flood({ id: "y", county: "Wilson", quote: "ROSA PARKS BLVD UNDERWATER NEAR THE FARMERS MARKET" }))).toBeNull();
  });

  it("gives all five Nashville city-point reports a sample placement, four of them with a spot and one 'I don't know'", () => {
    const quotes = [
      "ROSA PARKS BLVD UNDERWATER NEAR THE FARMERS MARKET WITH CARS STALLED",
      "1ST FLOOR OF HOTEL FLOODED AT 95 WALLACE ROAD NEAR I-24 AT HARDING PLACE",
      "NUMEROUS WATER RESCUES BEING CONDUCTED IN SOUTH NASHVILLE IN OAK HILL AREA AND EDMONDSON PIKE",
      "FLASH FLOODING AT THE SOUTH BROOKE APARTMENTS ON LINBAR DRIVE. POSSIBLE BUILDING COLLAPSE",
      "MAJOR FLASH FLOODING ONGOING ACROSS THE SOUTHERN HALF OF NASHVILLE WITH I-40 AND I-24 BOTH",
    ];
    const placements = quotes.map((quote) => resolvePlacement(flood({ id: quote.slice(0, 6), quote }))!);
    expect(placements.map((p) => p.status)).toEqual(["sample", "sample", "sample", "sample", "unknown"]);
    expect(placements[1]).toMatchObject({ label: "95 Wallace Rd", dest: [36.0825, -86.7021] });
    expect(placements[4].dest).toBeNull();
  });

  it("returns null for any other report without a detective result", () => {
    expect(resolvePlacement(flood({ id: "something-else" }))).toBeNull();
  });
});

describe("pickCityPointGroup and the correction set", () => {
  const origin = NASHVILLE;
  const report = (id: string, at: [number, number]) => ({ id, ms: 0, at, row: flood({ id }) });

  it("takes the biggest group filed at exactly one coordinate", () => {
    const group = pickCityPointGroup([report("a", CITY_POINT), report("b", CITY_POINT), report("c", [36.16, -86.85])], origin);
    expect(group.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("does not make a story out of a lone placeholder", () => {
    expect(pickCityPointGroup([report("a", CITY_POINT)], origin)).toEqual([]);
  });

  it("builds a correction walk-through only when every city-point report has a placement", () => {
    const withSample = [
      cityPointFlood("a1", "2021-03-27T22:55:00-05:00", { quote: "ROSA PARKS BLVD UNDERWATER NEAR THE FARMERS MARKET WITH CARS STALLED" }),
      cityPointFlood("a2", "2021-03-28T00:50:00-05:00", { quote: "MAJOR FLASH FLOODING ONGOING ACROSS THE SOUTHERN HALF OF NASHVILLE WITH I-40 AND I-24 BOTH" }),
    ];
    const replay = selectReplayNight(withSample, NASHVILLE)!;
    const model = buildStormModel(replay, { lat: NASHVILLE[0], lon: NASHVILLE[1] });
    expect(model.canCorrect).toBe(true);
    expect(model.corrections.map((c) => c.number)).toEqual([1, 2]);
    expect(tallyCorrections(model.corrections)).toEqual({ verified: 0, sample: 1, unknown: 1 });

    const unresolved = [cityPointFlood("x1", "2021-03-27T22:55:00-05:00"), cityPointFlood("x2", "2021-03-27T23:55:00-05:00")];
    const model2 = buildStormModel(selectReplayNight(unresolved, NASHVILLE)!, { lat: NASHVILLE[0], lon: NASHVILLE[1] });
    expect(model2.canCorrect).toBe(false);
    expect(model2.corrections).toEqual([]);
  });

  it("names the detective state: sample, ran, not-run, nothing-to-move", () => {
    const here = { lat: NASHVILLE[0], lon: NASHVILLE[1], state: "TN" };
    const sampleRows = [
      cityPointFlood("a1", "2021-03-27T22:55:00-05:00", { quote: "ROSA PARKS BLVD UNDERWATER NEAR THE FARMERS MARKET WITH CARS STALLED" }),
      cityPointFlood("a2", "2021-03-28T00:50:00-05:00", { quote: "MAJOR FLASH FLOODING ONGOING ACROSS THE SOUTHERN HALF OF NASHVILLE WITH I-40 AND I-24 BOTH" }),
    ];
    expect(buildStormModel(selectReplayNight(sampleRows, NASHVILLE)!, here).detective).toBe("sample");

    const result: Detective = { verdict: "placed", clues: ["Rosa Parks Blvd"], match: "ROSA L PARKS BLVD & JEFFERSON ST, NASHVILLE, TN", matchType: "intersection", confidence: "high", model: "claude-sonnet-5-5", ranAt: "x" };
    const real = sampleRows.map((row) => ({ ...row, quote: "no place words here", placed: [36.17, -86.79] as [number, number], detective: result }));
    expect(buildStormModel(selectReplayNight(real, NASHVILLE)!, here).detective).toBe("ran");

    const unresolved = [cityPointFlood("x1", "2021-03-27T22:55:00-05:00"), cityPointFlood("x2", "2021-03-27T23:55:00-05:00")];
    expect(buildStormModel(selectReplayNight(unresolved, NASHVILLE)!, here).detective).toBe("not-run");

    // The detective ran, but nothing was pinned to a shared city point: it must not say "has not run".
    const lone = [flood({ id: "l1", start: "2021-03-27T22:55:00-05:00", filed: [36.2, -86.8], coordPrecision: "rounded", detective: result })];
    expect(buildStormModel(selectReplayNight(lone, NASHVILLE)!, here).detective).toBe("nothing-to-move");
  });

  it("keeps the reports within 5 km as filed, for the not-run view", () => {
    const rows = [flood({ id: "n1", start: "2021-03-27T22:55:00-05:00" })];
    const nearby = [{ ...rows[0], distanceKm: 0.3, tier: "about1km" as const }];
    const model = buildStormModel(selectReplayNight(rows, NASHVILLE)!, { lat: NASHVILLE[0], lon: NASHVILLE[1] }, nearby);
    expect(model.filed).toHaveLength(1);
    expect(model.filed[0]).toMatchObject({ id: "n1", tier: "about1km" });
  });

  it("lists a radar frame per five minutes, in UTC", () => {
    const replay = selectReplayNight([flood({ id: "x", start: "2021-03-27T22:55:00-05:00" })], NASHVILLE)!;
    const model = buildStormModel(replay, { lat: NASHVILLE[0], lon: NASHVILLE[1] });
    expect(model.frameTimes[0]).toBe("2021-03-28T02:25:00Z");
    expect(model.frameTimes[1]).toBe("2021-03-28T02:30:00Z");
    expect(model.frameTimes).toHaveLength(model.frameCount);
    expect(model.offsetMin).toBe(-300);
    expect(model.zone).toBe("CDT");
  });
});

describe("correction timeline", () => {
  it("gives every report an equal slot after the camera move", () => {
    expect(correctionSlot(0, 5).start).toBeCloseTo(0.07, 5);
    expect(correctionSlot(4, 5).start + correctionSlot(4, 5).length).toBeCloseTo(1, 5);
  });

  it("is on no report while the camera moves or after the last one", () => {
    expect(currentCorrection(0.03, 5)).toBeNull();
    expect(currentCorrection(0.999, 5)).toBeNull();
    expect(currentCorrection(0.5, 5)?.index).toBe(2);
  });

  it("moves each pin during the second half of its slot", () => {
    expect(moveProgress(0.3)).toBe(0);
    expect(moveProgress(0.72)).toBeCloseTo(0.5, 5);
    expect(moveProgress(1)).toBe(1);
  });
});

describe("tornado model", () => {
  const nearby = (overrides: Partial<NearbyTornado> & { id: string }): NearbyTornado => ({
    ...tornado(overrides),
    minDistanceKm: 3,
    closest: [36.2, -86.85],
    ...overrides,
  });

  it("words deaths and injuries only from the row, leaving zeros out", () => {
    expect(casualtyParts({ deaths: 2, injuries: 170 })).toEqual(["2 deaths", "170 injured"]);
    expect(casualtyParts({ deaths: 1, injuries: 0 })).toEqual(["1 death"]);
    expect(casualtyParts({ deaths: 0, injuries: 0 })).toEqual([]);
    expect(casualtyParts({ deaths: 3, injuries: 21 })).toEqual(["3 deaths", "21 injured"]);
  });

  it("reads F and EF ratings alike", () => {
    expect(ratingNumber("EF3")).toBe(3);
    expect(ratingNumber("F1")).toBe(1);
    expect(ratingNumber("")).toBe(0);
  });

  it("lays tornadoes out one at a time in date order, big ones slower", () => {
    const list = [
      nearby({ id: "late", start: "2023-01-01T00:00:00-06:00" }),
      nearby({ id: "big", start: "2020-03-03T00:32:00-06:00", ef: "EF3", lengthMi: 21 }),
      nearby({ id: "early", start: "2000-02-13T18:04:00-06:00" }),
    ];
    const timeline = buildTimeline(list);
    expect(timeline.items.map((i) => i.tornado.id)).toEqual(["early", "big", "late"]);
    expect(timeline.items[1].drawMs).toBeGreaterThan(timeline.items[0].drawMs);
    expect(timeline.items[1].startMs).toBeGreaterThanOrEqual(timeline.items[0].startMs + timeline.items[0].drawMs + timeline.items[0].holdMs);
    expect(timeline.totalMs).toBe(timeline.tracksMs + timeline.finaleMs);
  });

  it("keeps the card on the tornado the map is drawing (the EF3 never shows the EF0 before it)", () => {
    const list = [
      nearby({ id: "ef0", start: "2017-08-31T12:00:00-05:00", ef: "EF0", minDistanceKm: 6 }),
      nearby({ id: "ef3", start: "2020-03-03T00:32:00-06:00", ef: "EF3", lengthMi: 21, minDistanceKm: 0.65 }),
      nearby({ id: "ef1", start: "2023-01-01T00:00:00-06:00", ef: "EF1", minDistanceKm: 3 }),
    ];
    const t = buildTimeline(list);
    const [a, b, c] = t.items;
    expect(cardTornado(t, 0)).toBeNull(); // nothing has started yet
    expect(cardTornado(t, a.startMs)?.id).toBe("ef0");
    expect(cardTornado(t, a.startMs + a.drawMs + 10)?.id).toBe("ef0"); // its hold
    // The moment the EF3 starts drawing, and all through its slow draw, the card is the EF3.
    expect(cardTornado(t, b.startMs)?.id).toBe("ef3");
    expect(cardTornado(t, b.startMs + b.drawMs / 2)?.id).toBe("ef3");
    expect(cardTornado(t, b.startMs + b.drawMs + 1000)?.id).toBe("ef3");
    expect(cardTornado(t, c.startMs + 1)?.id).toBe("ef1");
    // Finale: the closest one, which is the one the map zooms to.
    expect(cardTornado(t, t.tracksMs)?.id).toBe("ef3");
    expect(cardTornado(t, t.totalMs)?.id).toBe("ef3");
  });

  it("finds the closest and the strongest", () => {
    const list = [nearby({ id: "a", minDistanceKm: 2, ef: "EF1" }), nearby({ id: "b", minDistanceKm: 0.65, ef: "EF3" }), nearby({ id: "c", minDistanceKm: 5, ef: "EF3", lengthMi: 30 })];
    expect(closestTornado(list)?.id).toBe("b");
    expect(strongestTornado(list)?.id).toBe("c");
    expect(closestTornado([])).toBeNull();
  });

  it("grows the swath from narrow to the NWS width, in real metres", () => {
    const t = { begin: [36.17, -86.9] as [number, number], end: [36.17, -86.8] as [number, number], widthYd: 1600 };
    const full = swathPolygon(t, 1);
    const lons = full.map((p) => p[0]);
    const lats = full.map((p) => p[1]);
    const widthM = (Math.max(...lats) - Math.min(...lats)) * 110570;
    expect(widthM).toBeGreaterThan(1600 * 0.9144 * 0.9);
    expect(widthM).toBeLessThan(1600 * 0.9144 * 1.05);
    expect(Math.max(...lons)).toBeCloseTo(-86.8, 3);
    const early = swathPolygon(t, 0.1);
    expect(Math.max(...early.map((p) => p[1])) - Math.min(...early.map((p) => p[1]))).toBeLessThan(widthM / 110570 / 2);
  });

  it("draws a circle for a zero-length touchdown", () => {
    expect(swathPolygon({ begin: [36.2, -86.8], end: [36.2, -86.8], widthYd: 50 }, 1)).toHaveLength(25);
  });

  it("makes ring points at the right distance", () => {
    const pts = circlePoints([36.17, -86.78], 10, 8);
    expect(pts).toHaveLength(9);
    expect(pts[0][1]).toBeCloseTo(36.17, 5);
    expect(pts[0][0]).toBeGreaterThan(-86.78);
  });
});

describe("heat model", () => {
  const grid: HeatGrid = {
    slug: "t",
    label: "t",
    source: "t",
    days: ["2012-06-26", "2012-06-27"],
    step: 0.5,
    bounds: { lon: [-90, -89.5], lat: [35, 35.5] },
    cells: [
      [35, -90, [90, 99]],
      [35, -89.5, [101, 120]],
      [35.5, -90, [80, 100]],
      [35.5, -89.5, [85, 95]],
    ],
  };

  it("finds the hottest square each day, the peak and the share at 100 F or more", () => {
    const s = summarizeGrid(grid);
    expect(s.hottestByDay.map((c) => c.id)).toEqual([1, 1]);
    expect(s.peak).toMatchObject({ value: 120, dayIndex: 1 });
    expect(s.over100ByDay).toEqual([0.25, 0.5]);
    expect(s.region).toEqual([[-90.25, 34.75], [-89.25, 35.75]]);
  });

  it("counts a streak of 100 F days and names weekdays", () => {
    const series = [90, 101, 105, 110].map((feelsF, i) => ({ date: `2012-06-${26 + i}`, feelsF }));
    expect(streakAt(series, 3)).toBe(3);
    expect(streakAt(series, 0)).toBe(0);
    expect(weekdayOf("2012-06-29")).toBe(5); // a Friday
  });
});
