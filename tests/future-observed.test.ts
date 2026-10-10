import { describe, expect, it } from "vitest";
import { buildObserved, countByYear, decadeRows, trendSentence, windowRows } from "@/lib/climate/observed";
import type { DailyObservation } from "@/lib/climate/types";

/** 365 days a year (no Feb 29), with `hot(year)` days at 95 F feels-like and `wet(year)` days with 1.5 in of rain. */
function series(from: number, to: number, hot: (y: number) => number, wet: (y: number) => number, skip: (y: number) => boolean = () => false): DailyObservation[] {
  const days: DailyObservation[] = [];
  for (let y = from; y <= to; y += 1) {
    if (skip(y)) continue;
    for (let i = 0; i < 365; i += 1) {
      const d = new Date(Date.UTC(2023, 0, 1 + i)); // 2023 is not a leap year
      const date = `${y}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      days.push({ date, feelsF: i < hot(y) ? 95 : 70, airF: i < hot(y) ? 91 : 65, rainIn: i < wet(y) ? 1.5 : 0.1 });
    }
  }
  return days;
}

describe("countByYear and decadeRows", () => {
  it("counts days at or over the threshold, and drops a year with too little data instead of calling it zero", () => {
    const days = series(2000, 2003, (y) => y - 2000, () => 0);
    days.splice(0, 20); // 2000 now has 345 days: below the 350-day bar
    const byYear = countByYear(days, (d) => d.feelsF, 90);
    expect(byYear).toEqual({ "2001": 1, "2002": 2, "2003": 3 });
  });

  it("totals and averages per decade; a short decade is labelled with its own years", () => {
    const byYear: Record<string, number> = {};
    for (let y = 2000; y <= 2025; y += 1) byYear[String(y)] = y - 2000;
    const rows = decadeRows(byYear);
    expect(rows.map((r) => r.label)).toEqual(["2000s", "2010s", "2020 to 2025"]);
    expect(rows[0]).toMatchObject({ total: 45, years: 10, perYear: 4.5 });
    expect(rows[1]).toMatchObject({ total: 145, perYear: 14.5 });
    expect(rows[2]).toMatchObject({ total: 135, years: 6, perYear: 22.5 });
  });
});

describe("windowRows", () => {
  it("cuts the record into the two windows used everywhere (2000-2009 and 2016-2025), and leaves a window out when it has under 9 years", () => {
    const byYear: Record<string, number> = {};
    for (let y = 2000; y <= 2025; y += 1) byYear[String(y)] = y - 2000;
    const rows = windowRows(byYear);
    expect(rows.map((r) => r.label)).toEqual(["2000s", "2016 to 2025"]);
    expect(rows[0]).toMatchObject({ total: 45, years: 10, perYear: 4.5, startYear: 2000, endYear: 2009 });
    expect(rows[1]).toMatchObject({ total: 205, years: 10, perYear: 20.5, startYear: 2016, endYear: 2025 });
    expect(windowRows({ "2020": 1, "2021": 1 })).toEqual([]);
  });
});

describe("buildObserved", () => {
  const days = series(2000, 2025, (y) => y - 2000, () => 3);
  const block = buildObserved(days, "test archive")!;
  const by = (id: string) => block.measures.find((m) => m.id === id)!;

  it("finds a clear rise in hot days, with Sen slope 1 day a year (10 a decade)", () => {
    const hot = by("feels90");
    expect(hot.trend?.verdict).toBe("increasing");
    expect(hot.trend?.slope).toBe(1);
    expect(hot.trend?.perDecade).toBe(10);
    expect(trendSentence(hot)).toMatch(/clear trend up: about 10 more days a year, each decade/);
  });

  it("says 'No clear trend yet' for a flat count, never a direction", () => {
    const rain = by("rain1");
    expect(rain.decades.every((d) => d.perYear === 3)).toBe(true);
    expect(rain.trend?.verdict).toBe("none");
    expect(trendSentence(rain)).toBe("No clear trend yet.");
  });

  it("tests 90 F and 100 F feels-like separately (the 100 F count here is zero every year)", () => {
    expect(by("feels100").byYear["2025"]).toBe(0);
    expect(by("feels100").trend?.verdict).toBe("none");
    expect(by("air90").byYear["2010"]).toBe(10);
  });

  it("returns null when there is no usable data, and says too few years for a short record", () => {
    expect(buildObserved([], "x")).toBeNull();
    const short = buildObserved(series(2020, 2025, () => 5, () => 1), "x")!;
    expect(short.measures[0].trend).toBeNull();
    expect(trendSentence(short.measures[0])).toBe("Too few years to test for a trend.");
  });
});
