/**
 * Draws one "Start here" card's moving map, on the right of the card behind its words: tornado tracks year by year then the card's
 * own; a storm night's lightning and flood reports; or a heat wave's grid warming day by day. The address is the pulsing dot.
 */
import { heatRgb } from "@/lib/ui/heat-colors";
import { cellValue, heatFrame, nightFrame, tornadoFrame, type HeatPreview, type NightPreview, type SamplePreview, type TornadoPreview } from "@/lib/ui/sample-preview";

interface Fit {
  toScreen: (lat: number, lon: number) => [number, number];
  scale: number;
}

/**
 * Covers the card's right-hand part with the preview's box (closer in by `zoom`), centred on the address (longitude shrunk by the cosine of the latitude so
 * shapes stay true). What falls outside the card is cut off.
 */
function fitRight(width: number, height: number, [south, north, west, east]: [number, number, number, number], [homeLat, homeLon]: [number, number], zoom = 1): Fit {
  const left = width * 0.38;
  const k = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const scale = zoom * Math.max((width - left) / ((east - west) * k), height / (north - south));
  const ox = left + (width - left) / 2 - (homeLon - west) * k * scale;
  const oy = height / 2 - (north - homeLat) * scale;
  return { scale, toScreen: (lat, lon) => [ox + (lon - west) * k * scale, oy + (north - lat) * scale] };
}

const EF_RGB: Record<number, string> = { [-1]: "190,196,210", 0: "159,211,255", 1: "255,224,102", 2: "255,169,77", 3: "255,77,77", 4: "255,45,138", 5: "214,77,255" };

function corner(ctx: CanvasRenderingContext2D, text: string, width: number) {
  ctx.font = "700 12px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.textAlign = "right";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(8,12,20,0.85)";
  ctx.textBaseline = "top";
  ctx.strokeText(text, width - 10, 10);
  ctx.fillStyle = "rgba(245,240,231,0.92)";
  ctx.fillText(text, width - 10, 10);
  ctx.textBaseline = "alphabetic";
}

function home(ctx: CanvasRenderingContext2D, fit: Fit, [lat, lon]: [number, number], pulse: number) {
  const [x, y] = fit.toScreen(lat, lon);
  ctx.strokeStyle = `rgba(255,180,90,${(1 - pulse).toFixed(3)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 4 + pulse * 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#FFB45A";
  ctx.strokeStyle = "#1C1204";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawTornadoes(ctx: CanvasRenderingContext2D, preview: TornadoPreview, fit: Fit, p: number, clock: number, width: number, height: number) {
  const frame = tornadoFrame(preview, p);
  ctx.lineCap = "round";
  preview.tracks.forEach(([, ef, lat0, lon0, lat1, lon1, own], i) => {
    const k = frame.drawn[i];
    if (k <= 0) return;
    const [x0, y0] = fit.toScreen(lat0, lon0);
    const [x1e, y1e] = fit.toScreen(lat1, lon1);
    const x1 = x0 + (x1e - x0) * k;
    const y1 = y0 + (y1e - y0) * k;
    const rgb = EF_RGB[ef] ?? EF_RGB[-1];
    const width = own ? 4 : 1.2 + Math.max(0, ef) * 0.6;
    ctx.strokeStyle = `rgba(${rgb},${own ? 0.35 : 0.18})`;
    ctx.lineWidth = width + 5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${rgb},${own ? 1 : 0.8})`;
    ctx.lineWidth = width;
    ctx.stroke();
    if (own && frame.focusDrawing) {
      // The funnel at the head of the card's tornado, turning.
      ctx.save();
      ctx.translate(x1, y1);
      ctx.rotate(clock * 9);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      for (const r of [5, 9, 13]) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 1.3);
        ctx.stroke();
      }
      ctx.restore();
    }
  });
  home(ctx, fit, preview.home, (clock * 0.8) % 1);
  const own = preview.tracks.find((t) => t[6]);
  corner(ctx, p > 0.66 && own ? `EF${own[1]} · ${own[0]}` : String(frame.year), width);
}

function drawNight(ctx: CanvasRenderingContext2D, preview: NightPreview, fit: Fit, p: number, clock: number, width: number, height: number) {
  const frame = nightFrame(preview, p);
  const span = (preview.endMs - preview.startMs) / 1000;
  // A flash glows for a short stretch of the loop, then leaves a faint mark.
  const glow = span * 0.03;
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < frame.flashesSeen; i += 1) {
    const [s, lat, lon] = preview.flashes[i];
    const [x, y] = fit.toScreen(lat, lon);
    const fresh = Math.max(0, 1 - (frame.seconds - s) / glow);
    if (fresh <= 0) {
      ctx.fillStyle = "rgba(185,198,255,0.13)";
      ctx.fillRect(x - 1, y - 1, 2, 2);
      continue;
    }
    const r = 2 + fresh * 6;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${(0.95 * fresh).toFixed(3)})`);
    g.addColorStop(0.4, `rgba(185,198,255,${(0.5 * fresh).toFixed(3)})`);
    g.addColorStop(1, "rgba(120,140,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = "source-over";
  for (let i = 0; i < frame.reportsSeen; i += 1) {
    const [s, lat, lon] = preview.reports[i];
    const [x, y] = fit.toScreen(lat, lon);
    const age = (frame.seconds - s) / (span * 0.08);
    if (age < 1) {
      ctx.strokeStyle = `rgba(95,227,216,${(1 - age).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 4 + age * 16, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "#5FE3D8";
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  home(ctx, fit, preview.home, (clock * 0.8) % 1);
  corner(ctx, frame.clock, width);
}

function drawHeat(ctx: CanvasRenderingContext2D, preview: HeatPreview, fit: Fit, p: number, clock: number, width: number, height: number) {
  const frame = heatFrame(preview, p);
  const half = preview.step / 2;
  for (const [lat, lon, values] of preview.cells) {
    const [x0, y0] = fit.toScreen(lat + half, lon - half);
    const [x1, y1] = fit.toScreen(lat - half, lon + half);
    const [r, g, b] = heatRgb(cellValue(values, frame.dayF));
    ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},0.78)`;
    ctx.fillRect(x0, y0, x1 - x0 + 0.5, y1 - y0 + 0.5);
  }
  home(ctx, fit, preview.home, (clock * 0.8) % 1);
  corner(ctx, `${frame.label} · ${Math.round(frame.addressF)}°F`, width);
}

/** One frame. `clock` (seconds) only turns the funnel and pulses the address; it stops when the preview is still. */
export function drawPreview(ctx: CanvasRenderingContext2D, preview: SamplePreview, width: number, height: number, p: number, clock: number): void {
  ctx.clearRect(0, 0, width, height);
  // The heat grid spans a whole region; closer in, its cells fill the card around the address.
  const fit = fitRight(width, height, preview.box, preview.home, preview.kind === "heat" ? 2.2 : 1);
  if (preview.kind === "tornadoes") drawTornadoes(ctx, preview, fit, p, clock, width, height);
  else if (preview.kind === "night") drawNight(ctx, preview, fit, p, clock, width, height);
  else drawHeat(ctx, preview, fit, p, clock, width, height);
}
