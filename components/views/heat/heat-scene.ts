/**
 * The regional heat replay: one coloured square per grid cell (about 55 km), recoloured as the days
 * pass, with the camera locked to the grid so nobody can pan past the data.
 */
import type { Marker } from "maplibre-gl";
import type { MapApi } from "@/components/map/map-context";
import { lerp, smooth } from "@/lib/ui/anim";
import { cameraPadding, enterCamera, isMobile, unlockCamera, type Camera } from "@/lib/ui/camera";
import { decorative, el } from "@/lib/ui/dom";
import { HEAT_STOPS } from "@/lib/ui/heat-colors";
import type { GridSummary } from "@/lib/ui/heat-model";
import { LABELS_LAYER } from "@/lib/ui/map-style";
import type { Coord, HeatGrid } from "@/lib/types";
import { CITIES, STATE_LABELS } from "./geography";

const HEAT_OPACITY = 0.45;

interface SceneOptions {
  grid: HeatGrid;
  summary: GridSummary;
  origin: Coord;
  reduced: boolean;
}

export class HeatScene {
  private markers: Marker[] = [];
  private cams: { region: Camera; peak: Camera } | null = null;
  private lastX = -1;
  private lastK = -1;
  private cancelCamera: (() => void) | null = null;
  private dead = false;
  private readonly onResize = () => {
    const lock = this.lock();
    this.api.map.setMinZoom(lock.minZoom);
    this.cams = this.makeCameras();
    this.api.map.fire("move");
  };

  constructor(
    private readonly api: MapApi,
    private readonly opts: SceneOptions,
  ) {}

  /** Lowest zoom at which the whole canvas is still inside the grid. */
  private minZoom(): number {
    const { map, gl } = this.api;
    const [[w, s], [e, n]] = this.opts.summary.region;
    const sw = gl.MercatorCoordinate.fromLngLat({ lng: w, lat: s });
    const ne = gl.MercatorCoordinate.fromLngLat({ lng: e, lat: n });
    const canvas = map.getCanvas();
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    return Math.log2(Math.max(width / (ne.x - sw.x), height / (sw.y - ne.y)) / 512) + 0.02;
  }

  private lock() {
    return { bounds: this.opts.summary.region, minZoom: this.minZoom(), maxZoom: 8.5 };
  }

  /**
   * Region view: the zoom where the grid just fills the screen, on the address, kept inside the grid's bounds. A grid is not always
   * centred on the address (Bellevue sits well west of its grid's middle), and then the grid's edge decides the view, never a stretch
   * of map beyond the data. If that leaves the house hidden (under the panel, the top bar or the dock) the view comes in a little.
   * Peak view: half a zoom closer, on the address.
   *
   * The map keeps its padding (the free part of the screen) from the rest camera, and MapLibre's bounds lock applies to that free
   * part only, so the cameras are worked out the same way: padded, then kept inside the lock.
   */
  private makeCameras(): { region: Camera; peak: Camera } {
    const { map, gl } = this.api;
    const padding = cameraPadding();
    const [[w, s], [e, n]] = this.opts.summary.region;
    const z0 = this.minZoom() + 0.26;
    const canvas = map.getCanvas();
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const [left, right, top, bottom] = [padding.left ?? 0, padding.right ?? 0, padding.top ?? 0, padding.bottom ?? 0];
    const [shiftX, shiftY] = [(left - right) / 2, (top - bottom) / 2];
    const freeW = width - left - right;
    const freeH = height - top - bottom;
    const merc = (lng: number, lat: number) => gl.MercatorCoordinate.fromLngLat({ lng, lat });
    const [sw, ne] = [merc(w, s), merc(e, n)];

    /** Where MapLibre will leave a camera: zoomed in until the free part is covered by the grid, its centre kept inside the grid. */
    const lockTo = (cam: Camera): Camera => {
      const cover = Math.log2(Math.max(freeW / ((ne.x - sw.x) * 512), freeH / ((sw.y - ne.y) * 512)));
      const zoom = Math.max(cam.zoom, cover);
      const world = 512 * 2 ** zoom;
      const [halfW, halfH] = [freeW / 2 / world, freeH / 2 / world];
      const clamp = (value: number, low: number, high: number) => (low > high ? (low + high) / 2 : Math.min(high, Math.max(low, value)));
      const c = merc(cam.center[0], cam.center[1]);
      const centre = new gl.MercatorCoordinate(clamp(c.x, sw.x + halfW, ne.x - halfW), clamp(c.y, ne.y + halfH, sw.y - halfH), 0).toLngLat();
      return { zoom, center: [centre.lng, centre.lat] };
    };
    // On a laptop the centre has always been moved once more by hand (by the same amount as the padding), so the house sits right of
    // the panel and under the pre-roll card, where the card's own "clear of the house" step expects it. On a phone that second move
    // would push the house off the top of the screen, so there the padding alone places it.
    const [byHandX, byHandY] = isMobile() ? [0, 0] : [shiftX, shiftY];
    const at = (lngLat: [number, number], zoom: number): Camera => {
      const world = 512 * 2 ** zoom;
      const mc = merc(lngLat[0], lngLat[1]);
      const centre = new gl.MercatorCoordinate(mc.x - byHandX / world, mc.y - byHandY / world, 0).toLngLat();
      return lockTo({ zoom, center: [centre.lng, centre.lat] });
    };

    const here: [number, number] = [this.opts.origin[1], this.opts.origin[0]];
    const inset = 36;
    const houseShows = (cam: Camera) => {
      const world = 512 * 2 ** cam.zoom;
      const a = merc(here[0], here[1]);
      const c = merc(cam.center[0], cam.center[1]);
      const x = width / 2 + shiftX + (a.x - c.x) * world;
      const y = height / 2 + shiftY + (a.y - c.y) * world;
      return x >= left + inset && x <= width - right - inset && y >= top + inset && y <= height - bottom - inset;
    };

    // Centred on the address, then kept inside the grid by the lock: for a grid that is not centred on the address (Bellevue) the grid's
    // edge, not the address, decides the view. If the lock leaves the house hidden, come in until it shows.
    let zoom = z0;
    let region = at(here, zoom);
    while (!houseShows(region) && zoom < z0 + 1.2) {
      zoom += 0.1;
      region = at(here, zoom);
    }
    return { region, peak: at(here, region.zoom + 0.5) };
  }

