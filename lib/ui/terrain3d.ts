/**
 * The optional 3D view: terrain from AWS Terrarium elevation tiles and extruded buildings from OpenFreeMap vector tiles,
 * both keyless. 2D stays the default; nothing here changes the 2D map until a view asks for it, and `disable3D` puts it all back.
 *
 * Radar images, report lines, tornado swaths and the heat/trail layers are ordinary map layers, so MapLibre drapes them over the
 * terrain. DOM markers (reports, pins, the vortex, the house) are placed on the ground at their coordinates by MapLibre.
 */
import type { LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import { LABELS_LAYER } from "./map-style";
import { syncPadding, type Camera } from "./camera";
import type { Coord } from "../types";

export const DEM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const BUILDINGS_TILEJSON = "https://tiles.openfreemap.org/planet";
export const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

/** Modest exaggeration: hills read as hills without turning a city into a model. */
export const TERRAIN_EXAGGERATION = 1.4;
export const PITCH_3D = 62;
/** Buildings only exist in the vector tiles from zoom 13; the source is read at 256 px so they show from map zoom 12. */
export const BUILDINGS_MIN_ZOOM = 12;
/**
 * The storm replay's 3D view stops at city scale: the radar's own squares are 1 km wide, so closer in they stop looking like radar and
 * become a smooth orange blob. To keep the buildings in that view, the vector source is read at 160 px, which asks for the zoom 13
 * building tiles from map zoom 11.36 (a zoom and a third earlier than the default).
 */
export const STORM_3D_MAX_ZOOM = 11.5;
export const STORM_BUILDINGS = { minZoom: 11.3, tileSize: 160 } as const;

export interface Options3D {
  /** When buildings first show, and the size the vector tiles are read at (smaller = the building tiles load from a lower map zoom). */
  buildings?: { minZoom: number; tileSize: number };
}
/** Longest flight when 3D turns on. */
export const FLY_IN_MS = 4800;

const SOURCES = ["dem", "ofm"] as const;
const LAYERS = ["place-3d", "roads-3d", "buildings-3d"] as const;

export function is3D(map: MapLibreMap): boolean {
  return Boolean(map.getSource("dem"));
}

/** The 3D camera: pitched, with a gentle turn, and the map padding that keeps the address in the free part of the screen. */
export interface Camera3D extends Camera {
  pitch: number;
  bearing: number;
}

export function camera3D(origin: Coord, zoom: number, bearing: number): Camera3D {
  return { center: [origin[1], origin[0]], zoom, pitch: PITCH_3D, bearing };
}

/** A bearing that looks across a track (perpendicular to it), turned the short way round so it stays gentle. */
export function bearingAcross(begin: Coord, end: Coord): number {
  const dLon = ((end[1] - begin[1]) * Math.PI) / 180 * Math.cos((((begin[0] + end[0]) / 2) * Math.PI) / 180);
  const dLat = ((end[0] - begin[0]) * Math.PI) / 180;
  const track = (Math.atan2(dLon, dLat) * 180) / Math.PI; // degrees clockwise from north
  let across = track - 90;
  while (across > 90) across -= 180; // looking either way across the track is the same shot; take the gentler one
  while (across <= -90) across += 180;
  return Math.round(across);
}

const buildingColor = [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "render_height"], 6],
  0, "#33426a",
  30, "#42548a",
  90, "#566ba3",
  200, "#7088be",
] as const;

/**
 * Turns on terrain, buildings, the horizon and the pitch limits. Safe to call twice.
 * Labels: the Esri label tiles are flat pictures that smear when tilted, so in 3D they are swapped for real text labels
 * (place names and major roads) from the same OpenFreeMap tiles.
 */
