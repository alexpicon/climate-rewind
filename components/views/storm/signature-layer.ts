import type { GeoJSONSource } from "maplibre-gl";
import type { MapApi } from "@/components/map/map-context";
import type { RadarSignatures } from "@/lib/radar-signatures";
import { signaturesAt } from "@/lib/ui/signatures";

const SOURCE = "sig";
const HAIL = "sig-hail";
const VORTEX = "sig-vortex";
const VORTEX_CORE = "sig-vortex-core";

/**
 * The radar's own flags on the storm replay: an ice-blue disc for each hail detection (bigger for bigger estimated hail) and a red
 * ring for each tornado vortex signature, each appearing at its scan and fading over SIGNATURE_FADE_MS of storm time. With reduced
 * motion every flag of the night is shown faintly and still.
 */
export class SignatureLayer {
  private dead = false;

  constructor(
    private readonly api: MapApi,
    private readonly signatures: RadarSignatures,
    private readonly reduced: boolean,
  ) {}

  enter(): void {
    const { map } = this.api;
    map.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: HAIL,
      type: "circle",
      source: SOURCE,
      filter: ["==", ["get", "k"], "hail"],
      paint: {
        "circle-color": "#9FE7FF",
        "circle-radius": ["interpolate", ["linear"], ["get", "s"], 0, 3, 1, 5, 2, 8, 4, 12] as never,
        "circle-opacity": ["*", 0.75, ["get", "f"]] as never,
        "circle-stroke-color": "#FFFFFF",
        "circle-stroke-width": 1,
        "circle-stroke-opacity": ["get", "f"] as never,
      },
    });
    map.addLayer({
      id: VORTEX,
      type: "circle",
      source: SOURCE,
      filter: ["==", ["get", "k"], "tvs"],
      paint: {
        "circle-color": "rgba(0,0,0,0)",
        "circle-radius": ["interpolate", ["linear"], ["get", "s"], 20, 8, 60, 13, 120, 18] as never,
        "circle-stroke-color": "#FF5A6E",
        "circle-stroke-width": 2.5,
        "circle-stroke-opacity": ["get", "f"] as never,
      },
    });
    map.addLayer({
      id: VORTEX_CORE,
      type: "circle",
      source: SOURCE,
      filter: ["==", ["get", "k"], "tvs"],
      paint: { "circle-color": "#FF5A6E", "circle-radius": 2.5, "circle-opacity": ["get", "f"] as never },
    });
  }

  /** Draws the flags for the replay's clock (UTC milliseconds). Hidden outside the radar replay. */
  update(nowMs: number, visible: boolean): void {
    if (this.dead) return;
    const source = this.api.map.getSource(SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    const shown = !visible
      ? { hail: [], vortex: [] }
      : this.reduced
        ? { hail: this.signatures.hail.map((item) => ({ item, fresh: 0.4 })), vortex: this.signatures.vortex.map((item) => ({ item, fresh: 0.4 })) }
        : signaturesAt(this.signatures, nowMs);
    const point = (lat: number, lon: number) => ({ type: "Point" as const, coordinates: [lon, lat] });
    source.setData({
      type: "FeatureCollection",
      features: [
        ...shown.hail.map(({ item, fresh }) => ({ type: "Feature" as const, properties: { k: "hail", s: item.maxIn, f: Number(fresh.toFixed(3)) }, geometry: point(item.lat, item.lon) })),
        ...shown.vortex.map(({ item, fresh }) => ({ type: "Feature" as const, properties: { k: "tvs", s: item.shear, f: Number(fresh.toFixed(3)) }, geometry: point(item.lat, item.lon) })),
      ],
    });
  }

  destroy(): void {
    this.dead = true;
    const { map } = this.api;
    if (!map.getStyle()) return;
    for (const id of [VORTEX_CORE, VORTEX, HAIL]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  }
}
