/** US state outlines (public/data/us-states.json) drawn on a 2D canvas through an Albers fit. Client-safe. */
import type { Fit } from "./albers";

type Ring = Array<[number, number]>;
export interface StateShapes {
  features: Array<{ geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] } }>;
}

/** Strokes every state's outline; rings whose first point is outside `latRange` (Alaska, Hawaii on a lower-48 map) are skipped. */
export function drawStateOutlines(ctx: CanvasRenderingContext2D, fit: Fit, shapes: StateShapes | null, style = "rgba(186,194,209,0.16)", latRange: [number, number] = [24, 50]): void {
  if (!shapes) return;
  ctx.beginPath();
  for (const feature of shapes.features) {
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        if (ring[0][1] > latRange[1] || ring[0][1] < latRange[0]) continue;
        ring.forEach(([lon, lat], i) => {
          const [x, y] = fit.toScreen(lat, lon);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
      }
    }
  }
  ctx.strokeStyle = style;
  ctx.lineWidth = 1;
  ctx.stroke();
}
