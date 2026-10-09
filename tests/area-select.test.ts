import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { chooseZones, clearEventsCache, parseZones, pickTop, selectAreaEvents, sinceYear, summarizeAreaEvents } from "@/lib/area-events";
import { eventSource, storyEvents, whereText } from "@/lib/ai/event-sources";
import { storyKey } from "@/lib/ai/story";
import { rankBySeverity } from "@/lib/event-severity";
import { tierLabel, zonesLine } from "@/lib/ui/story-model";
import { distanceToBboxKm, distanceToPolygonsKm, KM_PER_DEGREE, pointInPolygons, polygonsOf, type PolygonCoords } from "@/lib/zone-geometry";
import type { AreaEvent } from "@/lib/types";

// ---------------------------------------------------------------- geometry

const BELLEVUE = { lat: 47.6142, lon: -122.1935 };
const COS = Math.cos((BELLEVUE.lat * Math.PI) / 180);

/** A rectangle from `west`..`east` km east of the address and `south`..`north` km north of it, as one polygon's outline. */
function rect(west: number, east: number, south: number, north: number): PolygonCoords {
  const pt = (x: number, y: number): [number, number] => [BELLEVUE.lon + x / (KM_PER_DEGREE * COS), BELLEVUE.lat + y / KM_PER_DEGREE];
  return [[pt(west, south), pt(east, south), pt(east, north), pt(west, north), pt(west, south)]];
}
const geojson = (...polygons: PolygonCoords[]) => ({ type: "MultiPolygon", coordinates: polygons });
const bboxOf = (polygon: PolygonCoords) => {
  const pts = polygon.flat();
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
};
const zoneJson = (name: string, polygon: PolygonCoords, extra: Record<string, unknown> = {}) => ({ name, validFrom: "2014-10-25", validTo: "2025-02-25", bbox: bboxOf(polygon), polygon: geojson(polygon), ...extra });

describe("point in polygon", () => {
  it("is true inside, false outside, and the address is the origin of every test below", () => {
    const around = rect(-5, 5, -5, 5);
    expect(pointInPolygons(BELLEVUE.lat, BELLEVUE.lon, [around])).toBe(true);
    expect(pointInPolygons(BELLEVUE.lat, BELLEVUE.lon, [rect(1, 5, -5, 5)])).toBe(false);
    expect(pointInPolygons(BELLEVUE.lat, BELLEVUE.lon, [rect(-5, -1, -5, 5)])).toBe(false);
    expect(pointInPolygons(BELLEVUE.lat, BELLEVUE.lon, [rect(-5, 5, 1, 5)])).toBe(false);
  });

  it("a hole takes the point out, an island inside the hole puts it back, and any polygon of a multipolygon will do", () => {
    const outline = rect(-10, 10, -10, 10)[0];
    const hole = rect(-2, 2, -2, 2)[0];
    const island = rect(-0.5, 0.5, -0.5, 0.5)[0];
    expect(pointInPolygons(BELLEVUE.lat, BELLEVUE.lon, [[outline, hole]])).toBe(false);
    expect(pointInPolygons(BELLEVUE.lat, BELLEVUE.lon, [[outline, hole], [island]])).toBe(true);
    expect(pointInPolygons(BELLEVUE.lat, BELLEVUE.lon, [rect(20, 30, 0, 1), rect(-1, 1, -1, 1)])).toBe(true);
  });

  it("works for an L shape (a concave outline) on both sides of the notch", () => {
    const L: PolygonCoords = [[[-0.2, -0.2], [0.2, -0.2], [0.2, 0.0], [0.0, 0.0], [0.0, 0.2], [-0.2, 0.2], [-0.2, -0.2]].map(([x, y]) => [BELLEVUE.lon + x, BELLEVUE.lat + y] as [number, number])];
    expect(pointInPolygons(BELLEVUE.lat, BELLEVUE.lon, [L])).toBe(true); // lower-left arm
    expect(pointInPolygons(BELLEVUE.lat + 0.1, BELLEVUE.lon + 0.1, [L])).toBe(false); // the notch
    expect(pointInPolygons(BELLEVUE.lat + 0.1, BELLEVUE.lon - 0.1, [L])).toBe(true); // upper-left arm
  });

  it("a point exactly on an edge counts as inside; garbage and empty shapes are never inside", () => {
    expect(pointInPolygons(BELLEVUE.lat, BELLEVUE.lon, [rect(0, 5, -5, 5)])).toBe(true);
    expect(pointInPolygons(BELLEVUE.lat, BELLEVUE.lon, [])).toBe(false);
    expect(distanceToPolygonsKm(BELLEVUE.lat, BELLEVUE.lon, [])).toBe(Infinity);
    expect(polygonsOf({ type: "MultiPolygon", coordinates: [[[[1, 2], ["x", 3]]]] })).toBeNull();
    expect(polygonsOf({ type: "Point", coordinates: [1, 2] })).toBeNull();
    expect(polygonsOf(null)).toBeNull();
    expect(polygonsOf({ type: "Polygon", coordinates: rect(-1, 1, -1, 1) })).toHaveLength(1);
  });
});

