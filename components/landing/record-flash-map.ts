import { fitBox, fitLower48, type Fit } from "@/lib/ui/albers";
import { drawStateOutlines, fillStates, type StateShapes } from "@/lib/ui/state-outlines";

/** The map frame of the record replay: the Gulf coast the flash crossed. */
export const RECORD_VIEW = { south: 26.4, north: 32.4, west: -98.0, east: -86.8 };

/** Cities along the flash's path, for bearings (their usual coordinates, to about 1 km). `anchor` ones stay on a narrow map. */
const CITIES: Array<[string, number, number, boolean]> = [
  ["Corpus Christi", 27.8006, -97.3964, true],
  ["Houston", 29.7604, -95.3698, true],
  ["Beaumont", 30.0802, -94.1266, false],
  ["Lake Charles", 30.2266, -93.2174, false],
  ["Baton Rouge", 30.4515, -91.1871, false],
  ["New Orleans", 29.9511, -90.0715, true],
  ["Gulfport", 30.3674, -89.0928, false],
];
/** Below this width the in-between cities' names would run into each other. */
const NARROW = 560;
const STATES: Array<[string, number, number]> = [
  ["TEXAS", 31.3, -96.6],
  ["LOUISIANA", 31.35, -92.4],
  ["MISSISSIPPI", 32.05, -89.75],
];

/** Land, state lines and state and city names, under the light. The water is left unlabelled: the coastline shows it. */
export function drawRecordMap(ctx: CanvasRenderingContext2D, fit: Fit, shapes: StateShapes | null, width: number): void {
  fillStates(ctx, fit, shapes, "#1B2742", [20, 50]);
  drawStateOutlines(ctx, fit, shapes, "rgba(186,194,209,0.42)", [20, 50]);
  ctx.textBaseline = "middle";
  ctx.font = "600 11px Inter, system-ui, sans-serif";
  ctx.fillStyle = "rgba(186,194,209,0.5)";
  for (const [name, lat, lon] of STATES) {
    const [x, y] = fit.toScreen(lat, lon);
    // Letter-spaced with hair spaces, centred on the spaced width.
    const spaced = name.split("").join(String.fromCharCode(8202));
    ctx.fillText(spaced, x - ctx.measureText(spaced).width / 2, y);
  }
  ctx.font = "500 12px Inter, system-ui, sans-serif";
  for (const [name, lat, lon, anchor] of CITIES) {
    if (width < NARROW && !anchor) continue;
    const [x, y] = fit.toScreen(lat, lon);
    ctx.fillStyle = "rgba(245,240,231,0.85)";
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(245,240,231,0.72)";
    ctx.fillText(name, x + 6, y);
  }
}

/** A small lower-48 map in a corner with the replay's region boxed, so the place is clear at a glance. */
export function drawLocator(ctx: CanvasRenderingContext2D, shapes: StateShapes | null, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.fillStyle = "rgba(6,10,19,0.78)";
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.translate(x, y);
  const fit = fitLower48(w, h, 0.06, 0.5);
  fillStates(ctx, fit, shapes, "rgba(60,74,104,0.9)");
  drawStateOutlines(ctx, fit, shapes, "rgba(186,194,209,0.25)");
  const corners = [fit.toScreen(RECORD_VIEW.north, RECORD_VIEW.west), fit.toScreen(RECORD_VIEW.south, RECORD_VIEW.east)];
  ctx.strokeStyle = "#FFB45A";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(corners[0][0], corners[0][1], corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]);
  ctx.restore();
}

/** The fit of the replay's frame for a canvas of this size. */
export function recordFit(width: number, height: number): Fit {
  return fitBox(width, height, RECORD_VIEW, 10);
}
