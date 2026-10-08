/**
 * A report the detective could not pin must be described truthfully: Rosa Parks Blvd is a named street with no address or cross
 * street (so no single spot), not "a region".
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportCard } from "@/components/views/storm/ReportCard";
import { resolvePlacement, unplacedSentence, unplacedShort, unplacedWords } from "@/lib/ui/placements";
import type { Correction, StormModel } from "@/lib/ui/storm-model";
import { NASHVILLE, flood } from "./helpers";

const ROSA = flood({
  id: "LSR-OHX-202103280355-0",
  quote: "ROSA PARKS BLVD UNDERWATER NEAR THE FARMERS MARKET WITH CARS STALLED",
  coordPrecision: "placeholder",
  filed: [36.17, -86.78],
  detective: { verdict: "unknown", clues: ["ROSA PARKS BLVD", "FARMERS MARKET"], match: null, matchType: null, confidence: "high", model: "claude-sonnet-5-5", ranAt: "2026-10-08T19:26:18Z" },
});
const NOTHING = flood({ id: "x", quote: "FLOODING REPORTED", coordPrecision: "placeholder", detective: { verdict: "unknown", clues: [], match: null, matchType: null, confidence: "low", model: "m", ranAt: "2026-10-08" } });

const card = (row: typeof ROSA, placement = resolvePlacement(row)!) => {
  const correction = { number: 1, report: { id: row.id, ms: Date.parse(row.start), at: row.filed!, row }, placement, km: null } as Correction;
  const model = { offsetMin: -300, zone: "CDT", cityPointKm: 0.9, corrections: [correction] } as unknown as StormModel;
  return renderToStaticMarkup(<ReportCard model={model} correction={correction} progress={{ index: 0, u: 1, phase: "done" }} origin={NASHVILLE} />);
};

describe("an unplaced report says what its words really name", () => {
  it("Rosa Parks Blvd: a named street with no single spot, never 'a region'", () => {
    const placement = resolvePlacement(ROSA)!;
    expect(placement).toMatchObject({ status: "unknown", dest: null, named: ["Rosa Parks Blvd", "Farmers Market"], vague: [] });
    const html = card(ROSA);
    expect(html).toContain("Its words name <b>Rosa Parks Blvd and Farmers Market</b>, but give no address or cross street, so there is no single spot to pin. So the pin stays.");
    expect(html).not.toContain("a region");
    expect(html).toContain("Not placed: no single spot");
    // The street and the landmark are marked in the report's own words.
    expect(html).toMatch(/<mark class="pw2">Rosa Parks Blvd<\/mark>/i);
  });

  it("a whole region is still said to be a region", () => {
    const region = flood({ id: "r", quote: "MAJOR FLASH FLOODING ONGOING ACROSS THE SOUTHERN HALF OF NASHVILLE", coordPrecision: "placeholder", filed: [36.17, -86.78] });
    const placement = resolvePlacement(region)!;
    expect(unplacedSentence(placement)).toBe("Its words only name “southern half of Nashville”: a region, not a place. So the pin stays.");
    expect(unplacedShort(placement)).toBe("The words name a whole region. Too vague to place.");
  });

  it("no clues at all: nothing is claimed about the words", () => {
    const placement = resolvePlacement(NOTHING)!;
    expect(unplacedWords(placement)).toEqual({ before: "Its words do not name a place we could find. So the pin stays.", strong: "", after: "" });
    expect(card(NOTHING)).not.toContain("a region");
    expect(card(NOTHING)).toContain("Not placed: too vague");
  });

  it("the pin label and the announcement agree with the card", () => {
    const placement = resolvePlacement(ROSA)!;
    expect(unplacedShort(placement)).toBe("The words name Rosa Parks Blvd but give no single spot.");
    expect(unplacedSentence(placement)).toBe("Its words name Rosa Parks Blvd and Farmers Market, but give no address or cross street, so there is no single spot to pin. So the pin stays.");
    expect(placement.why).toContain("give no address or cross street");
  });
});
