import type { StyleSpecification } from "maplibre-gl";

/**
 * Esri's keyless "World Dark Gray" canvas plus its reference labels (CARTO's dark tiles
 * now return an API-key watermark). To swap providers, change these two URLs and the attribution.
 */
const BASE_TILES = ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"];
const LABEL_TILES = ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"];
const ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const WORLD = {
  type: "Feature" as const,
  properties: {},
  geometry: { type: "Polygon" as const, coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] },
};

/** Layer id that map overlays are inserted below, so place labels stay on top. */
export const LABELS_LAYER = "labels";

export function baseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      base: { type: "raster", tiles: BASE_TILES, tileSize: 256, maxzoom: 15, attribution: ATTRIBUTION },
      // Read at the tiles' own 256 px: the place names stay sharp (at 384 px they were 1.5 times larger but blurry).
      labels: { type: "raster", tiles: LABEL_TILES, tileSize: 256, maxzoom: 14 },
      tint: { type: "geojson", data: WORLD },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0a0f1a" } },
      // The basemap is lifted a little (brightness 0.88, tint 0.22) so streets, rivers and lakes still read through the radar and heat overlays.
      { id: "base", type: "raster", source: "base", paint: { "raster-fade-duration": 0, "raster-brightness-max": 0.88, "raster-contrast": 0.12 } },
      { id: "tint", type: "fill", source: "tint", paint: { "fill-color": "#0B1838", "fill-opacity": 0.22 } },
      { id: LABELS_LAYER, type: "raster", source: "labels", paint: { "raster-fade-duration": 0, "raster-opacity": 1, "raster-brightness-min": 0.5, "raster-contrast": 0.25 } },
    ],
  };
}

/** Live NEXRAD composite, refreshed by the `m` query value about every five minutes. */
export const liveRadarTiles = () => [
  `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png?m=${Math.floor(Date.now() / 300_000)}`,
];

const WMS = "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi";
const EARTH_RADIUS_M = 6378137;
/** The longest side of a radar frame image. The composite is 1 km per pixel, so this is already finer than the data. */
const RADAR_IMAGE_PX = 384;

const mercX = (lon: number) => (EARTH_RADIUS_M * lon * Math.PI) / 180;
const mercY = (lat: number) => EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** Where one radar frame image goes on the map: its four corners as [lon, lat], clockwise from the top left. */
export function radarCorners(bounds: [number, number, number, number]): [[number, number], [number, number], [number, number], [number, number]] {
  const [west, south, east, north] = bounds;
  return [[west, north], [east, north], [east, south], [west, south]];
}

/**
 * One archived NEXRAD frame as a single image: IEM's time-enabled WMS, Web Mercator, transparent 8-bit PNG
 * (about 45 KB). Replaces ~590 tile requests per replay with one request per frame.
 * `iso` is the frame time in UTC, like 2021-03-28T04:00:00Z.
 */
export function radarFrameUrl(bounds: [number, number, number, number], iso: string): string {
  const [west, south, east, north] = bounds;
  const x0 = mercX(west);
  const x1 = mercX(east);
  const y0 = mercY(south);
  const y1 = mercY(north);
  const aspect = (y1 - y0) / (x1 - x0);
  const width = aspect <= 1 ? RADAR_IMAGE_PX : Math.round(RADAR_IMAGE_PX / aspect);
  const height = aspect <= 1 ? Math.round(RADAR_IMAGE_PX * aspect) : RADAR_IMAGE_PX;
  const query = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: "nexrad-n0q-wmst",
    STYLES: "",
    SRS: "EPSG:3857",
    BBOX: [x0, y0, x1, y1].map((n) => n.toFixed(0)).join(","),
    WIDTH: String(width),
    HEIGHT: String(height),
    FORMAT: "image/png; mode=8bit",
    TRANSPARENT: "TRUE",
    TIME: iso,
  });
  return `${WMS}?${query.toString().replace(/\+/g, "%20")}`;
}
