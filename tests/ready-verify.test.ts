import { describe, expect, it } from "vitest";
import { GUIDANCE } from "@/lib/ready/guidance";
import { buildLocalFacts } from "@/lib/ready/local";
import { guidanceFor, verifyReadyItems } from "@/lib/ready/plan";
import { inputs } from "./ready-fixtures";

const local = buildLocalFacts(inputs());
const guidance = guidanceFor(local.hazards.map((h) => h.id));
const check = (items: unknown) => verifyReadyItems(items, local.sources, local.facts, guidance);

const GOOD = {
  action: "After the Flash Flood report of Mar 27, 2021 near you, never drive through flood waters: Turn Around, Don’t Drown!",
  local: ["SE-1265274"],
  guidance: ["flood-turn-around"],
};

describe("the ready-item verifier", () => {
  it("keeps an item that cites a real local event and an official line, and gives back OUR words for the why and the source", () => {
    const { kept, dropped } = check([GOOD]);
    expect(dropped).toEqual([]);
    expect(kept).toHaveLength(1);
    expect(kept[0].why[0]).toMatchObject({ id: "SE-1265274", label: "Flash Flood report, Mar 27, 2021", hazard: "flood" });
    expect(kept[0].guidance[0]).toMatchObject({ id: "flood-turn-around", url: "https://www.ready.gov/floods" });
  });

  it("accepts a local NUMBER as the local citation (the heat record), not only an event id", () => {
    const { kept } = check([{ action: "Your record has 11 days with a feels-like high of 100°F or more; check on neighbors and older adults. Check on family members, older adults and neighbors.", local: ["local-heat"], guidance: ["heat-check-on"] }]);
    expect(kept).toHaveLength(1);
  });

  it("DROPS an item with no local citation", () => {
    const { kept, dropped } = check([{ ...GOOD, local: [] }]);
    expect(kept).toEqual([]);
    expect(dropped[0].reason).toBe("missing_local_citation");
  });

  it("DROPS an item with no guidance citation", () => {
    const { kept, dropped } = check([{ ...GOOD, guidance: [] }]);
    expect(kept).toEqual([]);
    expect(dropped[0].reason).toBe("missing_guidance_citation");
  });

  it("a guidance id in the local list is not a local record, and a local id in the guidance list is not official guidance", () => {
    expect(check([{ ...GOOD, local: ["flood-turn-around"] }]).dropped[0].reason).toBe("missing_local_citation");
    expect(check([{ ...GOOD, guidance: ["SE-1265274"] }]).dropped[0].reason).toBe("missing_guidance_citation");
  });

  it("drops made-up ids, even next to a real one", () => {
    expect(check([{ ...GOOD, local: ["SE-1265274", "SE-0000000"] }]).dropped[0].reason).toBe("unknown_citation");
    expect(check([{ ...GOOD, guidance: ["flood-invented-line"] }]).dropped[0].reason).toBe("unknown_citation");
  });

  it("drops a guidance line that was not on offer for this address's hazards (no wildfire advice for a place with no smoke record)", () => {
    expect(guidance.some((g) => g.id === "smoke-n95")).toBe(false);
    expect(check([{ ...GOOD, guidance: ["smoke-n95"] }]).dropped[0].reason).toBe("unknown_citation");
  });

  it("drops a number that no cited source holds, and a changed quote", () => {
    expect(check([{ ...GOOD, action: "Flooding was reported 7 times near you on Mar 27, 2021; Turn Around, Don’t Drown!" }]).dropped[0]).toMatchObject({ reason: "unsupported_number", detail: "7" });
    expect(check([{ ...GOOD, action: 'The NWS wrote "ROSA PARKS BLVD WAS A RIVER" on Mar 27, 2021, so avoid flooded roads.' }]).dropped[0].reason).toBe("unsupported_quote");
  });

  it("keeps a quote copied word for word from the local report", () => {
    const { kept } = check([{ ...GOOD, action: 'The NWS wrote "ROSA PARKS BLVD UNDERWATER NEAR THE FARMERS MARKET" on Mar 27, 2021, so do not drive through flood waters.' }]);
    expect(kept).toHaveLength(1);
  });

  it("drops predictions and links", () => {
    expect(check([{ ...GOOD, action: "Your street will flood again, so Turn Around, Don’t Drown on Mar 27, 2021 roads." }]).dropped[0].reason).toBe("overclaim");
    expect(check([{ ...GOOD, action: "See https://example.com about the Mar 27, 2021 flood and Turn Around, Don’t Drown." }]).dropped[0].reason).toBe("bad_format");
  });

  it("drops items that are not objects with the right fields, and non-arrays", () => {
    expect(check([null, "x", { action: 5 }, { action: "ok then do it", local: "SE-1", guidance: [] }]).dropped.map((d) => d.reason)).toEqual(["bad_format", "bad_format", "bad_format", "bad_format"]);
    expect(check({ items: [] })).toEqual({ kept: [], dropped: [] });
  });

  it("keeps at most 6 items and never the same text twice", () => {
    const words = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India"];
    const many = words.map((w) => ({ ...GOOD, action: `${GOOD.action} Note ${w}.` }));
    expect(check(many).kept).toHaveLength(6);
    expect(check([GOOD, GOOD]).kept).toHaveLength(1);
  });
});
