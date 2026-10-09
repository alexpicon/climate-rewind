"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "@/components/use-reduced-motion";
import type { Fit } from "@/lib/ui/albers";
import { buildEventModel, keyMomentP, stormAt, timeAt, hourAt, windAt, type EventModel, type EventPackage } from "@/lib/ui/event-model";
import { drawStateOutlines, fillStates, type StateShapes } from "@/lib/ui/state-outlines";
import { WIND_BUCKET_CSS, arrowLength, windBucket } from "@/lib/ui/wind-colors";
import { KIND_CSS } from "@/components/events/event-overlay";

const LOOP_MS = 12_000;
const SPACING = 13;
/** A report's ring lasts this much storm time. */
const FRESH_MS = 90 * 60_000;

/** A plain local projection (longitude shrunk by the cosine of the middle latitude), so arrows keep their true compass directions. */
function localFit(width: number, height: number, [south, north, west, east]: [number, number, number, number]): Fit & { inverse: (x: number, y: number) => [number, number] } {
  const k = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const scale = Math.min(width / ((east - west) * k), height / (north - south));
  const ox = (width - (east - west) * k * scale) / 2;
  const oy = (height - (north - south) * scale) / 2;
  return {
    scale,
    toScreen: (lat, lon) => [ox + (lon - west) * k * scale, oy + (north - lat) * scale],
    inverse: (x, y) => [north - (y - oy) / scale, west + (x - ox) / (k * scale)],
  };
}

function draw(ctx: CanvasRenderingContext2D, model: EventModel, shapes: StateShapes | null, width: number, height: number, p: number) {
  const fit = localFit(width, height, model.pkg.box);
  ctx.clearRect(0, 0, width, height);
  fillStates(ctx, fit, shapes, "#17213a", [20, 50]);
  drawStateOutlines(ctx, fit, shapes, "rgba(186,194,209,0.3)", [20, 50]);
  const ms = timeAt(model, p);
  const hourF = hourAt(model, ms);
  ctx.lineCap = "round";
  for (let y = SPACING / 2; y < height; y += SPACING) {
    for (let x = SPACING / 2; x < width; x += SPACING) {
      const [lat, lon] = fit.inverse(x, y);
      const w = windAt(model, hourF, lat, lon, "gust");
      if (!w) continue;
      const len = arrowLength(w.speed) * 0.5;
      const hx = x + (w.dx * len) / 2;
      const hy = y + (w.dy * len) / 2;
      ctx.strokeStyle = WIND_BUCKET_CSS[windBucket(w.speed)];
      ctx.globalAlpha = 0.45 + Math.min(0.55, w.speed / 90);
      ctx.lineWidth = 1 + Math.min(w.speed, 130) / 90;
      ctx.beginPath();
      ctx.moveTo(x - (w.dx * len) / 2, y - (w.dy * len) / 2);
      ctx.lineTo(hx, hy);
      ctx.lineTo(hx - w.dx * 3 - w.dy * 2, hy - w.dy * 3 + w.dx * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  // The storm reports in so far: a dot each, and a ring as it comes in.
  for (const r of model.reports) {
    if (r.ms > ms) break;
    const [x, y] = fit.toScreen(r.lat, r.lon);
    const radius = r.gustMph !== null ? 1.6 + r.gustMph / 45 : 1.6;
    ctx.fillStyle = KIND_CSS[r.kind];
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    const age = (ms - r.ms) / FRESH_MS;
    if (age < 1) {
      ctx.strokeStyle = KIND_CSS[r.kind];
      ctx.globalAlpha = 1 - age;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, radius + 2 + age * 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  const storm = stormAt(model, ms);
  if (model.track.length) {
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    model.track.forEach((t, i) => {
      const [x, y] = fit.toScreen(t.lat, t.lon);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (storm) {
    const [x, y] = fit.toScreen(storm.lat, storm.lon);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * A card's moving preview: the event's gusts as small arrows looping through its hours (and the hurricane moving along its track),
 * fetched once the card is near the screen. Reduced motion shows the key moment, still; the button pauses and plays it.
 */
export function EventPreview({ id }: { id: string }) {
  const reduced = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pkg, setPkg] = useState<EventPackage | null>(null);
  const [shapes, setShapes] = useState<StateShapes | null>(null);
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const model = useMemo(() => (pkg ? buildEventModel(pkg) : null), [pkg]);
  // Where the loop is, so a pause holds the picture on screen and play carries on from it.
  const pRef = useRef<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: "200px 0px" });
    io.observe(el);
    const ro = new ResizeObserver(() => setSize({ width: Math.round(el.clientWidth), height: Math.round(el.clientHeight) }));
    ro.observe(el);
    return () => {
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!visible || pkg) return;
    const controller = new AbortController();
    const get = <T,>(url: string) => fetch(url, { signal: controller.signal }).then((r) => (r.ok ? (r.json() as Promise<T>) : null));
    get<EventPackage>(`/data/events/${id}.json`).then((p) => p && setPkg(p)).catch(() => undefined);
    get<StateShapes>("/data/us-states.json").then((s) => s && setShapes(s)).catch(() => undefined);
    return () => controller.abort();
  }, [visible, pkg, id]);

  const still = reduced || paused;
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !model || !width || !height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (still || !visible) {
      draw(ctx, model, shapes, width, height, reduced ? keyMomentP(model) : (pRef.current ?? keyMomentP(model)));
      if (still) return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const p = ((pRef.current ?? 0) + (now - last) / LOOP_MS) % 1;
      last = now;
      pRef.current = p;
      draw(ctx, model, shapes, width, height, p);
    };
    if (visible) raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [model, shapes, width, height, still, visible, reduced]);

  const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
  return (
    <div className="ev-prev" ref={wrapRef}>
      <canvas ref={canvasRef} width={width * dpr} height={height * dpr} style={{ width, height }} aria-hidden="true" />
      {model && !reduced ? (
        <button type="button" className="ev-prev-pause" aria-pressed={paused} onClick={() => setPaused((v) => !v)}>
          {paused ? "Play preview" : "Pause preview"}
        </button>
      ) : null}
    </div>
  );
}
