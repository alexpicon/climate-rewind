/** The "Start here" cards' moving maps: the model (lib/ui/sample-preview.ts) and the shipped public/data/sample-previews.json against the hooks. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { heatFrame, nightFrame, PREVIEW_OF_ADDRESS, restingP, tornadoFrame, type HeatPreview, type NightPreview, type SamplePreviewsFile, type TornadoPreview } from "@/lib/ui/sample-preview";
import { SAMPLE_ADDRESSES } from "@/lib/ui/tabs";

const T0 = Date.parse("2021-05-01T18:00:00Z");
const tornado: TornadoPreview = {
  kind: "tornadoes",
  box: [36, 36.5, -87, -86.5],
  home: [36.2, -86.8],
  from: 2015,
  to: 2017,
  focusKm: 0.65,
  tracks: [
    [2015, 1, 36.1, -86.9, 36.2, -86.7, 0],
    [2016, 3, 36.15, -86.95, 36.25, -86.6, 1],
    [2017, 0, 36.3, -86.9, 36.3, -86.8, 0],
  ],
};
const night: NightPreview = {
  kind: "night",
  box: [29, 30, -99, -98],
  home: [29.4, -98.5],
  startMs: T0,
  endMs: T0 + 3_600_000,
  offsetMin: -300,
  flashes: [[60, 29.5, -98.5], [1800, 29.4, -98.4], [3500, 29.3, -98.6]],
  reports: [[900, 29.42, -98.49], [2700, 29.43, -98.5]],
};
const heat: HeatPreview = { kind: "heat", box: [42, 50, -125, -114], home: [47.6, -122.2], days: ["2021-06-26", "2021-06-27", "2021-06-28"], step: 0.5, cells: [[47.5, -122, [80, 100, 110]]], address: [90, 115, 100] };

describe("tornadoFrame", () => {
  it("sweeps the years first and draws the card's own tornado last", () => {
    const start = tornadoFrame(tornado, 0);
    expect(start.year).toBe(2015);
    expect(start.drawn).toEqual([0, 0, 0]);
    const swept = tornadoFrame(tornado, 0.65);
    expect(swept.drawn[0]).toBe(1);
    expect(swept.drawn[2]).toBe(1);
    expect(swept.drawn[1]).toBe(0);
    const drawing = tornadoFrame(tornado, 0.775);
    expect(drawing.drawn[1]).toBeCloseTo(0.5);
    expect(drawing.focusDrawing).toBe(true);
    expect(tornadoFrame(tornado, 1).drawn).toEqual([1, 1, 1]);
  });
});

describe("nightFrame", () => {
  it("counts flashes and reports by their second, with the local clock", () => {
    expect(nightFrame(night, 0)).toEqual(expect.objectContaining({ flashesSeen: 0, reportsSeen: 0, clock: "1:00 PM" }));
    expect(nightFrame(night, 0.5)).toEqual(expect.objectContaining({ flashesSeen: 2, reportsSeen: 1, clock: "1:30 PM" }));
    expect(nightFrame(night, 1)).toEqual(expect.objectContaining({ flashesSeen: 3, reportsSeen: 2 }));
  });
});

describe("heatFrame and restingP", () => {
  it("blends the address between days and rests on the hottest day", () => {
    expect(heatFrame(heat, 0.25).addressF).toBeCloseTo(102.5);
    expect(heatFrame(heat, 0.5).label).toBe("Jun 27");
    expect(restingP(heat)).toBeCloseTo(0.5);
    expect(restingP(night)).toBe(1);
  });
});

describe("the shipped previews", () => {
  const file = JSON.parse(readFileSync("public/data/sample-previews.json", "utf8")) as SamplePreviewsFile;

  it("has one for every Start here card", () => {
    for (const sample of SAMPLE_ADDRESSES) expect(file.previews[PREVIEW_OF_ADDRESS[sample.address]], sample.label).toBeDefined();
  });

  it("Nashville's own tornado is the EF3 0.65 km away the card names", () => {
    const p = file.previews.nashville as TornadoPreview;
    const own = p.tracks.filter((t) => t[6]);
    expect(own).toHaveLength(1);
    expect(own[0][1]).toBe(3);
    expect(p.focusKm).toBe(0.65);
    expect(SAMPLE_ADDRESSES.find((s) => s.label === "Nashville, TN")?.hook).toContain("EF3 tornado passed 0.65 km away");
  });

  it("the storm previews have flashes and flood reports in time order, inside their box", () => {
    for (const slug of ["san-antonio", "asheville"]) {
      const p = file.previews[slug] as NightPreview;
      expect(p.flashes.length).toBeGreaterThan(500);
      expect(p.reports.length).toBeGreaterThan(10);
      for (const rows of [p.flashes, p.reports]) {
        rows.forEach(([s, lat, lon], i) => {
          if (i) expect(s).toBeGreaterThanOrEqual(rows[i - 1][0]);
          expect(lat).toBeGreaterThanOrEqual(p.box[0]);
          expect(lat).toBeLessThanOrEqual(p.box[1]);
          expect(lon).toBeGreaterThanOrEqual(p.box[2]);
          expect(lon).toBeLessThanOrEqual(p.box[3]);
        });
      }
    }
  });

  it("Bellevue's heat peaks at the card's 115°F feels-like", () => {
    const p = file.previews.bellevue as HeatPreview;
    expect(Math.round(Math.max(...p.address))).toBe(115);
    for (const [, , values] of p.cells) expect(values).toHaveLength(p.days.length);
  });
});