describe("distance to a polygon", () => {
  it("is 0 inside, and the straight-line km to the nearest edge outside (east, north-east corner, and across a hole)", () => {
    expect(distanceToPolygonsKm(BELLEVUE.lat, BELLEVUE.lon, [rect(-1, 1, -1, 1)])).toBe(0);
    expect(distanceToPolygonsKm(BELLEVUE.lat, BELLEVUE.lon, [rect(4, 9, -3, 3)])).toBeCloseTo(4, 3);
    expect(distanceToPolygonsKm(BELLEVUE.lat, BELLEVUE.lon, [rect(3, 9, 4, 9)])).toBeCloseTo(5, 3); // corner at (3, 4)
    const outline = rect(-10, 10, -10, 10)[0];
    expect(distanceToPolygonsKm(BELLEVUE.lat, BELLEVUE.lon, [[outline, rect(-2, 2, -2, 2)[0]]])).toBeCloseTo(2, 3); // in the hole: to the hole's edge
  });

  it("the box distance never exceeds the outline distance, and is 0 inside the box", () => {
    const poly = rect(6, 9, -3, 3);
    expect(distanceToBboxKm(BELLEVUE.lat, BELLEVUE.lon, bboxOf(poly) as [number, number, number, number])).toBeCloseTo(6, 3);
    expect(distanceToBboxKm(BELLEVUE.lat, BELLEVUE.lon, bboxOf(rect(-1, 1, -1, 1)) as [number, number, number, number])).toBe(0);
  });
});

// ---------------------------------------------------------------- the 15 km rule

const zoneOf = (code: string, polygon: PolygonCoords, extra: Record<string, unknown> = {}) => parseZones({ [code]: zoneJson(code, polygon, extra) });