  enter(statesGeoJson: unknown): void {
    const { map, gl } = this.api;
    const { grid, summary, reduced } = this.opts;
    const half = grid.step / 2;

    const features = summary.cells.map((c) => ({
      type: "Feature" as const,
      id: c.id,
      properties: {},
      geometry: { type: "Polygon" as const, coordinates: [[[c.lon - half, c.lat - half], [c.lon + half, c.lat - half], [c.lon + half, c.lat + half], [c.lon - half, c.lat + half], [c.lon - half, c.lat - half]]] },
    }));
    const stops = HEAT_STOPS.flatMap((s) => [s[0], `rgb(${s[1]},${s[2]},${s[3]})`]);

    map.addSource("heat", { type: "geojson", data: { type: "FeatureCollection", features } });
    map.addLayer({ id: "heat-fill", type: "fill", source: "heat", paint: { "fill-color": ["interpolate", ["linear"], ["coalesce", ["feature-state", "t"], 80], ...stops] as never, "fill-opacity": HEAT_OPACITY, "fill-antialias": false } }, LABELS_LAYER);
    if (statesGeoJson) {
      map.addSource("states", { type: "geojson", data: statesGeoJson as never });
      map.addLayer({ id: "state-line", type: "line", source: "states", paint: { "line-color": "rgba(255,255,255,0.62)", "line-width": 1.2 } }, LABELS_LAYER);
    }
    map.addLayer({ id: "heat-line", type: "line", source: "heat", paint: { "line-color": "rgba(255,255,255,0.08)", "line-width": 0.6 } }, LABELS_LAYER);
    map.setLayoutProperty(LABELS_LAYER, "visibility", "none");

    this.markers = [
      ...STATE_LABELS.map(([name, lat, lon]) => new gl.Marker({ element: decorative(el("div", { className: "state", text: name })), anchor: "center" }).setLngLat([lon, lat]).addTo(map)),
      ...CITIES.map(([name, lat, lon, flag]) => {
        const cls = `city${flag === "nodot" ? " nodot cl bold" : flag === "cl" ? " cl" : ""}`;
        return new gl.Marker({ element: decorative(el("div", { className: cls }, [el("i"), el("span", { text: name })])), anchor: "center" }).setLngLat([lon, lat]).addTo(map);
      }),
    ];

    this.cams = this.makeCameras();
    this.cancelCamera = enterCamera(map, this.cams.region, this.lock(), reduced, 2200);
    this.lastK = 0;
    window.addEventListener("resize", this.onResize);
    this.draw(0);
  }

  destroy(): void {
    this.dead = true;
    const { map } = this.api;
    this.cancelCamera?.();
    window.removeEventListener("resize", this.onResize);
    this.markers.forEach((m) => m.remove());
    if (map.getStyle()) {
      map.setLayoutProperty(LABELS_LAYER, "visibility", "visible");
      for (const id of ["heat-line", "state-line", "heat-fill"]) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of ["states", "heat"]) if (map.getSource(id)) map.removeSource(id);
    }
    unlockCamera(map);
  }

  /** Recolours every square for fractional day `x` (0 = first day). */
  private draw(x: number): void {
    const { map } = this.api;
    if (this.dead || !map.getSource("heat") || Math.abs(x - this.lastX) < 1e-3) return;
    this.lastX = x;
    const last = this.opts.grid.days.length - 1;
    const d0 = Math.min(last, Math.max(0, Math.floor(x)));
    const d1 = Math.min(last, d0 + 1);
    const f = smooth(0, 1, x - d0);
    for (const cell of this.opts.summary.cells) map.setFeatureState({ source: "heat", id: cell.id }, { t: lerp(cell.values[d0], cell.values[d1], f) });
  }

  /** A gentle push-in on the address around the peak day, easing back out so the wave can be followed after. */
  update(p: number, peakDay: number): void {
    const { map } = this.api;
    const last = this.opts.grid.days.length - 1;
    const x = p * last;
    this.draw(x);
    if (!this.cams) return;
    const k = smooth(peakDay - 0.65, peakDay, x) * (1 - smooth(peakDay + 0.5, peakDay + 1.4, x));
    if (Math.abs(k - this.lastK) > 1e-3) {
      this.lastK = k;
      const a = this.cams.region;
      const b = this.cams.peak;
      map.jumpTo({ center: [lerp(a.center[0], b.center[0], k), lerp(a.center[1], b.center[1], k)], zoom: lerp(a.zoom, b.zoom, k) });
    }
  }
}
