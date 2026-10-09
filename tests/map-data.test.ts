import { beforeEach, describe, expect, it } from "vitest";
import { fetchAlertZones, clearAlertZoneCache } from "@/lib/alert-zone";
import { buildAreaMap, parseAreaMapQuery } from "@/lib/area-map";
import { agencyTimeToIso, clearOutlookAreasCache, fetchOutlookAreas, levelOf, outlookAreasUrl, parseOutlookLayer } from "@/lib/outlook-areas";
import type { ZoneShape } from "@/lib/area-events";
import type { StateIndex } from "@/lib/types";
import { flood, tornado } from "./helpers";

const square = (lon: number, lat: number, d = 0.5) => [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("outlook areas for the 72-hour map", () => {
  beforeEach(() => clearOutlookAreasCache());

  it("reads the agencies' levels, skips general thunderstorms, and keeps the issue time", () => {
    expect(levelOf("flood", { outlook: "Slight (At Least 15%)" })).toBe("SLGT");
    expect(levelOf("flood", { outlook: "Marginal (At Least 5%)" })).toBe("MRGL");
    expect(levelOf("flood", { outlook: "Moderate (At Least 40%)" })).toBe("MDT");
    expect(levelOf("storm", { label: "ENH" })).toBe("ENH");
    expect(levelOf("storm", { label: "TSTM" })).toBeNull();
    expect(levelOf("storm", {})).toBeNull();
    expect(agencyTimeToIso("202610090058")).toBe("2026-10-09T00:58:00Z");
    expect(agencyTimeToIso("2026-10-09 00:29:00")).toBe("2026-10-09T00:29:00Z");
    expect(agencyTimeToIso("nonsense")).toBeNull();

    const parsed = parseOutlookLayer("storm", 1, {
      features: [
        { properties: { label: "TSTM", issue: "202610090058" }, geometry: { type: "MultiPolygon", coordinates: [square(-90, 35)] } },
        { properties: { label: "MRGL", issue: "202610090058", valid: "202610090100", expire: "202610091200" }, geometry: { type: "Polygon", coordinates: square(-90, 35) } },
        { properties: { label: "SLGT" }, geometry: null },
      ],
    });
    expect(parsed.features).toHaveLength(1);
    expect(parsed.features[0].properties).toEqual({ kind: "storm", day: 1, level: "MRGL" });
    expect(parsed.product).toMatchObject({ kind: "storm", day: 1, issued: "2026-10-09T00:58:00Z" });
  });

  it("asks the NWS map services once per day and kind, and draws the higher levels on top", async () => {
    const urls: string[] = [];
    const areas = await fetchOutlookAreas(async (url) => {
      urls.push(url);
      if (url.includes("wpc_precip_hazards")) return json({ features: [{ properties: { outlook: "Moderate (At Least 40%)", issue_time: "2026-10-08 20:31:00", valid_time: "12Z 10/09/26 - 12Z 10/10/26" }, geometry: { type: "Polygon", coordinates: square(-86, 36) } }, { properties: { outlook: "Marginal (At Least 5%)" }, geometry: { type: "Polygon", coordinates: square(-86, 36, 2) } }] });
      return json({ features: [] });
    });
    expect(urls).toHaveLength(6);
    expect(urls.every((u) => u.startsWith("https://mapservices.weather.noaa.gov/vector/rest/services/") && u.includes("f=geojson"))).toBe(true);
    expect(urls[0]).toBe(outlookAreasUrl("outlooks/SPC_wx_outlks/MapServer/1", "label,issue,valid,expire"));
    const levels = areas.areas.features.filter((f) => f.properties.day === 1 && f.properties.kind === "flood").map((f) => f.properties.level);
    expect(levels).toEqual(["MRGL", "MDT"]);
    expect(areas.notice).toBeUndefined();
    const floodDay1 = areas.products.find((p) => p.kind === "flood" && p.day === 1)!;
    expect(floodDay1.valid).toBe("12Z 10/09/26 - 12Z 10/10/26");
    // a complete answer is reused
    await fetchOutlookAreas(async () => {
      throw new Error("should not ask again");
    });
  });

  it("a layer that fails is left out and said so; nothing is invented, and a partial answer is not reused", async () => {
    let calls = 0;
    const partial = await fetchOutlookAreas(async (url) => (calls += 1, url.includes("MapServer/9") ? json({}, 500) : json({ features: [] })));
    expect(partial.notice).toMatch(/1 of the 6/);
    expect(partial.products).toHaveLength(5);
    await fetchOutlookAreas(async () => (calls += 1, json({ features: [] })));
    expect(calls).toBe(12);
    clearOutlookAreasCache();
    const none = await fetchOutlookAreas(async () => {
      throw new Error("offline");
    });
    expect(none.areas.features).toEqual([]);
    expect(none.notice).toMatch(/could not reach|did not answer|error/i);
  });
});

const zones: ZoneShape[] = [
  { code: "WAZ556", name: "Bellevue and Vicinity", validFrom: "2014-10-25", validTo: "2025-02-04", bbox: [-122.3, 47.5, -122.1, 47.7], polygons: [square(-122.2, 47.6, 0.1) as never] },
  { code: "WAZ999", name: "Box only", validFrom: null, validTo: null, bbox: [-122.3, 47.5, -122.1, 47.7], polygons: null },
];
const index: StateIndex = {
  state: "WA",
  built: "x",
  sources: [],
  floods: [
    flood({ id: "SE-1", filed: [47.61, -122.2], coordPrecision: "precise" }),
    flood({ id: "SE-2", filed: [47.6, -122.2], coordPrecision: "placeholder" }),
    flood({ id: "SE-3", filed: [47.6, -122.2], coordPrecision: "precise", dupOf: "SE-1" }),
    flood({ id: "SE-4", filed: [47.6, -122.2], coordPrecision: "placeholder", placed: [47.62, -122.19], detective: { verdict: "placed", clues: [], match: "x", matchType: "intersection", confidence: "high", model: "t", ranAt: "t" } }),
  ],
  tornadoes: [tornado({ id: "SE-9", begin: [47.0, -122.0], end: [47.2, -122.4] })],
};
const deps = { loadIndex: async () => index, loadZones: async () => zones };

describe("area map for the story and plan maps", () => {
  it("checks the query: a two-letter state, real zone codes of that state, and tidy record ids", () => {
    const q = (s: string) => parseAreaMapQuery(new URLSearchParams(s));
    expect(q("")).toBeNull();
    expect(q("state=Washington")).toBeNull();
    expect(q("state=wa&zones=WAZ556,TNZ027,../x,WAZ12&ids=SE-1,SE-1,a%20b,LSR-SEW-201912201657-0")).toEqual({ state: "WA", zones: ["WAZ556"], ids: ["SE-1", "LSR-SEW-201912201657-0"] });
    expect(q(`state=WA&ids=${Array.from({ length: 200 }, (_, i) => `SE-${i + 100}`).join(",")}`)!.ids).toHaveLength(80);
  });

  it("gives a zone outline (never a box-only zone), a point for a real place, and no point for a city placeholder or a duplicate", async () => {
    const map = await buildAreaMap({ state: "WA", zones: ["WAZ556", "WAZ999"], ids: ["SE-1", "SE-2", "SE-3", "SE-4", "SE-9", "SE-404"] }, deps);
    const zoneFeatures = map.features.filter((f) => f.properties.kind === "zone");
    expect(zoneFeatures.map((f) => f.properties.code)).toEqual(["WAZ556"]);
    expect(zoneFeatures[0].geometry.type).toBe("MultiPolygon");
    expect(map.points.map((p) => [p.id, p.kind]).sort()).toEqual([["SE-1", "flood"], ["SE-4", "flood"], ["SE-9", "tornado"]]);
    // a re-filed report is pinned where it was placed; a tornado at the middle of its track
    expect(map.points.find((p) => p.id === "SE-4")).toMatchObject({ lat: 47.62, lon: -122.19 });
    expect(map.points.find((p) => p.id === "SE-9")).toMatchObject({ lat: 47.1, lon: -122.2 });
    expect(map.features.find((f) => f.properties.kind === "track")?.properties.id).toBe("SE-9");
  });

  it("is empty, not broken, when the state has no index or no zones", async () => {
    const map = await buildAreaMap({ state: "WA", zones: ["WAZ556"], ids: ["SE-1"] }, { loadIndex: async () => null, loadZones: async () => null });
    expect(map).toEqual({ features: [], points: [] });
  });
});

describe("alert zones for alerts with no polygon", () => {
  beforeEach(() => clearAlertZoneCache());
  const route = (calls: string[], over: { alerts?: unknown; zone?: unknown } = {}) => async (url: string) => {
    calls.push(url);
    if (url.includes("alerts/active")) return json(over.alerts ?? { features: [{ geometry: null, properties: { event: "Flood Watch", affectedZones: ["https://api.weather.gov/zones/forecast/TNZ027", "https://api.weather.gov/zones/forecast/TNZ028"] } }] });
    if (url.includes("/points/")) return json({ properties: { forecastZone: "https://api.weather.gov/zones/forecast/TNZ027", county: "https://api.weather.gov/zones/county/TNC037" } });
    if (url.includes("/zones/")) return json(over.zone ?? { geometry: { type: "Polygon", coordinates: square(-86.8, 36.2) }, properties: { id: "TNZ027", name: "Davidson" } });
    throw new Error(`unrouted ${url}`);
  };

  it("draws only the zone that holds the address and that the alert itself names", async () => {
    const calls: string[] = [];
    const got = await fetchAlertZones(36.17, -86.78, route(calls));
    expect(got.zones).toHaveLength(1);
    expect(got.zones[0]).toMatchObject({ id: "TNZ027", name: "Davidson", events: ["Flood Watch"] });
    expect(calls.filter((c) => c.includes("/zones/"))).toEqual(["https://api.weather.gov/zones/forecast/TNZ027"]);
    // the outline is remembered
    const again: string[] = [];
    await fetchAlertZones(36.17, -86.78, route(again));
    expect(again.filter((c) => c.includes("/zones/"))).toEqual([]);
  });

  it("asks for nothing more when every alert has its own polygon, or none is active", async () => {
    const calls: string[] = [];
    expect((await fetchAlertZones(36, -86, route(calls, { alerts: { features: [{ geometry: { type: "Polygon", coordinates: square(-86, 36) }, properties: { event: "Tornado Warning" } }] } }))).zones).toEqual([]);
    expect(calls).toHaveLength(1);
    expect((await fetchAlertZones(36, -86, route([], { alerts: { features: [] } }))).zones).toEqual([]);
  });

  it("an alert that names no zone of the address's gets no outline, and a feed failure is a notice", async () => {
    const other = { features: [{ geometry: null, properties: { event: "Flood Watch", affectedZones: ["https://api.weather.gov/zones/forecast/TNZ099"] } }] };
    expect((await fetchAlertZones(36, -86, route([], { alerts: other }))).zones).toEqual([]);
    const down = await fetchAlertZones(36, -86, async () => json({}, 503));
    expect(down.zones).toEqual([]);
    expect(down.notice).toMatch(/alert feed/);
  });
});