describe("the 15 km rule", () => {
  const choose = (zones: ReturnType<typeof parseZones>) => chooseZones(BELLEVUE.lat, BELLEVUE.lon, zones).map((z) => [z.code, z.tier]);

  it("a zone whose edge is 14.9 km away is nearby; 15.1 km is not read at all", () => {
    expect(choose(zoneOf("WAZ001", rect(14.9, 30, -5, 5)))).toEqual([["WAZ001", "nearby zone"]]);
    expect(choose(zoneOf("WAZ002", rect(15.1, 30, -5, 5)))).toEqual([]);
  });

  it("measures to the edge, not to the middle: a huge zone 5 km off counts, and a corner 15.1 km away does not", () => {
    expect(choose(zoneOf("WAZ003", rect(5, 400, -400, 400)))).toEqual([["WAZ003", "nearby zone"]]);
    // corner at (10.7, 10.7): 15.13 km straight line, though each side is under 15 km
    expect(choose(zoneOf("WAZ004", rect(10.7, 30, 10.7, 30)))).toEqual([]);
    expect(choose(zoneOf("WAZ005", rect(10.5, 30, 10.5, 30)))).toEqual([["WAZ005", "nearby zone"]]); // 14.85 km
  });

  it("a zone that contains the address is 'your zone' with distance 0, whatever else is around", () => {
    const zones = [...zoneOf("WAZ010", rect(8, 30, -5, 5)), ...zoneOf("WAZ011", rect(-2, 2, -2, 2)), ...zoneOf("WAZ012", rect(-40, 40, -40, 40))];
    const chosen = chooseZones(BELLEVUE.lat, BELLEVUE.lon, zones);
    expect(chosen.map((z) => [z.code, z.tier])).toEqual([["WAZ011", "your zone"], ["WAZ012", "your zone"], ["WAZ010", "nearby zone"]]);
    expect(chosen[0].distanceKm).toBe(0);
    expect(chosen[2].distanceKm).toBeCloseTo(8, 3);
  });

  it("an approximate (box only) zone is nearby only if its box is within 15 km, and is never 'your zone', even around the address", () => {
    const approx = (code: string, polygon: PolygonCoords) => parseZones({ [code]: { name: code, validFrom: "2000-01-01", validTo: "2005-01-01", bbox: bboxOf(polygon), approx: true } });
    expect(choose(approx("WAZ020", rect(14.9, 30, -5, 5)))).toEqual([["WAZ020", "nearby zone"]]);
    expect(choose(approx("WAZ021", rect(15.1, 30, -5, 5)))).toEqual([]);
    expect(choose(approx("WAZ022", rect(-5, 5, -5, 5)))).toEqual([["WAZ022", "nearby zone"]]);
    // even when a polygon is present, `approx` means the outline is not to be trusted
    expect(choose(zoneOf("WAZ023", rect(-5, 5, -5, 5), { approx: true }))).toEqual([["WAZ023", "nearby zone"]]);
  });

  it("skips zones without a usable box, and tolerates a file that is not an object", () => {
    expect(parseZones({ WAZ030: { name: "x", polygon: geojson(rect(-1, 1, -1, 1)) }, junk: { bbox: [1, 2, 3, 4] } })).toEqual([]);
    expect(parseZones(null)).toEqual([]);
    expect(parseZones([])).toEqual([]);
  });
});

// ---------------------------------------------------------------- Bellevue against a small fixture

const row = (id: string, code: string, over: Record<string, unknown> = {}) => ({
  id,
  episodeId: `E-${id}`,
  type: "High Wind",
  start: "2006-12-14T16:00:00-08:00",
  end: null,
  area: { kind: code.includes("C") ? "C" : "Z", code, name: code === "WAC033" ? "KING" : code },
  deaths: 0,
  injuries: 0,
  damageUsd: 0,
  magnitude: null,
  magnitudeType: null,
  narrative: "",
  ...over,
});

function bellevueDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "bellevue-"));
  mkdirSync(path.join(dir, "WA"));
  const write = (name: string, body: unknown) => writeFileSync(path.join(dir, "WA", name), name.endsWith(".gz") ? gzipSync(JSON.stringify(body)) : JSON.stringify(body));
  write("zones.json", {
    WAZ505: zoneJson("East Puget Sound Lowlands", rect(-20, 25, -20, 40), { validFrom: "2006-11-26", validTo: "2014-02-08" }),
    WAZ556: zoneJson("Bellevue and Vicinity", rect(-4, 8, -10, 25)),
    WAZ558: zoneJson("Seattle and Vicinity", rect(-30, -3.5, -30, 20)), // its east edge is 3.5 km west of the address
    WAZ568: zoneJson("Cascades of Pierce and Eastern King Counties", rect(40, 90, -60, -35)), // Mount Rainier: far south-east
    WAZ600: zoneJson("Cascades of Whatcom and Skagit Counties", rect(-5, 5, 45, 90)), // 45 km north: Mt Baker
    WAZ025: { name: "approximate", validFrom: "2000-01-01", validTo: "2001-01-01", bbox: bboxOf(rect(30, 60, -5, 5)), approx: true },
  });
  write("county-areas.json", { WAC033: ["WAC033", "WAZ505", "WAZ556", "WAZ558", "WAZ568", "WAZ600"] }); // the old overlap list, which must now be ignored
  write("WAC033.json.gz", { events: [row("SE-FLASH", "WAC033", { type: "Flash Flood", start: "2009-01-07T08:00:00-08:00", narrative: "Cities flooded." })], episodes: {} });
  write("WAZ505.json.gz", { events: [row("SE-WIND-2006", "WAZ505", { deaths: 2, damageUsd: 80_000_000, narrative: "Strong winds knocked down trees and power lines." })] });
  write("WAZ556.json.gz", { events: [row("SE-SNOW-2019", "WAZ556", { type: "Heavy Snow", start: "2019-02-09T04:00:00-08:00", narrative: "Heavy snow fell." })] });
  write("WAZ558.json.gz", {
    events: [
      row("SE-SMOKE-2020", "WAZ558", { type: "Dense Smoke", start: "2020-09-11T06:00:00-07:00", narrative: "Wildfire smoke." }),
      row("SE-HEAT-2021", "WAZ558", { type: "Excessive Heat", start: "2021-06-26T12:00:00-07:00", deaths: 9, narrative: "Record heat." }),
    ],
  });
  write("WAZ568.json.gz", { events: [row("SE-RAINIER", "WAZ568", { type: "Heavy Snow", start: "2014-06-21T10:00:00-07:00", deaths: 6, narrative: "Climbers died on Mount Rainier." })] });
  write("WAZ600.json.gz", { events: [row("SE-AVALANCHE", "WAZ600", { type: "Avalanche", start: "2012-02-20T10:00:00-08:00", deaths: 3, narrative: "An avalanche near Snoqualmie Pass." })] });
  write("WAZ025.json.gz", { events: [row("SE-APPROX", "WAZ025", { start: "2000-03-01T00:00:00-08:00", narrative: "Old." })] });
  return dir;
}

beforeEach(() => clearEventsCache());

