/**
 * Everything over the wind arrows in an event replay: the hurricane's best track and where it is now, how far its 34, 50 and 64 knot
 * winds reached in each quadrant, each landfall as it happens, and the storm reports popping in where and when they were filed.
 */
import { formatAtOffset } from "@/lib/ui/text";
import { KT_TO_MPH, NM_TO_M, categoryOf, type EventFrame, type EventModel, type ReportKind } from "@/lib/ui/event-model";
import { windRgb } from "@/lib/ui/wind-colors";
import { toScreen, type ScreenFrame } from "./wind-arrows";

const MINUTE = 60_000;
/** A report's ring expands and fades over this much storm time. */
const FRESH_MS = 50 * MINUTE;
/** A strong gust or a tornado keeps its label this long. */
const LABEL_MS = 4 * 60 * MINUTE;
const MAX_LABELS = 9;

export const KIND_CSS: Record<ReportKind, string> = {
  gust: "#ffffff",
  wind: "#ffb35c",
  tornado: "#ff3b6b",
  flood: "#4da3ff",
  surge: "#22d3ee",
  hail: "#a3e635",
  other: "#c4c9d4",
};

const rgba = ([r, g, b]: [number, number, number], a: number) => `rgba(${r},${g},${b},${a})`;

const LABEL_FONT = (size: number) => `700 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = "#fff", size = 12) {
  ctx.font = LABEL_FONT(size);
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = "rgba(8,12,20,0.85)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Metres per CSS pixel at a latitude. */
const metresPerPx = (f: ScreenFrame, lat: number) => (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / f.world;

function radiiPath(cx: number, cy: number, radiiNm: number[], mpp: number): Path2D | null {
  if (radiiNm.every((r) => r <= 0)) return null;
  const path = new Path2D();
  path.moveTo(cx, cy);
  radiiNm.forEach((nm, q) => {
    // Quadrants NE, SE, SW, NW by compass bearing; the canvas measures angles from east, clockwise.
    const a0 = ((q * 90 - 90) * Math.PI) / 180;
    const a1 = (((q + 1) * 90 - 90) * Math.PI) / 180;
    if (nm <= 0) path.lineTo(cx, cy);
    else path.arc(cx, cy, (nm * NM_TO_M) / mpp, a0, a1);
  });
  path.closePath();
  return path;
}

const RADII: Array<{ key: "r34" | "r50" | "r64"; rgb: [number, number, number]; fill: number }> = [
  { key: "r34", rgb: [242, 224, 90], fill: 0.08 },
  { key: "r50", rgb: [255, 159, 64], fill: 0.11 },
  { key: "r64", rgb: [255, 77, 77], fill: 0.16 },
];

export function drawTrack(ctx: CanvasRenderingContext2D, model: EventModel, frame: EventFrame, f: ScreenFrame, spinSec: number, offsetMin: number): void {
  const track = model.track;
  if (track.length < 2) return;
  const pts = track.map((t) => toScreen(f, t.lat, t.lon));
  ctx.save();
  ctx.setLineDash([5, 6]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.setLineDash([]);

  const storm = frame.storm;
  if (storm) {
    const [sx, sy] = toScreen(f, storm.lat, storm.lon);
    // The path so far, solid.
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    let started = false;
    track.forEach((t, i) => {
      if (t.ms > frame.ms) return;
      if (started) ctx.lineTo(pts[i][0], pts[i][1]);
      else ctx.moveTo(pts[i][0], pts[i][1]);
      started = true;
    });
    if (started) ctx.lineTo(sx, sy);
    ctx.stroke();

    const mpp = metresPerPx(f, storm.lat);
    for (const { key, rgb, fill } of RADII) {
      const path = radiiPath(sx, sy, storm[key], mpp);
      if (!path) continue;
      ctx.fillStyle = rgba(rgb, fill);
      ctx.strokeStyle = rgba(rgb, 0.75);
      ctx.lineWidth = 1.4;
      ctx.fill(path);
      ctx.stroke(path);
    }
    drawEye(ctx, sx, sy, spinSec, storm.fix.windKt);
    const mph = Math.round((storm.fix.windKt * KT_TO_MPH) / 5) * 5;
    ctx.textAlign = "left";
    label(ctx, `${categoryOf(storm.fix.windKt, storm.fix.status)} · ${mph} mph · ${storm.fix.pressureMb} mb`, sx + 24, sy - 14, "#fff", 13);
  }
  // Each fix along the track, coloured by its wind.
  track.forEach((t, i) => {
    ctx.fillStyle = rgba(windRgb(t.windKt * KT_TO_MPH), t.ms <= frame.ms ? 1 : 0.45);
    ctx.beginPath();
    ctx.arc(pts[i][0], pts[i][1], 3.2, 0, Math.PI * 2);
    ctx.fill();
  });
  drawLandfalls(ctx, frame, f, offsetMin);
  ctx.restore();
}

/** The hurricane symbol, turning counterclockwise as storms do in the northern hemisphere. */
function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, spinSec: number, windKt: number) {
  const size = windKt >= 64 ? 15 : 11;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 2.6);
  glow.addColorStop(0, "rgba(255,255,255,0.55)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x - size * 3, y - size * 3, size * 6, size * 6);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-spinSec * 1.8);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const turn of [0, Math.PI]) {
    ctx.beginPath();
    ctx.moveTo(Math.cos(turn) * 5, Math.sin(turn) * 5);
    ctx.quadraticCurveTo(Math.cos(turn + 0.9) * size * 1.1, Math.sin(turn + 0.9) * size * 1.1, Math.cos(turn + 2) * size, Math.sin(turn + 2) * size);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawLandfalls(ctx: CanvasRenderingContext2D, frame: EventFrame, f: ScreenFrame, offsetMin: number) {
  frame.landfalls.forEach((lf, i) => {
    const [x, y] = toScreen(f, lf.lat, lf.lon);
    const age = frame.ms - lf.ms;
    if (age < 2 * 60 * MINUTE) {
      const k = age / (2 * 60 * MINUTE);
      ctx.strokeStyle = `rgba(255,255,255,${(1 - k).toFixed(3)})`;
      ctx.lineWidth = 3 * (1 - k) + 1;
      for (const lag of [0, 0.25]) {
        const r = 8 + Math.max(0, k - lag) * 90;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x, y + 6);
    ctx.lineTo(x - 6, y);
    ctx.closePath();
    ctx.fill();
    // Only the latest landfall is named; the earlier ones keep their marker.
    if (i === frame.landfalls.length - 1) {
      ctx.textAlign = "right";
      label(ctx, `Landfall ${formatAtOffset(lf.ms, offsetMin, { hour: "numeric", minute: "2-digit" })}`, x - 10, y + 18);
    }
  });
}

export function drawReports(ctx: CanvasRenderingContext2D, model: EventModel, frame: EventFrame, f: ScreenFrame, fresh: boolean): void {
  ctx.save();
  const dots = new Map<ReportKind, Path2D>();
  const labels: Array<{ text: string; x: number; y: number; color: string; rank: number }> = [];
  for (let i = frame.seen - 1; i >= 0; i -= 1) {
    const r = model.reports[i];
    const [x, y] = toScreen(f, r.lat, r.lon);
    if (x < -40 || y < -40 || x > f.width + 40 || y > f.height + 40) continue;
    const age = frame.ms - r.ms;
    const radius = r.gustMph !== null ? 2.6 + r.gustMph / 32 : r.kind === "tornado" ? 4 : 2.6;
    const path = dots.get(r.kind) ?? new Path2D();
    path.moveTo(x + radius, y);
    path.arc(x, y, radius, 0, Math.PI * 2);
    dots.set(r.kind, path);
    if (fresh && age < FRESH_MS) {
      const k = age / FRESH_MS;
      ctx.strokeStyle = KIND_CSS[r.kind];
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, radius + 3 + k * (r.gustMph !== null && r.gustMph >= 74 ? 40 : 22), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const isTop = frame.topGust === r;
    if (isTop || age < LABEL_MS) {
      if (r.gustMph !== null && (r.gustMph >= 58 || isTop)) {
        labels.push({ text: `${r.gustMph} mph${r.measured ? "" : " est."}`, x: x + radius + 5, y: y + 4, color: isTop ? "#ffe680" : "#fff", rank: isTop ? 1e9 : r.gustMph });
      } else if (r.kind === "tornado" && age < LABEL_MS / 2) {
        labels.push({ text: "Tornado", x: x + radius + 5, y: y + 4, color: "#ff8fa8", rank: 50 });
      }
    }
  }
  for (const [kind, path] of dots) {
    ctx.fillStyle = KIND_CSS[kind];
    ctx.strokeStyle = "rgba(8,12,20,0.8)";
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.92;
    ctx.fill(path);
    ctx.stroke(path);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
  ctx.font = LABEL_FONT(12);
  // The highest gust so far first, then the strongest; a label that would overlap one already placed is left out.
  const placed: Array<[number, number, number, number]> = [];
  for (const l of labels.sort((a, b) => b.rank - a.rank)) {
    if (placed.length >= MAX_LABELS) break;
    const box: [number, number, number, number] = [l.x - 2, l.y - 12, l.x + ctx.measureText(l.text).width + 2, l.y + 4];
    if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    placed.push(box);
    label(ctx, l.text, l.x, l.y, l.color);
  }
  ctx.restore();
}
