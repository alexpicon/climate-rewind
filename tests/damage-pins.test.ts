/**
 * The AI-mapped damage places on the tornado tab: which pins go with which tornado (county segments of one tornado are joined),
 * that every pin still carries the survey's own words, and that the Nashville Mar 3, 2020 EF3 gets its pins in the lookup payload.
 */
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadDamageRows } from "@/lib/ai/damage";
import { damagePinsFor, tornadoSegments } from "@/lib/damage-pins";
import { clearDataCaches, loadStateIndex } from "@/lib/index-store";
import { findNearbyTornadoes, lookupAddress, type LookupDeps } from "@/lib/lookup";
import { clearHeatCache } from "@/lib/sources";
import { DAMAGE_LABEL, damageLabel, damageWhere } from "@/lib/ui/tornado-model";
import type { DamagePin, NearbyTornado } from "@/lib/types";
import { CENSUS_NASHVILLE, FEMA_ZONE_X, NASHVILLE, NO_ALERTS, fakeFetch, heatYear, ok, openMeteoReply, tornado } from "./helpers";

const SURVEY = "An historic, long-track, strong EF-3 tornado began in western Davidson County then tracked eastward through Wilson County into Smith County before lifting, causing 5 deaths and 220 injuries. This tornado touched down west of River Road Pike then moved eastward across Bells Bend.";
const pin = (tornadoId: string, place: string): DamagePin => ({ tornadoId, place, phrase: `damage at ${place}`, ef: null, lat: 36.2, lon: -86.8, matchType: "street", confidence: "medium" });
const near = (t: ReturnType<typeof tornado>, km: number): NearbyTornado => ({ ...t, minDistanceKm: km, closest: t.begin });

describe("tornadoSegments", () => {
  const a = tornado({ id: "A", start: "2020-03-03T00:32:00-06:00", begin: [36.17, -86.96], end: [36.18, -86.57], narrative: SURVEY });
  // Starts where A ended, 22 minutes later, the same survey with a small difference further on (as NCEI files the county copies).
  const b = tornado({ id: "B", start: "2020-03-03T00:54:00-06:00", begin: [36.18, -86.57], end: [36.19, -86.1], narrative: `${SURVEY} The tornado finally lifted C. east of Highway 141.` });
  const c = tornado({ id: "C", start: "2020-03-03T01:19:00-06:00", begin: [36.19, -86.1], end: [36.15, -85.9], narrative: SURVEY });

  it("joins the county segments of one tornado: starts where the last ended, soon after, with the same survey", () => {
    const groups = tornadoSegments([a, b, c]);
    expect(groups.get("A")).toEqual(["A", "B", "C"]);
    expect(groups.get("C")).toEqual(["A", "B", "C"]);
  });

  it("does not join a different tornado: other survey text, a start far from the end, or hours later", () => {
    const other = tornado({ id: "X", start: "2020-03-03T00:50:00-06:00", begin: [36.18, -86.57], end: [36.2, -86.4], narrative: "A brief EF-0 tornado touched down near the Stones River and lifted after a short track in a field." });
    const far = tornado({ id: "Y", start: "2020-03-03T00:50:00-06:00", begin: [36.5, -86.0], end: [36.6, -86.0], narrative: SURVEY });
    const late = tornado({ id: "Z", start: "2020-03-03T06:00:00-06:00", begin: [36.18, -86.57], end: [36.2, -86.4], narrative: SURVEY });
    const groups = tornadoSegments([a, other, far, late]);
    expect(groups.get("A")).toEqual(["A"]);
    expect(groups.get("X")).toEqual(["X"]);
    expect(groups.get("Y")).toEqual(["Y"]);
    expect(groups.get("Z")).toEqual(["Z"]);
  });
});

describe("damagePinsFor", () => {
  const a = tornado({ id: "A", start: "2020-03-03T00:32:00-06:00", begin: [36.17, -86.96], end: [36.18, -86.57], narrative: SURVEY });
  const b = tornado({ id: "B", start: "2020-03-03T00:54:00-06:00", begin: [36.18, -86.57], end: [36.19, -86.1], narrative: SURVEY });
  const rows = [pin("A", "Barclay Drive"), pin("B", "Eastgate Blvd"), pin("Q", "Elsewhere")];

  it("gives a pin on a neighbouring segment to the tornado that is on the map, and drops pins of tornadoes not near", () => {
    const pins = damagePinsFor(rows, [a, b], [near(a, 0.65)]);
    expect(pins.map((p) => [p.tornadoId, p.place])).toEqual([["A", "Barclay Drive"], ["A", "Eastgate Blvd"]]);
  });

  it("with two segments of one tornado near, the closer one carries every pin once", () => {
    const pins = damagePinsFor(rows, [a, b], [near(a, 9), near(b, 4)]);
    expect(pins.map((p) => p.tornadoId)).toEqual(["B", "B"]);
  });

  it("is empty with no rows or no tornado nearby", () => {
    expect(damagePinsFor([], [a, b], [near(a, 1)])).toEqual([]);
    expect(damagePinsFor(rows, [a, b], [])).toEqual([]);
  });
});

