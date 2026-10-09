/** The moment cards' timelines: the model (lib/ui/moment-timeline.ts) and the shipped public/data/moments.json against its sources. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANDING_MOMENTS } from "@/lib/ui/landing-moments";
import { timelineEnds, timelineFrame, timelineHighlight, timelineSummary, type AreaYears, type MomentsFile, type StormNightTimeline, type TornadoNight } from "@/lib/ui/moment-timeline";

const T0 = Date.parse("2021-12-11T02:00:00Z");
const night: TornadoNight = {
  kind: "tornadoes",
  state: "KY",
  startMs: T0,
  endMs: T0 + 4 * 3_600_000,
  offsetMin: -360,
  marks: [
    { t: T0 + 3_600_000, ef: 2, deaths: 1, injuries: 0, lengthMi: 5, focus: false },
    { t: T0 + 2 * 3_600_000, ef: 4, deaths: 24, injuries: 210, lengthMi: 21, focus: true },
  ],
};
const storm: StormNightTimeline = { kind: "night", startMs: T0, endMs: T0 + 3_600_000, offsetMin: -240, binMinutes: 10, lightning: [5, 0, 10, 0, 0, 1], reports: [T0 + 15 * 60_000, T0 + 50 * 60_000] };
const years: AreaYears = { kind: "years", from: 2000, noun: ["event", "events"], counts: [3, 0, 5, 2], deaths: [0, 0, 7, 1], highlightYear: 2002, highlightDeaths: 7 };

describe("timelineFrame", () => {
  it("a tornado night counts the tornadoes and deaths passed, with the local clock", () => {
    expect(timelineFrame(night, 0)).toEqual(expect.objectContaining({ reached: 0, when: "8:00 PM", totals: "0 tornado records so far · 0 deaths" }));
    expect(timelineFrame(night, 0.5)).toEqual(expect.objectContaining({ reached: 2, when: "10:00 PM", totals: "2 tornado records so far · 25 deaths" }));
  });

  it("a storm night counts flashes by whole bins and reports by their minute", () => {
    expect(timelineFrame(storm, 0).totals).toBe("5 lightning flashes · 0 flood reports");
    expect(timelineFrame(storm, 0.5).totals).toBe("15 lightning flashes · 1 flood report");
    expect(timelineFrame(storm, 1).totals).toBe("16 lightning flashes · 2 flood reports");
  });

  it("the years count the year the playhead is in", () => {
    expect(timelineFrame(years, 0)).toEqual(expect.objectContaining({ when: "2000", reached: 1, totals: "3 events so far · 0 deaths" }));
    expect(timelineFrame(years, 0.6)).toEqual(expect.objectContaining({ when: "2002", totals: "8 events so far · 7 deaths" }));
    expect(timelineFrame(years, 1)).toEqual(expect.objectContaining({ when: "2003", reached: 4, totals: "10 events so far · 8 deaths" }));
  });
});

describe("the strip's words", () => {
  it("ends, the highlight and a sentence for screen readers", () => {
    expect(timelineEnds(night)).toEqual(["8:00 PM", "12:00 AM"]);
    expect(timelineEnds(years)).toEqual(["2000", "2003"]);
    expect(timelineHighlight(night)).toEqual({ x: 0.5, label: "EF4 · 10:00 PM" });
    expect(timelineHighlight(years)).toEqual({ x: 2.5 / 4, label: "2002 · 7 deaths" });
    expect(timelineHighlight(storm)).toBeNull();
    expect(timelineSummary(storm)).toBe("16 lightning flashes and 2 flood reports over the night.");
  });
});

describe("the shipped timelines", () => {
  const file = JSON.parse(readFileSync("public/data/moments.json", "utf8")) as MomentsFile;

  it("cover every moment card", () => {
    expect(Object.keys(file.moments).sort()).toEqual(LANDING_MOMENTS.map((m) => m.id).sort());
  });

  it("agree with the cards' own facts", () => {
    const mayfield = file.moments.mayfield as TornadoNight;
    const focus = mayfield.marks.find((m) => m.focus)!;
    expect([focus.ef, focus.deaths, focus.injuries]).toEqual([4, 24, 210]);
    const ida = file.moments.ida as StormNightTimeline;
    expect(ida.lightning.reduce((a, b) => a + b, 0)).toBe(2795);
    expect(ida.reports).toHaveLength(80);
    const lahaina = file.moments.lahaina as AreaYears;
    expect([lahaina.highlightYear, lahaina.highlightDeaths]).toEqual([2023, 102]);
    expect(lahaina.deaths[2023 - lahaina.from]).toBeGreaterThanOrEqual(102);
    const ian = file.moments.ian as AreaYears;
    expect([ian.highlightYear, ian.highlightDeaths]).toEqual([2022, 60]);
    // Each counts only its card's hazard: Lahaina's wildfires since 2000 are nine, all the deaths in 2023.
    expect(lahaina.noun).toEqual(["wildfire", "wildfires"]);
    expect(lahaina.counts.reduce((a, b) => a + b, 0)).toBe(9);
    expect(lahaina.deaths.reduce((a, b) => a + b, 0)).toBe(102);
  });
});

describe("an older timelines file", () => {
  it("without a noun still reads, as events", () => {
    const old = { kind: "years", from: 2000, counts: [1, 2], deaths: [0, 3], highlightYear: 2001, highlightDeaths: 3 } as AreaYears;
    expect(timelineFrame(old, 1).totals).toBe("3 events so far · 3 deaths");
  });
});
