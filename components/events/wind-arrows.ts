/**
 * The wind field as a carpet of small arrows: one every ~22 screen pixels on a lattice fixed to the map (so panning slides the arrows
 * with the ground instead of re-sampling them), each pointing where the wind blew, as long as it was strong and coloured by speed.
 * While the replay plays, every arrow glides a little way downwind and fades back, faster where the wind is faster.
 */
import { clamp } from "@/lib/ui/anim";
import { windAt, type EventModel } from "@/lib/ui/event-model";
import { WIND_BUCKETS, WIND_BUCKET_CSS, WIND_BUCKET_MPH, arrowLength, windBucket } from "@/lib/ui/wind-colors";

/** How the map sits on the canvas: no rotation or tilt, so Web Mercator maps to the screen by scale and offset. */
export interface ScreenFrame {
  width: number;
  height: number;
  /** World size in CSS pixels at this zoom (512 * 2^zoom). */
  world: number;
  /** The map centre in normalised Web Mercator, and where it is on the canvas. */
  cx: number;
  cy: number;
  px: number;
  py: number;
}

export const mercX = (lon: number) => (lon + 180) / 360;
export const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

export const toScreen = (f: ScreenFrame, lat: number, lon: number): [number, number] => [f.px + (mercX(lon) - f.cx) * f.world, f.py + (mercY(lat) - f.cy) * f.world];

/** A stable pseudo-random phase per lattice point, so neighbouring arrows do not glide in step. */
const phaseOf = (i: number, j: number) => {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const ALPHA_LEVELS = [0.35, 0.7, 1] as const;

export interface ArrowOptions {
  field: "speed" | "gust";
  /** Seconds of glide; null holds every arrow still (reduced motion, or paused). */
  flowSec: number | null;
  spacingPx: number;
}

export function drawWindArrows(ctx: CanvasRenderingContext2D, model: EventModel, hourF: number, f: ScreenFrame, opts: ArrowOptions): void {
  const [south, north, west, east] = model.pkg.box;
  // The lattice step is a power of two in Mercator units, so it only changes when the zoom crosses a doubling.
  const step = 2 ** Math.round(Math.log2(opts.spacingPx / f.world));
  const spacing = step * f.world;
  const viewX0 = f.cx + (0 - f.px) / f.world;
  const viewX1 = f.cx + (f.width - f.px) / f.world;
  const viewY0 = f.cy + (0 - f.py) / f.world;
  const viewY1 = f.cy + (f.height - f.py) / f.world;
  const i0 = Math.ceil(Math.max(viewX0, mercX(west)) / step);
  const i1 = Math.floor(Math.min(viewX1, mercX(east)) / step);
  const j0 = Math.ceil(Math.max(viewY0, mercY(north)) / step);
  const j1 = Math.floor(Math.min(viewY1, mercY(south)) / step);
  if (i1 < i0 || j1 < j0) return;

  const paths: Array<Path2D | undefined> = new Array(WIND_BUCKETS * ALPHA_LEVELS.length);
  for (let j = j0; j <= j1; j += 1) {
    const my = j * step;
    const lat = latOf(my);
    const y0 = f.py + (my - f.cy) * f.world;
    for (let i = i0; i <= i1; i += 1) {
      const mx = i * step;
      const sample = windAt(model, hourF, lat, mx * 360 - 180, opts.field);
      if (!sample) continue;
      const { speed, dx, dy } = sample;
      let x = f.px + (mx - f.cx) * f.world;
      let y = y0;
      let level = ALPHA_LEVELS.length - 1;
      if (opts.flowSec !== null) {
        const t = phaseOf(i, j) + opts.flowSec * (0.2 + speed / 70);
        const frac = t - Math.floor(t);
        const glide = (frac - 0.5) * spacing * 0.55;
        x += dx * glide;
        y += dy * glide;
        const fade = Math.min(frac, 1 - frac) / 0.14;
        level = fade >= 1 ? 2 : fade >= 0.5 ? 1 : 0;
      }
      const len = arrowLength(speed);
      const hx = x + (dx * len) / 2;
      const hy = y + (dy * len) / 2;
      const head = Math.min(5.5, 2 + len * 0.17);
      const key = windBucket(speed) * ALPHA_LEVELS.length + level;
      const path = (paths[key] ??= new Path2D());
      path.moveTo(x - (dx * len) / 2, y - (dy * len) / 2);
      path.lineTo(hx, hy);
      path.moveTo(hx - dx * head - dy * head * 0.62, hy - dy * head + dx * head * 0.62);
      path.lineTo(hx, hy);
      path.lineTo(hx - dx * head + dy * head * 0.62, hy - dy * head - dx * head * 0.62);
    }
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  paths.forEach((path, key) => {
    if (!path) return;
    const bucket = Math.floor(key / ALPHA_LEVELS.length);
    const mph = bucket * WIND_BUCKET_MPH;
    // Calm air is drawn faint so the strong winds carry the picture.
    const alpha = ALPHA_LEVELS[key % ALPHA_LEVELS.length] * (0.42 + 0.58 * clamp(mph / 45));
    const width = 1.1 + Math.min(mph, 130) / 65;
    ctx.strokeStyle = WIND_BUCKET_CSS[bucket];
    // Hurricane-force arrows glow: a wide faint stroke under the arrow (a canvas shadow blur costs far more).
    if (mph >= 74) {
      ctx.globalAlpha = alpha * 0.28;
      ctx.lineWidth = width + 5;
      ctx.stroke(path);
    }
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.stroke(path);
  });
  ctx.restore();
}
