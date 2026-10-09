"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/components/use-reduced-motion";
import { LOOP_MS, restingP, type SamplePreview } from "@/lib/ui/sample-preview";
import { drawPreview } from "./sample-preview-draw";

/**
 * The moving map behind one "Start here" card, looping while the card is on screen. Reduced motion, or the section's pause button,
 * holds it still (on everything drawn, or the hottest day). Decorative: the card's own words say what it shows.
 */
export function SampleBackdrop({ preview, paused }: { preview: SamplePreview | undefined; paused: boolean }) {
  const reduced = useReducedMotion();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  const [visible, setVisible] = useState(false);
  // Where the loop is, so a pause holds the picture on screen and play carries on from it.
  const pRef = useRef<number | null>(null);
  const clockRef = useRef(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)));
    io.observe(el);
    const ro = new ResizeObserver(() => setSize({ width: Math.round(el.clientWidth), height: Math.round(el.clientHeight) }));
    ro.observe(el);
    return () => {
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  const still = reduced || paused;
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !preview || !width || !height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (still || !visible) {
      drawPreview(ctx, preview, width, height, reduced ? restingP(preview) : (pRef.current ?? restingP(preview)), clockRef.current);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(80, now - last);
      last = now;
      const p = ((pRef.current ?? 0) + dt / LOOP_MS[preview.kind]) % 1;
      pRef.current = p;
      clockRef.current += dt / 1000;
      drawPreview(ctx, preview, width, height, p, clockRef.current);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [preview, width, height, still, visible, reduced]);

  const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
  return (
    <span className="sp-back" ref={wrapRef} aria-hidden="true">
      <canvas ref={canvasRef} width={width * dpr} height={height * dpr} style={{ width, height }} />
      <span className="sp-scrim" />
    </span>
  );
}
