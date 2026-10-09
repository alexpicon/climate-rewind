import { describe, expect, it } from "vitest";
import { hazardOfType, withEpisodes } from "@/lib/ready/events";
import { GUIDANCE, guidanceById } from "@/lib/ready/guidance";
import { buildLocalFacts } from "@/lib/ready/local";
import { guidanceFor } from "@/lib/ready/plan";
import { EVENTS, HEAT, inputs } from "./ready-fixtures";

describe("the guidance corpus", () => {
  it("has 15 to 30 official lines, each with an id, an official URL and text", () => {
    expect(GUIDANCE.length).toBeGreaterThanOrEqual(15);
    expect(GUIDANCE.length).toBeLessThanOrEqual(30);
    expect(new Set(GUIDANCE.map((g) => g.id)).size).toBe(GUIDANCE.length);
    for (const line of GUIDANCE) {
      expect(line.url).toMatch(/^https:\/\/(www\.ready\.gov|www\.weather\.gov|www\.airnow\.gov)\//);
      expect(line.text.length).toBeGreaterThan(20);
      expect(line.source.length).toBeGreaterThan(3);
    }
    expect(guidanceById("flood-turn-around")?.text).toContain("Turn Around");
  });

  it("offers only the lines for the hazards in the record, plus power-outage lines when the weather can cut power", () => {
    const flood = guidanceFor(["flood"]).map((g) => g.hazard);
    expect(new Set(flood)).toEqual(new Set(["flood"]));
    const heat = new Set(guidanceFor(["heat"]).map((g) => g.hazard));
    expect(heat).toEqual(new Set(["heat", "outage"]));
  });
});

describe("local facts", () => {
  const facts = buildLocalFacts(inputs());

  it("gives every fact a real id, an official check link where there is one, and a 'why' label with its date", () => {
    expect(facts.facts.get("SE-1265274")).toMatchObject({ label: "Flash Flood report, Mar 27, 2021", href: "https://www.ncdc.noaa.gov/stormevents/eventdetails.jsp?id=1265274" });
    expect(facts.facts.get("SE-882999")?.label).toBe("EF3 tornado, Mar 3, 2020");
    expect(facts.facts.get("local-heat")?.label).toMatch(/^Hottest day on record, Jun 29, 2012/);
    expect(facts.facts.get("SE-555001")?.label).toBe("High Wind, Dec 31, 2018");
  });

  it("counts in code: the heat total, the flood days and the closest report are written into the source text", () => {
    const heat = facts.sources.find((s) => s.id === "local-heat")!;
    expect(heat.text).toContain("11 days in total");
    expect(heat.text).toContain("2011: 4 days; 2012: 7 days");
    const count = facts.sources.find((s) => s.id === "local-flood-count")!;
    expect(count.text).toContain("2 written NWS flood reports");
    expect(count.text).toContain("0.4 km");
  });

  it("area events say they are for the area, not the exact address, and carry the verbatim narrative", () => {
    const wind = facts.sources.find((s) => s.id === "SE-555001")!;
    expect(wind.text).toContain("not necessarily at this exact address");
    expect(wind.text).toContain("2 injuries");
    expect(wind.text).toContain("$1,500,000");
    expect(wind.quote).toBe("Strong winds downed trees and power lines across Davidson County.");
    // an event with no event narrative falls back on the episode narrative
    expect(facts.sources.find((s) => s.id === "SE-555002")!.quote).toContain("arctic outbreak");
  });

  it("ignores event types the plan does not cover, and summarises hazards from the record only", () => {
    expect(facts.sources.some((s) => s.id === "SE-555003")).toBe(false);
    expect(facts.hazards.map((h) => h.id)).toEqual(["flood", "tornado", "heat", "wind", "winter"]);
    expect(hazardOfType("Drought")).toBeNull();
  });

  it("no heat days of 100 F, no floods, no tornadoes, no events: no hazards and no sources (never invent a risk)", () => {
    const none = buildLocalFacts(inputs({ floods: [], tornadoes: [], events: [], heat: { ...HEAT, byYear: { "2010": 0, "2011": 0 } } }));
    expect(none.hazards).toEqual([]);
    expect(none.sources).toEqual([]);
  });

  it("an event already in the index (same id) is listed once", () => {
    const dup = buildLocalFacts(inputs({ events: [{ ...EVENTS[0], id: "SE-1265274", type: "Flash Flood" }] }));
    expect(dup.sources.filter((s) => s.id === "SE-1265274")).toHaveLength(1);
  });
});

describe("injected area events", () => {
  it("fills a missing episode narrative from the episodes map, keeps an event's own text, and leaves a missing one missing", () => {
    const base = { type: "Flood", start: "2020-01-01T00:00:00-06:00", area: { kind: "C" as const, code: "TNC037", name: "DAVIDSON" } };
    const out = withEpisodes([{ id: "SE-1", episodeId: "E-1", ...base }, { id: "SE-2", episodeId: "E-1", narrative: "Own words.", episodeNarrative: "Already here.", ...base }, { id: "SE-3", episodeId: "E-9", ...base }], { "E-1": "Episode words." });
    expect(out[0].episodeNarrative).toBe("Episode words.");
    expect(out[1].episodeNarrative).toBe("Already here.");
    expect(out[1].narrative).toBe("Own words.");
    expect(out[2].episodeNarrative).toBeUndefined();
  });

  it("an event with no narrative at all is still a fact (its date, type and effects), just without a quotation", () => {
    const facts = buildLocalFacts(inputs({ floods: [], tornadoes: [], heat: null, events: [{ id: "SE-7", type: "High Wind", start: "2018-12-31T16:00:00-06:00", area: { kind: "Z", code: "TNZ096", name: "DAVIDSON" }, injuries: 2 }] }));
    const src = facts.sources.find((s) => s.id === "SE-7")!;
    expect(src.quote).toBeUndefined();
    expect(src.text).toContain("2 injuries");
  });
});