export function enable3D(map: MapLibreMap, options: Options3D = {}): void {
  if (is3D(map)) return;
  const buildingsView = options.buildings ?? { minZoom: BUILDINGS_MIN_ZOOM, tileSize: 256 };

  map.addSource("dem", {
    type: "raster-dem",
    tiles: [DEM_TILES],
    encoding: "terrarium",
    // 512 px: the elevation is read one zoom coarser (about 40 m a pixel at city zoom), a quarter of the tiles, and hills look the same.
    tileSize: 512,
    maxzoom: 14,
    attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen, AWS Terrain Tiles</a>',
  });
  map.addSource("ofm", {
    type: "vector",
    url: BUILDINGS_TILEJSON,
    attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; OpenMapTiles, data from OpenStreetMap',
  });
  // The style spec has no tile size for vector sources (MapLibre assumes 512). Reading them as 256 asks for the zoom 13 building
  // tiles from map zoom 12, a zoom earlier. If a later MapLibre ignores this, buildings simply start at map zoom 13.
  (map.getSource("ofm") as unknown as { tileSize: number }).tileSize = buildingsView.tileSize;
  map.setGlyphs(GLYPHS);

  const before = map.getLayer(LABELS_LAYER) ? LABELS_LAYER : undefined;
  const buildings: LayerSpecification = {
    id: "buildings-3d",
    type: "fill-extrusion",
    source: "ofm",
    "source-layer": "building",
    minzoom: buildingsView.minZoom,
    filter: ["!=", ["get", "hide_3d"], true],
    paint: {
      "fill-extrusion-color": buildingColor as never,
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 0.88,
      "fill-extrusion-vertical-gradient": true,
    },
  };
  map.addLayer(buildings, before);

  const textFont = ["Noto Sans Regular"];
  const textPaint = { "text-color": "#E9EEF8", "text-halo-color": "rgba(6,10,19,0.92)", "text-halo-width": 1.6 };
  map.addLayer({
    id: "roads-3d",
    type: "symbol",
    source: "ofm",
    "source-layer": "transportation_name",
    minzoom: 13.4,
    filter: ["match", ["get", "class"], ["motorway", "trunk", "primary", "secondary"], true, false],
    layout: { "symbol-placement": "line", "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": textFont, "text-size": 11.5, "text-letter-spacing": 0.04, "text-pitch-alignment": "viewport" },
    paint: { ...textPaint, "text-color": "#C9D3E8", "text-opacity": 0.8 },
  });
  map.addLayer({
    id: "place-3d",
    type: "symbol",
    source: "ofm",
    "source-layer": "place",
    minzoom: 8,
    filter: ["match", ["get", "class"], ["city", "town", "suburb", "neighbourhood", "village", "quarter"], true, false],
    layout: {
      "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
      "text-font": textFont,
      "text-size": ["match", ["get", "class"], "city", 17, "town", 15, "suburb", 14, 12.5],
      "text-transform": "none",
      "text-max-width": 8,
      "text-pitch-alignment": "viewport",
      "text-rotation-alignment": "viewport",
    },
    paint: textPaint,
  });

  map.setTerrain({ source: "dem", exaggeration: TERRAIN_EXAGGERATION });
  map.setSky({
    "sky-color": "#0a1226",
    "horizon-color": "#22335f",
    "fog-color": "#0e1730",
    "sky-horizon-blend": 0.55,
    "horizon-fog-blend": 0.7,
    "fog-ground-blend": 0.5,
  });
  if (map.getLayer(LABELS_LAYER)) map.setLayoutProperty(LABELS_LAYER, "visibility", "none");

  // A low sun from the south west gives each building a lit side and a shaded side.
  map.setLight({ anchor: "map", color: "#dfe6ff", intensity: 0.5, position: [1.4, 215, 38] });

  map.setMaxPitch(75);
  map.dragRotate.enable();
  map.touchPitch.enable();
  map.touchZoomRotate.enableRotation();
}

/** Puts the map back as 2D left it: flat, north up, Esri labels, no terrain. Safe to call when 3D is not on. */
export function disable3D(map: MapLibreMap): void {
  if (!map.getStyle()) return;
  if (map.getTerrain()) map.setTerrain(null);
  map.setSky(undefined as never);
  for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of SOURCES) if (map.getSource(id)) map.removeSource(id);
  if (map.getLayer(LABELS_LAYER)) map.setLayoutProperty(LABELS_LAYER, "visibility", "visible");
  map.setLight({ anchor: "viewport", color: "#ffffff", intensity: 0.5, position: [1.15, 210, 30] });
  map.setMaxPitch(0);
  map.dragRotate.disable();
  map.touchPitch.disable();
  map.touchZoomRotate.disableRotation();
  if (map.getPitch() !== 0 || map.getBearing() !== 0) map.jumpTo({ pitch: 0, bearing: 0 });
  syncPadding(map, true);
}
