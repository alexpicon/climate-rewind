import { describe, expect, it } from "vitest";
import { averageDaysPerYear, buildProjection, climateUrl, archiveUrl, CAVEAT, spreadOf, type ClimateReply } from "@/lib/climate/projection";

/** A reply whose models each have `hot(model)` days a year at 95 F (the rest 70 F), 365-day years unless `days` says otherwise. */
function reply(period: [number, number], models: Record<string, { hot: number; days?: number; nulls?: boolean } | null>): ClimateReply {
  const time: string[] = [];
  const daily: Record<string, unknown> = {};
  const keys = Object.keys(models);
  const lengths: Record<string, number[]> = {};
  for (let y = period[0]; y <= period[1]; y += 1) {
    for (let i = 0; i < 365; i += 1) time.push(`${y}-${String(1 + Math.floor(i / 31)).padStart(2, "0")}-${String(1 + (i % 31)).padStart(2, "0")}#${i}`);
  }
  // Dates here only need a leading year; the helper reads slice(0, 4).
  for (const key of keys) {
    const spec = models[key];
    if (!spec) continue;
    const perYear = spec.days ?? 365;
    const values: Array<number | null> = [];
    for (let y = period[0]; y <= period[1]; y += 1) {
      for (let i = 0; i < 365; i += 1) {
        if (i >= perYear) values.push(null);
        else values.push(spec.nulls ? null : i < spec.hot ? 95 : 70);
      }
    }
    daily[`temperature_2m_max_${key}`] = values;
    lengths[key] = [values.length];
  }
  return { daily: { time, ...daily } };
}

describe("averageDaysPerYear", () => {
  it("counts days at or above 90 F per year and averages the years", () => {
    const r = reply([2001, 2020], { A: { hot: 10 } });
    expect(averageDaysPerYear(r.daily!.time!, r.daily!.temperature_2m_max_A as unknown[], [2001, 2020])).toBeCloseTo(10, 9);
  });

  it("scales a 360-day model year to 365 days so models are comparable", () => {
    const r = reply([2001, 2020], { A: { hot: 12, days: 360 } });
    const avg = averageDaysPerYear(r.daily!.time!, r.daily!.temperature_2m_max_A as unknown[], [2001, 2020])!;
    expect(avg).toBeCloseTo((12 / 360) * 365, 9);
  });

  it("is null when the model has no values, or too few years", () => {
    const empty = reply([2001, 2020], { A: { hot: 5, nulls: true } });
    expect(averageDaysPerYear(empty.daily!.time!, empty.daily!.temperature_2m_max_A as unknown[], [2001, 2020])).toBeNull();
    const half = reply([2001, 2010], { A: { hot: 5 } }); // only 10 of the 20 years exist
    expect(averageDaysPerYear(half.daily!.time!, half.daily!.temperature_2m_max_A as unknown[], [2001, 2020])).toBeNull();
  });

  it("counts a day exactly at the threshold", () => {
    const time = Array.from({ length: 365 }, (_, i) => `2001-01-${i}`);
    const values = time.map((_, i) => (i < 4 ? 90 : 89.9));
    expect(averageDaysPerYear(time, values, [2001, 2001])).toBeCloseTo(4, 9);
  });
});

describe("buildProjection", () => {
  const base = reply([2001, 2020], { A: { hot: 8 }, B: { hot: 12 }, C: { hot: 10 }, D: null, E: { hot: 6, nulls: true } });
  const future = reply([2041, 2050], { A: { hot: 20 }, B: { hot: 40 }, C: { hot: 30 }, D: null, E: { hot: 50 } });
  const block = buildProjection(base, future, ["A", "B", "C", "D", "E"])!;

  it("gives each model's two averages and the range across models that had data in both periods", () => {
    expect(block.models.find((m) => m.model === "A")).toEqual({ model: "A", baseline: 8, future: 20 });
    expect(block.baseline).toEqual({ min: 8, median: 10, max: 12 });
    expect(block.future).toEqual({ min: 20, median: 30, max: 40 });
  });

  it("lists a model with a missing series or no values as null, and does not count it", () => {
    expect(block.models.find((m) => m.model === "D")).toEqual({ model: "D", baseline: null, future: null });
    expect(block.models.find((m) => m.model === "E")).toEqual({ model: "E", baseline: null, future: null });
  });

  it("is null when no model has data in both periods", () => {
    expect(buildProjection(reply([2001, 2020], { A: null }), reply([2041, 2050], { A: null }), ["A"])).toBeNull();
    expect(buildProjection({}, {}, ["A"])).toBeNull();
  });

  it("a single-model reply may use the plain variable name", () => {
    const time = Array.from({ length: 365 * 20 }, (_, i) => `${2001 + Math.floor(i / 365)}-01-${i % 365}`);
    const one: ClimateReply = { daily: { time, temperature_2m_max: time.map((_, i) => (i % 365 < 7 ? 91 : 60)) } };
    const fut: ClimateReply = { daily: { time: time.slice(0, 365 * 10).map((t) => t.replace(/^\d{4}/, (y) => String(Number(y) + 40))), temperature_2m_max: time.slice(0, 365 * 10).map((_, i) => (i % 365 < 14 ? 91 : 60)) } };
    const b = buildProjection(one, fut, ["A"])!;
    expect(b.baseline).toEqual({ min: 7, median: 7, max: 7 });
    expect(b.future).toEqual({ min: 14, median: 14, max: 14 });
  });
});

describe("spreadOf, URLs and the caveat", () => {
  it("even counts take the mean of the middle two", () => {
    expect(spreadOf([4, 1, 3, 2])).toEqual({ min: 1, median: 2.5, max: 4 });
    expect(spreadOf([])).toBeNull();
  });

  it("builds the two requests the way Open-Meteo documents them", () => {
    const url = climateUrl(47.61, -122.19, 2041, 2050, ["A", "B"]);
    expect(url).toContain("https://climate-api.open-meteo.com/v1/climate?");
    expect(url).toContain("start_date=2041-01-01&end_date=2050-12-31");
    expect(url).toContain("models=A,B");
    expect(url).toContain("daily=temperature_2m_max&temperature_unit=fahrenheit");
    expect(archiveUrl(47.61, -122.19, 2000, 2025)).toContain("daily=apparent_temperature_max,temperature_2m_max,precipitation_sum");
  });

  it("the caveat says what the brief asked for", () => {
    expect(CAVEAT).toBe("Climate-model projections (CMIP6), not a forecast; ~25 km grid; models disagree, so we show the range.");
  });
});