describe("selectAreaEvents for Bellevue (47.6142, -122.1935)", () => {
  it("returns the county's rows, the zones around the address, and nearby zones; no Rainier, no avalanche", async () => {
    const found = await selectAreaEvents(BELLEVUE.lat, BELLEVUE.lon, "WA", "WAC033", bellevueDir());
    const byId = new Map(found!.events.map((e) => [e.id, e]));
    expect([...byId.keys()].sort()).toEqual(["SE-FLASH", "SE-HEAT-2021", "SE-SMOKE-2020", "SE-SNOW-2019", "SE-WIND-2006"]);
    expect(byId.get("SE-WIND-2006")).toMatchObject({ tier: "your zone", zoneName: "East Puget Sound Lowlands" });
    expect(byId.get("SE-SNOW-2019")).toMatchObject({ tier: "your zone", zoneName: "Bellevue and Vicinity" });
    expect(byId.get("SE-SMOKE-2020")).toMatchObject({ tier: "nearby zone", zoneName: "Seattle and Vicinity" });
    expect(byId.get("SE-HEAT-2021")).toMatchObject({ tier: "nearby zone", zoneName: "Seattle and Vicinity" });
    expect(byId.get("SE-FLASH")).toMatchObject({ tier: "county", zoneName: null });
    expect(byId.has("SE-RAINIER")).toBe(false);
    expect(byId.has("SE-AVALANCHE")).toBe(false);
    expect(byId.has("SE-APPROX")).toBe(false); // the approximate zone's box is 30 km away
    expect(found!.areaCodes).toEqual(["WAC033", "WAZ505", "WAZ556", "WAZ558"]);
    expect(found!.zones.map((z) => [z.code, z.tier, Math.round(z.distanceKm * 10) / 10])).toEqual([["WAZ505", "your zone", 0], ["WAZ556", "your zone", 0], ["WAZ558", "nearby zone", 3.5]]);
  });

  it("an address up in the mountains gets the mountain zone as 'your zone' (the rule is geometry, not a blacklist)", async () => {
    const dir = bellevueDir();
    // Mount Rainier's own point: inside the WAZ568 rectangle, measured from the Bellevue origin (65 km east, 45 km south)
    const lat = BELLEVUE.lat - 45 / KM_PER_DEGREE;
    const lon = BELLEVUE.lon + 65 / (KM_PER_DEGREE * COS);
    const found = await selectAreaEvents(lat, lon, "WA", "WAC033", dir);
    expect(found!.events.find((e) => e.id === "SE-RAINIER")).toMatchObject({ tier: "your zone" });
    expect(found!.events.some((e) => e.id === "SE-WIND-2006")).toBe(false);
  });

  it("reads each file once: after the files are deleted the same answer comes from the cache", async () => {
    const dir = bellevueDir();
    const first = await selectAreaEvents(BELLEVUE.lat, BELLEVUE.lon, "WA", "WAC033", dir);
    rmSync(path.join(dir, "WA"), { recursive: true });
    const second = await selectAreaEvents(BELLEVUE.lat, BELLEVUE.lon, "WA", "WAC033", dir);
    expect(second?.events.map((e) => e.id)).toEqual(first?.events.map((e) => e.id));
    expect(second?.events.length).toBe(5);
    clearEventsCache();
    expect(await selectAreaEvents(BELLEVUE.lat, BELLEVUE.lon, "WA", "WAC033", dir)).toBeNull();
  });

  it("an event filed under both a county and a zone is told once, as the closer tier; a state with only county files still answers", async () => {
    const dir = bellevueDir();
    writeFileSync(path.join(dir, "WA", "WAZ556.json.gz"), gzipSync(JSON.stringify({ events: [row("SE-FLASH", "WAZ556", { type: "Flash Flood", start: "2009-01-07T08:00:00-08:00" })] })));
    const found = await selectAreaEvents(BELLEVUE.lat, BELLEVUE.lon, "WA", "WAC033", dir);
    expect(found!.events.filter((e) => e.id === "SE-FLASH")).toHaveLength(1);
    expect(found!.events.find((e) => e.id === "SE-FLASH")?.tier).toBe("county");

    clearEventsCache();
    rmSync(path.join(dir, "WA", "zones.json"));
    const countyOnly = await selectAreaEvents(BELLEVUE.lat, BELLEVUE.lon, "WA", "WAC033", dir);
    expect(countyOnly?.events.map((e) => e.id)).toEqual(["SE-FLASH"]);
    expect(countyOnly?.zones).toEqual([]);
  });
});

// ---------------------------------------------------------------- tiers in the summary, the story and the words

