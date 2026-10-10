/** The "then, now, 2040s" strip's numbers (lib/climate-strip), read from the shipped bellevue and fort-myers files. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildStrip } from "@/lib/climate-strip/strip-model";
import type { FuturePayload } from "@/lib/climate/types";

const file = (slug: string) => JSON.parse(readFileSync(`data/projections/${slug}.json`, "utf8")) as FuturePayload;

describe("climate strip model", () => {
  it("shows the 2000s, 2016-2025 and the 2040s range of the same measure the What's changing chart uses (air 90 F)", () => {
    const strip = buildStrip(file("bellevue"))!;
    const air = file("bellevue").observed!.measures.find((m) => m.id === "air90")!;
    const avg = (from: number, to: number) => {
      const v = Object.entries(air.byYear).filter(([y]) => +y >= from && +y <= to).map(([, c]) => c);
      return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
    };
    expect(strip.hot!.then).toBe(avg(2000, 2009));
    expect(strip.hot!.now).toBe(avg(2016, 2025));
    expect(strip.hot!.projected).toEqual(file("bellevue").projected!.future);
    expect(strip.projectedPeriod).toBe("2041–2050");
    expect(strip.rain!.projected).toBeNull();
  });

  it("says trend only where the Mann-Kendall p is under 0.05", () => {
    expect(buildStrip(file("bellevue"))!.hot!.hasTrend).toBe(false);
    expect(buildStrip(file("bellevue"))!.hot!.trend).toBe("no clear trend yet");
    const fm = buildStrip(file("fort-myers"))!.hot!;
    expect(fm.hasTrend).toBe(true);
    expect(fm.trend).toMatch(/^clear trend up/);
    // Every prepared address agrees with its own test result.
    for (const slug of ["asheville", "flushing", "lahaina", "mayfield", "nashville", "portland", "rolling-fork", "san-antonio"]) {
      const p = file(slug);
      const t = p.observed!.measures.find((m) => m.id === "air90")!.trend!;
      expect(buildStrip(p)!.hot!.hasTrend).toBe(t.p < 0.05 && t.verdict !== "none");
    }
  });

  it("still shows the record when the models could not be read, and nothing when neither could", () => {
    const noModels = buildStrip({ ...file("bellevue"), projected: null })!;
    expect(noModels.hot!.projected).toBeNull();
    expect(noModels.hot!.now).not.toBeNull();
    expect(buildStrip({ ...file("bellevue"), projected: null, observed: null })).toBeNull();
  });
});
