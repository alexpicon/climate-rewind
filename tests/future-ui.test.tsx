import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildChartModel, headline, niceAxis } from "@/lib/climate/chart-model";
import { buildObserved } from "@/lib/climate/observed";
import { buildProjection } from "@/lib/climate/projection";
import type { FuturePayload } from "@/lib/climate/types";
import { FutureChart } from "@/components/views/future/FutureChart";
import { FutureContent } from "@/components/views/future/FutureContent";
import { archiveReply, climateReply, MODELS_HOT_BASE, MODELS_HOT_FUTURE } from "./future-fixtures";
import { observationsFromArchive } from "@/lib/climate/projection";

function payload(overrides: Partial<FuturePayload> = {}): FuturePayload {
  return {
    slug: null,
    lat: 47.6,
    lon: -122.2,
    built: "2026-10-08T00:00:00Z",
    observed: buildObserved(observationsFromArchive(archiveReply()), "Open-Meteo historical weather archive (ERA5 reanalysis), daily, 2000 to 2025"),
    projected: buildProjection(climateReply([2001, 2020], MODELS_HOT_BASE), climateReply([2041, 2050], MODELS_HOT_FUTURE)),
    notices: {},
    ...overrides,
  };
}

describe("chart model", () => {
  it("puts the past decades and the projected range on one axis that is tall enough for the top of the band", () => {
    const model = buildChartModel(payload())!;
    expect(model.bars.map((b) => b.label)).toEqual(["2000s", "2016 to 2025"]);
    expect(model.future).toMatchObject({ label: "2041 to 2050", spread: { min: 16, median: 24, max: 40 } });
    expect(model.yMax).toBeGreaterThanOrEqual(40);
    expect(model.ticks[0]).toBe(0);
    expect(model.ticks[model.ticks.length - 1]).toBe(model.yMax);
    expect(model.summary).toContain("Climate models project 24.0 a year in 2041 to 2050, with models ranging from 16.0 to 40.0.");
  });

  it("draws the models' own 2001 to 2020 band beside the record, and says in words when the models run higher or lower than the record at the spot", () => {
    const model = buildChartModel(payload())!;
    expect(model.modelPast).toMatchObject({ label: "2001 to 2020", spread: { min: 6, median: 10, max: 14 } });
    expect(model.observedBaseline).not.toBeNull();
    expect(model.modelNote).toMatch(/^For 2001 to 2020 the models' middle value \(10\.0\) is (higher|lower) than the [\d.]+ the weather record counted at this spot, so we read the change from one model band to the next/);
    const close = buildChartModel(payload({ projected: buildProjection(climateReply([2001, 2020], { A: 3 }), climateReply([2041, 2050], { A: 9 }), ["A"]) }))!;
    expect(close.modelNote === null || /close to|higher|lower/.test(close.modelNote)).toBe(true);
  });

  it("niceAxis picks round tick steps", () => {
    expect(niceAxis(7.3)).toEqual({ yMax: 8, ticks: [0, 2, 4, 6, 8] });
    expect(niceAxis(41)).toEqual({ yMax: 60, ticks: [0, 20, 40, 60] });
    expect(niceAxis(0).ticks[0]).toBe(0);
  });

  it("with only one half it draws only that half; with neither it draws nothing", () => {
    expect(buildChartModel(payload({ projected: null }))!.future).toBeNull();
    expect(buildChartModel(payload({ observed: null }))!.bars).toEqual([]);
    expect(buildChartModel(payload({ observed: null, projected: null }))).toBeNull();
  });

  it("the headline states past then projected, with the range and never a prediction word", () => {
    const text = headline(payload());
    expect(text).toMatch(/^The weather record counted about [\d.]+ days a year at or above 90°F in 2016–2025 \(the last 10 years\), (up|down) from [\d.]+ in the 2000s\. Climate models: 10\.0 a year \(2001–2020, models\) → 24\.0 a year \(2041–2050\), about \+14\.0 days a year \(models range from \+\d+\.\d to \+\d+\.\d\)\.$/);
    expect(text).not.toMatch(/will|predict|forecast/i);
  });
});

describe("FutureChart and FutureContent", () => {
  const p = payload();
  const html = renderToStaticMarkup(<FutureContent payload={p} explanation={<p>EXPLANATION SLOT</p>} />);

  it("draws an SVG with a title and a description, and writes the same numbers as a table", () => {
    const svg = renderToStaticMarkup(<FutureChart model={buildChartModel(p)!} />);
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<title");
    expect(svg).toContain("Days a year at or above 90°F (air temperature)");
    expect(svg).toContain("16.0 to 40.0");
    expect(html).toContain("Text version of the chart");
    expect(html).toContain("<caption");
    expect(html).toContain("Climate models, projected");
  });

  it("shows a trend only where the test found one, and 'No clear trend yet.' where it did not", () => {
    expect(html).toContain("Days with a feels-like high of 90°F or more");
    expect(html).toContain("A clear trend up: about");
    expect(html).toContain("No clear trend yet.");
  });

  it("says the uncertainty out loud, with the range and the exact caveat line", () => {
    expect(html).toMatch(/Climate models \(CMIP6\) are physics simulations, not a forecast; they run (hotter|cooler) than the record here, so we show their change\./);
    expect(html).not.toMatch(/adjusts|adjusted to match/);
    expect(html).toContain("+14.0");
    expect(html).toContain("16.0 to 40.0");
    expect(html).toContain("Each model");
    expect(html).toContain("EXPLANATION SLOT");
  });

  it("when the models could not be read it says so, shows the record, and still carries the caveat", () => {
    const partial = renderToStaticMarkup(<FutureContent payload={payload({ projected: null, notices: { projected: "The Open-Meteo climate model service returned an error (HTTP 429)." } })} explanation={null} />);
    expect(partial).toContain("returned an error (HTTP 429)");
    expect(partial).toContain("What the record shows");
    expect(partial).toContain("Climate models (CMIP6) are physics simulations, not a forecast");
  });

  it("when the record could not be read it says so and still shows the models", () => {
    const partial = renderToStaticMarkup(<FutureContent payload={payload({ observed: null, notices: { observed: "We could not reach the Open-Meteo weather archive." } })} explanation={null} />);
    expect(partial).toContain("We could not reach the Open-Meteo weather archive.");
    expect(partial).toContain("What climate models project");
  });
});
