import type { GeoJSONSource } from "maplibre-gl";
import type { MapApi } from "@/components/map/map-context";
import type { AreaReplay } from "@/lib/area-replay";
import type { LitArea } from "@/lib/ui/area-replay-model";
import { FAMILIES } from "@/lib/ui/story-model";

const SOURCE = "area-replay";
const FILL = "area-replay-fill";
const GLOW = "area-replay-glow";
const EDGE = "area-replay-edge";

/**
 * The area replay on the story map: each lit area's zone outlines flare in its hazard family's colour, as strong as it is lit. The fill
 * stays light (a county's zones can cover the whole screen, and a solid fill hid the map), lighter still for a county-wide event; the
 * edge carries the flash.
 */
export class AreaReplayLayer {
  private dead = false;

  constructor(
    private readonly api: MapApi,
    private readonly replay: AreaReplay,
  ) {}

  enter(): void {
    const { map } = this.api;
    map.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: FILL, type: "fill", source: SOURCE, paint: { "fill-color": ["get", "c"] as never, "fill-opacity": ["*", ["case", ["==", ["get", "k"], "C"], 0.16, 0.32], ["get", "s"]] as never } });
    map.addLayer({ id: GLOW, type: "line", source: SOURCE, paint: { "line-color": ["get", "c"] as never, "line-width": 9, "line-blur": 7, "line-opacity": ["*", 0.7, ["get", "s"]] as never } });
    map.addLayer({ id: EDGE, type: "line", source: SOURCE, paint: { "line-color": ["get", "c"] as never, "line-width": 2, "line-opacity": ["get", "s"] as never } });
  }

  update(lit: readonly LitArea[]): void {
    if (this.dead) return;
    const source = this.api.map.getSource(SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    // An area may light several outlines (a county lights its zones); a zone lit twice keeps the stronger.
    const byShape = new Map<string, LitArea>();
    for (const entry of lit) {
      for (const code of this.replay.areas[entry.area]?.shapes ?? []) {
        const known = byShape.get(code);
        if (!known || known.strength < entry.strength) byShape.set(code, entry);
      }
    }
    source.setData({
      type: "FeatureCollection",
      features: [...byShape.entries()]
        .filter(([code]) => this.replay.shapes[code])
        .map(([code, entry]) => ({
          type: "Feature" as const,
          properties: { c: FAMILIES[entry.family].color, s: Number(entry.strength.toFixed(3)), k: this.replay.areas[entry.area]?.kind ?? "Z" },
          geometry: { type: "MultiPolygon" as const, coordinates: this.replay.shapes[code] },
        })),
    });
  }

  destroy(): void {
    this.dead = true;
    const { map } = this.api;
    if (!map.getStyle()) return;
    for (const id of [EDGE, GLOW, FILL]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  }
}
