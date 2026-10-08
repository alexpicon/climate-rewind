import { describe, expect, it } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { bearingAcross, BUILDINGS_MIN_ZOOM, camera3D, DEM_TILES, disable3D, enable3D, is3D, PITCH_3D, TERRAIN_EXAGGERATION } from "@/lib/ui/terrain3d";
import { viewUrl } from "@/lib/ui/tabs";

/** A map that records what the 3D module asks of it. */
function fakeMap() {
  const sources = new Map<string, Record<string, unknown>>();
  const layers = new Map<string, Record<string, unknown>>([["labels", { id: "labels", layout: { visibility: "visible" } }]]);
  const calls: string[] = [];
  const state = { terrain: null as unknown, pitch: 62, bearing: -18, maxPitch: 0, sky: null as unknown, glyphs: null as unknown, light: null as unknown };
  const map = {
    getStyle: () => ({}),
    addSource: (id: string, spec: Record<string, unknown>) => void sources.set(id, spec),
    getSource: (id: string) => (sources.has(id) ? { ...sources.get(id), tileSize: 512 } : undefined),
    removeSource: (id: string) => void sources.delete(id),
    addLayer: (spec: Record<string, unknown>, before?: string) => {
      layers.set(spec.id as string, { ...spec, before });
    },
    getLayer: (id: string) => layers.get(id),
    removeLayer: (id: string) => void layers.delete(id),
    setLayoutProperty: (id: string, name: string, value: unknown) => {
      const layer = layers.get(id) as { layout?: Record<string, unknown> };
      layer.layout = { ...layer.layout, [name]: value };
    },
    setTerrain: (t: unknown) => void (state.terrain = t),
    getTerrain: () => state.terrain,
    setSky: (s: unknown) => void (state.sky = s),
    setGlyphs: (g: unknown) => void (state.glyphs = g),
    setLight: (l: unknown) => void (state.light = l),
    setMaxPitch: (n: number) => void (state.maxPitch = n),
    dragRotate: { enable: () => calls.push("rotate on"), disable: () => calls.push("rotate off") },
    touchPitch: { enable: () => calls.push("pitch on"), disable: () => calls.push("pitch off") },
    touchZoomRotate: { enableRotation: () => calls.push("touch rotate on"), disableRotation: () => calls.push("touch rotate off") },
    getPitch: () => state.pitch,
    getBearing: () => state.bearing,
    jumpTo: (o: { pitch?: number; bearing?: number }) => {
      state.pitch = o.pitch ?? state.pitch;
      state.bearing = o.bearing ?? state.bearing;
    },
    setPadding: () => calls.push("padding reset"),
  };
  return { map: map as unknown as MapLibreMap, sources, layers, state, calls };
}

describe("the 3D view", () => {
  it("adds Terrarium terrain and OpenFreeMap building extrusions, keyless", () => {
    const { map, sources, layers, state } = fakeMap();
    enable3D(map);
    expect(is3D(map)).toBe(true);
    expect(sources.get("dem")).toMatchObject({ type: "raster-dem", encoding: "terrarium", tiles: [DEM_TILES] });
    expect(DEM_TILES).toBe("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png");
    expect(sources.get("ofm")).toMatchObject({ type: "vector", url: "https://tiles.openfreemap.org/planet" });
    expect(state.terrain).toEqual({ source: "dem", exaggeration: TERRAIN_EXAGGERATION });
    expect(TERRAIN_EXAGGERATION).toBeGreaterThan(1);
    expect(TERRAIN_EXAGGERATION).toBeLessThanOrEqual(2);

    const buildings = layers.get("buildings-3d") as { type: string; source: string; "source-layer": string; minzoom: number; paint: Record<string, unknown>; before: string };
    expect(buildings).toMatchObject({ type: "fill-extrusion", source: "ofm", "source-layer": "building", minzoom: BUILDINGS_MIN_ZOOM });
    expect(JSON.stringify(buildings.paint["fill-extrusion-height"])).toContain("render_height");
    expect(JSON.stringify(buildings.paint["fill-extrusion-base"])).toContain("render_min_height");
    expect(buildings.before).toBe("labels"); // under the labels, like every overlay
    expect(state.maxPitch).toBeGreaterThanOrEqual(PITCH_3D);
  });

  it("swaps the flat Esri label tiles for real text labels while tilted, and puts them back", () => {
    const { map, layers } = fakeMap();
    enable3D(map);
    expect((layers.get("labels") as { layout: { visibility: string } }).layout.visibility).toBe("none");
    expect(layers.has("place-3d")).toBe(true);
    disable3D(map);
    expect((layers.get("labels") as { layout: { visibility: string } }).layout.visibility).toBe("visible");
    expect(layers.has("place-3d")).toBe(false);
  });

  it("is safe to call twice, and 2D comes back exactly: no terrain, flat, north up, no extra sources or layers", () => {
    const { map, sources, layers, state, calls } = fakeMap();
    enable3D(map);
    enable3D(map);
    expect(sources.size).toBe(2);
    disable3D(map);
    disable3D(map);
    expect(state.terrain).toBeNull();
    expect(sources.size).toBe(0);
    expect([...layers.keys()]).toEqual(["labels"]);
    expect(state.maxPitch).toBe(0);
    expect(state.pitch).toBe(0);
    expect(state.bearing).toBe(0);
    expect(calls).toContain("rotate off");
    expect(calls).toContain("padding reset");
  });

  it("builds a pitched camera at the address", () => {
    expect(camera3D([36.17, -86.78], 12.9, -18)).toEqual({ center: [-86.78, 36.17], zoom: 12.9, pitch: PITCH_3D, bearing: -18 });
    expect(PITCH_3D).toBeGreaterThanOrEqual(55);
    expect(PITCH_3D).toBeLessThanOrEqual(70);
  });

  it("turns to look across a track (the shot where the swath crosses the screen)", () => {
    expect(bearingAcross([36.17, -86.9], [36.17, -86.8])).toBe(0); // heading east: look north
    expect(bearingAcross([36.1, -86.9], [36.2, -86.8])).toBe(-51); // heading north-east (0.1 degree of longitude is shorter than of latitude)
    expect(Math.abs(bearingAcross([36.1, -86.8], [36.2, -86.8]))).toBe(90); // heading north: look east
    for (const [a, b] of [[[36, -87], [36.1, -86.7]], [[36, -86], [35.9, -86.5]], [[36, -87], [35.7, -87.01]]] as const) {
      expect(Math.abs(bearingAcross([...a], [...b]))).toBeLessThanOrEqual(90);
    }
  });
});

describe("the 3D link", () => {
  it("is shareable for the two tabs that have it, and for no other", () => {
    expect(viewUrl("1 Main St", "storm", null, true)).toBe("/?address=1+Main+St&tab=storm&view=3d");
    expect(viewUrl("1 Main St", "tornado", null, true)).toBe("/?address=1+Main+St&tab=tornado&view=3d");
    expect(viewUrl("1 Main St", "heat", null, true)).toBe("/?address=1+Main+St&tab=heat");
    expect(viewUrl("1 Main St", "storm", "2021-03-28T03:55", true)).toContain("night=2021-03-28T03%3A55&view=3d");
  });
  it("is absent by default: 2D is the map", () => {
    expect(viewUrl("1 Main St", "storm")).toBe("/?address=1+Main+St&tab=storm");
    expect(viewUrl(null, "storm", null, true)).toBe("/");
  });
});