describe("the shipped damage map (data/damage) on the Nashville sample", () => {
  const DAMAGE_DIR = path.resolve(process.cwd(), "data", "damage");
  beforeEach(() => clearDataCaches());

  const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

  it("every pin's phrase is the survey's own words, found in the narrative of the tornado it is filed under", async () => {
    for (const state of ["TN", "TX"]) {
      const index = (await loadStateIndex(state))!;
      const rows = await loadDamageRows(state, DAMAGE_DIR);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const t = index.tornadoes.find((x) => x.id === row.tornadoId);
        expect(t, `${row.tornadoId} exists in the ${state} index`).toBeDefined();
        expect(squash(t!.narrative).includes(squash(row.phrase)), `${row.place}: "${row.phrase}" is in ${row.tornadoId}`).toBe(true);
      }
    }
  });

  it("the Mar 3, 2020 EF3 (SE-882999) shows 17 pins: 8 on its Davidson segment, 7 in Wilson County and 2 in Smith County", async () => {
    const index = (await loadStateIndex("TN"))!;
    const rows = await loadDamageRows("TN", DAMAGE_DIR);
    const nearby = findNearbyTornadoes(index.tornadoes, NASHVILLE);
    expect(nearby.map((t) => t.id)).toContain("SE-882999");
    const pins = damagePinsFor(rows, index.tornadoes, nearby).filter((p) => p.tornadoId === "SE-882999");
    expect(pins).toHaveLength(17);
    const places = pins.map((p) => p.place);
    for (const expected of ["John C. Tune Airport", "Tennessee State University", "Barclay Drive", "Lincoya Hills", "Eastgate Blvd", "Dogwood Drive", "West Wilson Middle School", "Grant", "New Middleton"]) expect(places).toContain(expected);
    // Segments of this tornado that are not near the address are not drawn on their own: their pins ride with SE-882999.
    expect(damagePinsFor(rows, index.tornadoes, nearby).filter((p) => ["SE-883007", "SE-883009"].includes(p.tornadoId))).toEqual([]);
  });

  it("a lookup for the Nashville sample carries the pins, and one with no damage file carries none", async () => {
    clearHeatCache();
    const index = (await loadStateIndex("TN"))!;
    const deps = (loadDamage?: LookupDeps["loadDamage"]): LookupDeps => ({
      fetch: fakeFetch({ census: () => ok(CENSUS_NASHVILLE), fema: () => ok(FEMA_ZONE_X), nws: () => ok(NO_ALERTS), meteo: () => ok(openMeteoReply(heatYear(2024, { "2024-07-10": 100 }))) }),
      loadIndex: async () => index,
      loadHeatGrid: async () => null,
      loadDamage,
      now: () => new Date("2026-10-07T20:00:00Z"),
    });
    const withPins = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", deps(() => loadDamageRows("TN", DAMAGE_DIR)));
    expect(withPins.damage!.filter((p) => p.tornadoId === "SE-882999")).toHaveLength(17);
    expect(withPins.damage!.every((p) => withPins.tornadoes.some((t) => t.id === p.tornadoId))).toBe(true);

    clearHeatCache();
    expect((await lookupAddress("100 James Robertson Pkwy, Nashville, TN", deps())).damage).toEqual([]);
    clearHeatCache();
    expect((await lookupAddress("100 James Robertson Pkwy, Nashville, TN", deps(async () => { throw new Error("unreadable"); }))).damage).toEqual([]);
  });
});

describe("the words beside a pin", () => {
  it("says where a pin sits without overclaiming: a street pin is where the street meets the track", () => {
    expect(damageWhere("street")).toMatch(/street meets the track/);
    expect(damageWhere("street")).toMatch(/not stated/);
    expect(damageWhere("intersection")).toBe("intersection match");
    expect(damageWhere("landmark")).toBe("landmark match");
    expect(damageWhere("named_area")).toBe("centre of the named area");
    expect(damageWhere(null)).toBe("place match");
  });

  it("labels each pin with the place, the verbatim survey words and the AI label", () => {
    const text = damageLabel({ place: "Barclay Drive", phrase: "EF-2 damage to homes in the Lockeland Springs and Barclay Dr neighborhoods", matchType: "intersection" });
    expect(text).toBe("Damage place: Barclay Drive. The NWS survey says: \u201CEF-2 damage to homes in the Lockeland Springs and Barclay Dr neighborhoods\u201D. AI-mapped from the NWS survey; intersection match.");
    expect(DAMAGE_LABEL).toBe("AI-mapped from the NWS survey");
  });
});
