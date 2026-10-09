import type { GeoJSONSource } from "maplibre-gl";
import type { MapApi } from "@/components/map/map-context";
import type { VortexSignature } from "@/lib/radar-signatures";

const SOURCE = "tor-flags";
const RING = "tor-flags-ring";
const CORE = "tor-flags-core";

/** The radar's rotation flags on the tornado replay: a red ring per tornado vortex signature, as lib/ui/tornado-signatures says. */
export class TornadoFlagsLayer {
  private dead = false;

  constructor(private readonly api: MapApi) {}

  enter(): void {
    const { map } = this.api;
    map.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: RING,
      type: "circle",
      source: SOURCE,
      paint: {
        "circle-color": "rgba(0,0,0,0)",
        "circle-radius": ["interpolate", ["linear"], ["get", "s"], 20, 8, 60, 13, 120, 18] as never,
        "circle-stroke-color": "#FF5A6E",
        "circle-stroke-width": 2.5,
        "circle-stroke-opacity": ["get", "f"] as never,
      },
    });
    map.addLayer({ id: CORE, type: "circle", source: SOURCE, paint: { "circle-color": "#FF5A6E", "circle-radius": 2.5, "circle-opacity": ["get", "f"] as never } });
  }

  update(flags: ReadonlyArray<{ flag: VortexSignature; fresh: number }>): void {
    if (this.dead) return;
    const source = this.api.map.getSource(SOURCE) as GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: flags.map(({ flag, fresh }) => ({
        type: "Feature" as const,
        properties: { s: flag.shear, f: Number(fresh.toFixed(3)) },
        geometry: { type: "Point" as const, coordinates: [flag.lon, flag.lat] },
      })),
    });
  }

  destroy(): void {
    this.dead = true;
    const { map } = this.api;
    if (!map.getStyle()) return;
    for (const id of [CORE, RING]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  }
}