describe("tiers in the story", () => {
  const event = (id: string, tier: AreaEvent["tier"], over: Partial<AreaEvent> = {}): AreaEvent => ({
    id,
    episodeId: id,
    type: "High Wind",
    start: "2010-01-01T00:00:00-08:00",
    end: null,
    area: { kind: "Z", code: "WAZ556", name: "X" },
    deaths: 0,
    injuries: 0,
    damageUsd: 0,
    magnitude: null,
    magnitudeType: null,
    narrative: "words",
    episodeNarrative: "",
    tier,
    zoneName: tier === "county" ? null : "Seattle and Vicinity",
    ...over,
  });

  it("your zone and county come before a nearby zone, however severe the nearby one is; then severity decides", () => {
    const events = [event("near-deadly", "nearby zone", { deaths: 9 }), event("zone-mild", "your zone"), event("county-damage", "county", { damageUsd: 5_000_000 }), event("zone-deadly", "your zone", { deaths: 1 })];
    expect(rankBySeverity(events).map((e) => e.id)).toEqual(["zone-deadly", "county-damage", "zone-mild", "near-deadly"]);
    const summary = summarizeAreaEvents(events, "WAC033", ["WAC033"], "x");
    expect(storyEvents(summary, 3).map((e) => e.id).sort()).toEqual(["county-damage", "zone-deadly", "zone-mild"]);
  });

  it("the top list keeps a fifth of its room for nearby-zone events so they show, labelled, but never push out the address's own", () => {
    const own = Array.from({ length: 70 }, (_, i) => event(`own-${i}`, "your zone", { deaths: 1 }));
    const near = Array.from({ length: 30 }, (_, i) => event(`near-${i}`, "nearby zone", { deaths: 5 }));
    const top = pickTop([...near, ...own], 60);
    expect(top).toHaveLength(60);
    expect(top.filter((e) => e.tier === "nearby zone")).toHaveLength(12);
    expect(top.filter((e) => e.tier === "your zone")).toHaveLength(48);
    // few of the address's own: the nearby ones fill the room
    expect(pickTop([...near, ...own.slice(0, 5)], 60)).toHaveLength(35);
    expect(pickTop(own.slice(0, 5), 60)).toHaveLength(5);
  });

  it("the source the model reads says whose event it is, and the zone's name for a nearby one", () => {
    expect(whereText(event("a", "nearby zone"))).toMatch(/Seattle and Vicinity \(forecast zone WAZ556, a NEARBY zone within 15 km, not the zone the address is in\)/);
    expect(whereText(event("b", "your zone"))).toMatch(/YOUR zone/);
    expect(whereText(event("c", "county", { area: { kind: "C", code: "WAC033", name: "KING" } }))).toBe("KING (county WAC033)");
    expect(eventSource(event("a", "nearby zone")).text).toMatch(/NEARBY zone/);
  });

  it("the page labels nearby and own zones in words, and says which zones are counted", () => {
    expect(tierLabel(event("a", "nearby zone"))).toBe("Nearby zone: Seattle and Vicinity");
    expect(tierLabel(event("b", "your zone", { zoneName: "Bellevue and Vicinity" }))).toBe("Your zone: Bellevue and Vicinity");
    expect(tierLabel(event("c", "county"))).toBeNull();
    expect(tierLabel({})).toBeNull();
    const line = zonesLine([
      { code: "WAZ505", name: "East Puget Sound Lowlands", tier: "your zone", distanceKm: 0, events: 3 },
      { code: "WAZ556", name: "Bellevue and Vicinity", tier: "your zone", distanceKm: 0, events: 2 },
      { code: "WAZ508", name: "Seattle/Bremerton Area", tier: "nearby zone", distanceKm: 3.8, events: 9 },
      { code: "WAZ558", name: "Seattle and Vicinity", tier: "nearby zone", distanceKm: 3.84, events: 9 },
      { code: "WAZ555", name: "East Puget Sound Lowlands", tier: "nearby zone", distanceKm: 9.4, events: 4 }, // the same zone, redrawn: already yours
    ]);
    expect(line).toBe("Your zone: East Puget Sound Lowlands, Bellevue and Vicinity. Also counted, within 15 km: Seattle/Bremerton Area (4 km away), Seattle and Vicinity (4 km away).");
    expect(zonesLine([])).toBeNull();
    expect(zonesLine(undefined)).toBeNull();
  });

  it("the summary lists the zones with their event counts, and two addresses in one county with different zones do not share a cached story", async () => {
    const dir = bellevueDir();
    const found = (await selectAreaEvents(BELLEVUE.lat, BELLEVUE.lon, "WA", "WAC033", dir))!;
    const summary = summarizeAreaEvents(sinceYear(found.events), "WAC033", found.areaCodes, "x", 60, found.zones);
    expect(summary.zones).toEqual([
      { code: "WAZ505", name: "East Puget Sound Lowlands", tier: "your zone", distanceKm: 0, events: 1 },
      { code: "WAZ556", name: "Bellevue and Vicinity", tier: "your zone", distanceKm: 0, events: 1 },
      { code: "WAZ558", name: "Seattle and Vicinity", tier: "nearby zone", distanceKm: 3.5, events: 2 },
    ]);
    const mountain = { county: "WAC033", areaCodes: ["WAC033", "WAZ568"] };
    expect(storyKey(summary)).not.toBe(storyKey(mountain));
    expect(storyKey({ county: "WAC033", areaCodes: ["WAZ556", "WAC033"] })).toBe(storyKey({ county: "WAC033", areaCodes: ["WAC033", "WAZ556"] }));
  });
});
