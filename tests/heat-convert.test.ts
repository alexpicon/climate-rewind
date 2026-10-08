import { describe, expect, it } from "vitest";
import { convertHeatGrid, HeatConvertError, weekLabel } from "@/lib/heat-convert";

/** A tiny pipeline file (heat_grid.py output shape): 2 x 3 squares over 3 days. */
function pipelineFile(overrides: Record<string, unknown> = {}) {
  return {
    slug: "testville",
    address: { lat: 36.1, lon: -86.7 },
    built: "2026-10-08T02:57:01Z",
    source: "Open-Meteo historical weather API (archive-api.open-meteo.com, reanalysis)",
    variable: "apparent_temperature_max",
    unit: "F",
    timezone: "America/Chicago",
    thresholdF: 100,
    point: { hottest: { date: "2012-06-29", feelsF: 113.1 } },
    days: ["2012-06-27", "2012-06-28", "2012-06-29"],
    step: 0.5,
    bounds: { lat: [36, 36.5], lon: [-87, -86], rows: 2, cols: 3 },
    cells: [
      [36.5, -86, [90.04, 99.96, 101]],
      [36, -87, [88, 95, 97.25]],
      [36, -86.5, [91, 100, 110.04]],
      [36, -86, [92, 96, 98]],
      [36.5, -87, [89, 93, 99]],
      [36.5, -86.5, [90, 94, 104.5]],
    ],
    dropped: 0,
    gridPeak: { feelsF: 110.0, lat: 36, lon: -86.5, date: "2012-06-29" },
    note: "History, not a forecast.",
    ...overrides,
  };
}

describe("convertHeatGrid", () => {
  it("produces the app's HeatGrid: slug, label, source, days, step, bounds and cells", () => {
    const grid = convertHeatGrid(pipelineFile(), { place: "Testville" });
    expect(Object.keys(grid).sort()).toEqual(["bounds", "cells", "days", "label", "slug", "source", "step"]);
    expect(grid.slug).toBe("testville");
    expect(grid.days).toEqual(["2012-06-27", "2012-06-28", "2012-06-29"]);
    expect(grid.step).toBe(0.5);
    expect(grid.label).toBe("Heat wave, June 27 to 29, 2012, around Testville");
    expect(grid.source).toMatch(/Open-Meteo/);
    expect(grid.source).toMatch(/0\.5 degree lattice/);
  });

  it("keeps only the two ranges in bounds (no rows or cols)", () => {
    const grid = convertHeatGrid(pipelineFile(), { place: "Testville" });
    expect(grid.bounds).toEqual({ lon: [-87, -86], lat: [36, 36.5] });
  });

  it("orders the squares south to north, west to east, and rounds values to 0.1", () => {
    const grid = convertHeatGrid(pipelineFile(), { place: "Testville" });
    expect(grid.cells.map(([lat, lon]) => [lat, lon])).toEqual([
      [36, -87],
      [36, -86.5],
      [36, -86],
      [36.5, -87],
      [36.5, -86.5],
      [36.5, -86],
    ]);
    expect(grid.cells[5][2]).toEqual([90, 100, 101]); // 90.04 -> 90, 99.96 -> 100
    expect(grid.cells[1][2]).toEqual([91, 100, 110]);
  });

  it("loads straight into the app's summary: peak, hottest square per day, share at 100 F", async () => {
    const { summarizeGrid } = await import("@/lib/ui/heat-model");
    const summary = summarizeGrid(convertHeatGrid(pipelineFile(), { place: "Testville" }));
    expect(summary.peak).toMatchObject({ value: 110, dayIndex: 2 });
    expect(summary.over100ByDay).toEqual([0, 2 / 6, 3 / 6]);
    expect(summary.region).toEqual([[-87.25, 35.75], [-85.75, 36.75]]);
  });

  it("words a week across a month or a year", () => {
    expect(weekLabel("2012-06-26", "2012-07-02")).toBe("June 26 to July 2, 2012");
    expect(weekLabel("2012-06-27", "2012-07-03")).toBe("June 27 to July 3, 2012");
    expect(weekLabel("2023-06-18", "2023-06-24")).toBe("June 18 to 24, 2023");
    expect(weekLabel("2012-12-29", "2013-01-04")).toBe("December 29, 2012 to January 4, 2013");
  });

  describe("refuses anything malformed, so a bad file never reaches data/heat", () => {
    const bad = (overrides: Record<string, unknown>, message: RegExp) =>
      expect(() => convertHeatGrid(pipelineFile(overrides), { place: "Testville" })).toThrow(message);

    it("not an object, or no place name", () => {
      expect(() => convertHeatGrid(null, { place: "X" })).toThrow(HeatConvertError);
      expect(() => convertHeatGrid("nope", { place: "X" })).toThrow(/not a JSON object/);
      expect(() => convertHeatGrid(pipelineFile(), { place: "  " })).toThrow(/place name/);
    });

    it("bad slug or unit", () => {
      bad({ slug: "../escape" }, /slug/);
      bad({ slug: undefined }, /slug/);
      bad({ unit: "C" }, /in F/);
    });

    it("bad days or step", () => {
      bad({ days: ["2012-06-27"] }, /days/);
      bad({ days: ["2012-06-28", "2012-06-27", "2012-06-29"] }, /increasing/);
      bad({ days: ["June 27", "June 28", "June 29"] }, /YYYY-MM-DD/);
      bad({ step: 0 }, /step/);
    });

    it("bad or missing bounds", () => {
      bad({ bounds: undefined }, /bounds/);
      bad({ bounds: { lat: [36.5, 36], lon: [-87, -86] } }, /bounds/);
    });

    it("no cells, a ragged cell, a null value, a cell outside the bounds, a duplicate", () => {
      bad({ cells: [] }, /no cells/);
      bad({ cells: [[36, -87, [1, 2]]] }, /one number for each of the 3 days/);
      bad({ cells: [[36, -87, [1, null, 3]]] }, /one number for each of the 3 days/);
      bad({ cells: [[36, -87, [1, "hot", 3]]] }, /one number for each of the 3 days/);
      bad({ cells: [[40, -87, [1, 2, 3]]] }, /outside the bounds/);
      bad({ cells: [[36, -87, [1, 2, 3]], [36, -87, [1, 2, 3]]] }, /twice/);
      bad({ cells: [[36, "x", [1, 2, 3]]] }, /non-numeric/);
      bad({ cells: [[36, -87]] }, /\[lat, lon, values\]/);
    });

    it("cells that do not reach the declared bounds", () => {
      bad({ cells: [[36, -87, [1, 2, 3]], [36.5, -86.5, [1, 2, 3]]] }, /do not reach/);
    });

    it("a stated peak that the cells do not have", () => {
      bad({ gridPeak: { feelsF: 120.5 } }, /hottest square is 120.5 F but the cells peak at 110 F/);
    });
  });
});
