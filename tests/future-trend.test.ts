import { describe, expect, it } from "vitest";
import { mannKendall, twoSidedP, yearlyTrend, TREND_P } from "@/lib/climate/trend";

describe("twoSidedP", () => {
  it("matches the normal curve at the usual cut points", () => {
    expect(twoSidedP(1.96)).toBeCloseTo(0.05, 3);
    expect(twoSidedP(1.6449)).toBeCloseTo(0.1, 3);
    expect(twoSidedP(0)).toBeCloseTo(1, 6);
    expect(twoSidedP(-2.5758)).toBeCloseTo(0.01, 3);
  });
});

describe("mannKendall", () => {
  it("a perfect rise of 10 values: S 45, z 3.94, p about 0.00008, Sen slope 1", () => {
    const r = mannKendall([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])!;
    expect(r.s).toBe(45);
    expect(r.z).toBeCloseTo(44 / Math.sqrt(125), 6);
    expect(r.p).toBeCloseTo(8.3e-5, 5);
    expect(r.slope).toBe(1);
  });

  it("a perfect fall of 5 values: S -10, z -2.20, p about 0.0275, slope -1", () => {
    const r = mannKendall([5, 4, 3, 2, 1])!;
    expect(r.s).toBe(-10);
    expect(r.z).toBeCloseTo(-9 / Math.sqrt(100 / 6), 6);
    expect(r.p).toBeCloseTo(0.0275, 3);
    expect(r.slope).toBe(-1);
  });

  it("applies the tie correction: [1,1,1,2,2,2] has S 9 and variance 21, so p is about 0.081", () => {
    const r = mannKendall([1, 1, 1, 2, 2, 2])!;
    expect(r.s).toBe(9);
    expect(r.z).toBeCloseTo(8 / Math.sqrt(21), 6);
    expect(r.p).toBeCloseTo(0.0809, 3);
  });

  it("a constant series has nothing to test: p 1, slope 0", () => {
    const r = mannKendall([3, 3, 3, 3, 3, 3])!;
    expect(r).toMatchObject({ s: 0, z: 0, p: 1, slope: 0 });
  });

  it("Sen's slope is the median of the pairwise slopes, not a fit through outliers", () => {
    // pairwise slopes: -1 -1 0.5 0.5 0.75 1 1 1 2 3, median (0.75 + 1) / 2
    expect(mannKendall([1, 3, 2, 5, 4])!.slope).toBeCloseTo(0.875, 9);
    // one wild year does not move the slope of an otherwise flat series
    expect(mannKendall([2, 2, 2, 2, 2, 2, 2, 40, 2, 2])!.slope).toBe(0);
  });

  it("needs at least 3 values", () => {
    expect(mannKendall([1, 2])).toBeNull();
    expect(mannKendall([])).toBeNull();
  });
});

describe("yearlyTrend", () => {
  it("reports a direction only when p is under 0.05", () => {
    const rising = yearlyTrend([2, 3, 3, 5, 6, 6, 8, 9, 9, 12, 12, 14])!;
    expect(rising.p).toBeLessThan(TREND_P);
    expect(rising.verdict).toBe("increasing");
    expect(rising.perDecade).toBeCloseTo(rising.slope * 10, 9);

    const falling = yearlyTrend([14, 12, 12, 9, 9, 8, 6, 6, 5, 3, 3, 2])!;
    expect(falling.verdict).toBe("decreasing");
  });

  it("says none for a noisy series with no drift, even when the direction of the last pairs looks like something", () => {
    const flat = yearlyTrend([4, 7, 3, 8, 2, 7, 4, 6, 3, 8, 4, 6, 5, 3])!;
    expect(flat.p).toBeGreaterThan(TREND_P);
    expect(flat.verdict).toBe("none");
  });

  it("mostly-zero counts (a rare hazard) with two bad years are not a trend", () => {
    const rare = [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0];
    const r = yearlyTrend(rare)!;
    expect(r.verdict).toBe("none");
  });

  it("needs ten years to test at all", () => {
    expect(yearlyTrend([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeNull();
  });

  it("a rise with a few swaps is still a trend; a heavily shuffled one is not", () => {
    const nearCut = yearlyTrend([1, 3, 2, 5, 4, 7, 6, 9, 8, 10])!;
    expect(nearCut.p).toBeLessThan(TREND_P);
    const shuffled = yearlyTrend([5, 1, 6, 2, 7, 3, 8, 4, 9, 5, 6, 2])!;
    expect(shuffled.p).toBeGreaterThan(TREND_P);
    expect(shuffled.verdict).toBe("none");
  });
});
