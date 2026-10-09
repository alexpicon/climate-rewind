import type { GeoJSONSource } from "maplibre-gl";
import type { MapApi } from "@/components/map/map-context";
import { flashesAt, type LightningNight } from "@/lib/ui/lightning";

const SOURCE = "glm";
const GLOW = "glm-glow";
const CORE = "glm-core";

/**
 * Brightness on the map from the satellite's radiant energy (femtojoules, roughly 2 to 20,000): logarithmic, so a bright flash
 * reads bigger without a few giants hiding the rest.
 */
const SIZE: unknown = ["interpolate", ["linear"], ["ln", ["max", 1, ["get", "e"]]], 0, 2, 4, 4, 7, 7, 10, 11];

/**
 * The night's lightning on the storm replay: each flash bursts at the minute the satellite saw it and fades over a few minutes of
 * storm time. Drawn above the radar and labels; a circle per flash with a soft glow, never a full-screen flash. With reduced motion
 * the replay sits at its end, and every flash of the night is shown faintly and still, so the picture of where it struck remains.
 */
export class LightningLayer {
  private dead = false;

  constructor(
    private readonly api: MapApi,
    private readonly night: LightningNight,
    private readonly reduced: boolean,
  ) {}

  enter(): void {
    const { map } = this.api;
    map.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: GLOW,
      type: "circle",
      source: SOURCE,
      paint: {
        "circle-color": "#B9C6FF",
        "circle-radius": ["*", SIZE, 2.6] as never,
        "circle-blur": 1,
        "circle-opacity": ["*", 0.55, ["get", "f"]] as never,
      },
    });
    map.addLayer({
      id: CORE,
      type: "circle",
      source: SOURCE,
      paint: {
        "circle-color": "#FFFFFF",
        "circle-radius": SIZE as never,
        "circle-blur": 0.35,
        "circle-opacity": ["get", "f"] as never,
      },
    });
  }

  /** Draws the flashes for the replay's clock (UTC milliseconds). Hidden outside the radar replay (the correction step). */
  update(nowMs: number, visible: boolean): void {
    if (this.dead) return;
    const source = this.api.map.getSource(SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    const shown = !visible
      ? []
      : this.reduced
      ? this.night.flashes.map(([, lat, lon, e]) => ({ lat, lon, energy: e, fresh: 0.35 }))
      : flashesAt(this.night, nowMs);
    source.setData({
      type: "FeatureCollection",
      features: shown.map((flash) => ({
        type: "Feature",
        properties: { e: flash.energy, f: Number((flash.fresh * flash.fresh).toFixed(3)) },
        geometry: { type: "Point", coordinates: [flash.lon, flash.lat] },
      })),
    });
  }

  destroy(): void {
    this.dead = true;
    const { map } = this.api;
    if (!map.getStyle()) return;
    for (const id of [CORE, GLOW]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  }
}
