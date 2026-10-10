"use client";

import { useMemo } from "react";
import { boxAround, kmToDegrees, squareAround, useFitOnArea, useGeoOverlay, useMapLabel, type Features, type OverlayLayer } from "@/components/map/use-map-overlay";
import { MapCaption } from "@/components/map/MapCaption";

/** What the climate models see at a time: about 25 km (CAVEAT in lib/climate/projection.ts says the same). */
export const MODEL_CELL_KM = 25;

const LAYERS: readonly OverlayLayer[] = [
  { id: "fx-cell-fill", type: "fill", paint: { "fill-color": "#7FD1FF", "fill-opacity": 0.06 } },
  { id: "fx-cell-line", type: "line", paint: { "line-color": "#7FD1FF", "line-width": 2, "line-dasharray": [3, 2.5], "line-opacity": 0.9 } },
];

/**
 * The map under "What's changing": a light, framed regional view. The dashed square is about the size of what a climate model sees at once
 * (about 25 km), centred on the address. It is a size cue, not the model's own cell edges: the numbers describe this wider area, not the street.
 */
export function FutureMap({ lat, lon, matched }: { lat: number; lon: number; matched: string }) {
  const cell = useMemo<Features>(
    () => ({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [squareAround(lat, lon, MODEL_CELL_KM)] } }] }),
    [lat, lon],
  );
  useGeoOverlay("future-cell", cell, LAYERS);
  const [dLat] = kmToDegrees(MODEL_CELL_KM / 2, lat);
  useMapLabel(lon, lat - dLat, `Rough size of a climate-model cell`, "top");
  const box = useMemo(() => boxAround(lat, lon, kmToDegrees(MODEL_CELL_KM * 0.85, lat)[0], kmToDegrees(MODEL_CELL_KM * 0.85, lat)[1]), [lat, lon]);
  useFitOnArea(lat, lon, 8, box, 10);

  return (
    <MapCaption
      title="The area these numbers describe"
      summary={`The dashed square (about ${MODEL_CELL_KM} km across) shows the rough size of a climate-model grid cell, centred on ${matched.split(",")[0].toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Ne|Nw|Se|Sw)\b/g, (d) => d.toUpperCase())}. The numbers describe this wider area, not one street.`}
      keys={
        <ul className="mapcap-keys" aria-label="Key">
          <li style={{ "--c": "#7FD1FF" } as React.CSSProperties}>
            <i className="ring" /> Rough size of one climate-model cell
          </li>
        </ul>
      }
      source="Open-Meteo Climate API (CMIP6 HighResMIP: climate-model grids of about 20–50 km, downscaled by Open-Meteo to about 10 km). The square is a size cue centred on your address, not the models’ own cell edges."
    />
  );
}
