/** US state outlines (public/data/us-states.json) drawn on a 2D canvas through an Albers fit. Client-safe. */
import type { Fit } from "./albers";

type Ring = Array<[number, number]>;
export interface StateShapes {
  features: Array<{ geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] } }>;
}

/** Adds every state's rings to the current path; rings whose first point is outside `latRange` (Alaska, Hawaii on a lower-48 map) are skipped. */
function traceStates(ctx: CanvasRenderingContext2D, fit: Fit, shapes: StateShapes, latRange: [number, number]): void {
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
}

/** Strokes every state's outline. */
export function drawStateOutlines(ctx: CanvasRenderingContext2D, fit: Fit, shapes: StateShapes | null, style = "rgba(186,194,209,0.16)", latRange: [number, number] = [24, 50]): void {
  if (!shapes) return;
  traceStates(ctx, fit, shapes, latRange);
  ctx.strokeStyle = style;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Fills the land: every state's area, so the coastline shows against the water. */
export function fillStates(ctx: CanvasRenderingContext2D, fit: Fit, shapes: StateShapes | null, fill: string, latRange: [number, number] = [24, 50]): void {
  if (!shapes) return;
  traceStates(ctx, fit, shapes, latRange);
  ctx.fillStyle = fill;
  ctx.fill("evenodd");
}
