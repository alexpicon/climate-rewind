"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayback } from "@/components/use-playback";
import { useReducedMotion } from "@/components/use-reduced-motion";
import { fitLower48, type Fit } from "@/lib/ui/albers";
import { drawStateOutlines, type StateShapes } from "@/lib/ui/state-outlines";
import { decodeReel, HOLD_MS, reelFrame, REEL_MS, type Reel, type Track, type TrackFile } from "@/lib/ui/track-reel";

/** Wide screens put the text on the left and the map on the right; narrower ones centre the map under the text. */
const WIDE = "(min-width: 1200px)";

const SETTLED_STYLE = {
  weak: { color: "rgba(186,194,209,0.22)", width: 1 },
  ef2: { color: "rgba(255,180,90,0.34)", width: 1.4 },
  strong: { color: "rgba(255,180,90,0.9)", width: 2.2 },
};

function styleOf(track: Track) {
  if (track.strong) return SETTLED_STYLE.strong;
  return track.ef === "EF2" ? SETTLED_STYLE.ef2 : SETTLED_STYLE.weak;
}

function drawSettled(ctx: CanvasRenderingContext2D, fit: Fit, tracks: readonly Track[], from: number, to: number) {
  for (let i = from; i < to; i += 1) {
    const track = tracks[i];
    const style = styleOf(track);
    const [x0, y0] = fit.toScreen(track.a[0], track.a[1]);
    const [x1, y1] = fit.toScreen(track.b[0], track.b[1]);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    // A track shorter than a pixel still shows as a dot.
    ctx.lineTo(Math.abs(x1 - x0) + Math.abs(y1 - y0) < 1 ? x0 + 1 : x1, y1);
    ctx.stroke();
  }
}

function drawActive(ctx: CanvasRenderingContext2D, fit: Fit, tracks: readonly Track[], settled: number, progress: readonly number[]) {
  ctx.lineCap = "round";
  progress.forEach((t, k) => {
    const track = tracks[settled + k];
    const [x0, y0] = fit.toScreen(track.a[0], track.a[1]);
    const [x1, y1] = fit.toScreen(track.b[0], track.b[1]);
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    ctx.strokeStyle = track.strong ? "rgba(255,200,120,1)" : "rgba(255,226,176,0.85)";
    ctx.lineWidth = track.strong ? 2.6 : 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x, y);
    ctx.stroke();
    // The head: a soft glow, and for EF3 or stronger a ring that opens and fades as it draws in.
    const glow = ctx.createRadialGradient(x, y, 0, x, y, track.strong ? 9 : 5);
    glow.addColorStop(0, track.strong ? "rgba(255,226,176,0.95)" : "rgba(255,226,176,0.7)");
    glow.addColorStop(1, "rgba(255,180,90,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, track.strong ? 9 : 5, 0, Math.PI * 2);
    ctx.fill();
    if (track.strong) {
      ctx.strokeStyle = `rgba(255,180,90,${(0.8 * (1 - t)).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x0, y0, 4 + 22 * t, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

/**
 * Behind the landing page: every real tornado track of 2015 to 2025 in the lower 48, drawn in date order with a year and running
 * totals, then held as the finished picture before it starts again. It has a pause button; with reduced motion it shows the
 * finished picture and plays only when asked. The canvas is decoration for sighted visitors; a sentence says the same in words.
 */
export function TrackReel() {
  const reduced = useReducedMotion();
  const [reel, setReel] = useState<Reel | null>(null);
  const [shapes, setShapes] = useState<StateShapes | null>(null);
  // Whether the visitor wants it moving: true plays and loops, false holds still where it is.
  const [moving, setMoving] = useState(true);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const drawn = useRef({ settled: 0, key: "" });
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1, wide: false });

  const playback = usePlayback({
    durationMs: REEL_MS,
    initialP: 0,
    onEnd: () => {
      hold.current = setTimeout(() => {
        playback.setP(0);
        playback.play();
      }, HOLD_MS);
    },
  });
  const { p, play, pause, setP } = playback;

  // The data comes after the page is up: the landing page never waits for it.
  useEffect(() => {
    const controller = new AbortController();
    const get = <T,>(url: string) => fetch(url, { signal: controller.signal }).then((r) => (r.ok ? (r.json() as Promise<T>) : null));
    get<TrackFile>("/data/tornado-tracks.json")
      .then((file) => file && setReel(decodeReel(file)))
      .catch(() => undefined);
    get<StateShapes>("/data/us-states.json")
      .then((states) => states && setShapes(states))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => () => clearTimeout(hold.current), []);

  // Start once the tracks are in. Reduced motion: the finished picture, still, until the visitor presses play.
  useEffect(() => {
    if (!reel) return;
    if (reduced) {
      setMoving(false);
      pause();
      setP(1);
    } else {
      play();
    }
  }, [reel, reduced, play, pause, setP]);

  useEffect(() => {
    const measure = () => setSize({ width: window.innerWidth, height: window.innerHeight, dpr: Math.min(2, window.devicePixelRatio || 1), wide: window.matchMedia(WIDE).matches });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const fitFor = useCallback((width: number, height: number, wide: boolean) => (wide ? fitLower48(width, height, 0.07, 0.92) : fitLower48(width, height, 0.04, 0.5)), []);

  useEffect(() => {
    const base = baseRef.current?.getContext("2d");
    const live = liveRef.current?.getContext("2d");
    if (!reel || !base || !live || !size.width) return;
    const fit = fitFor(size.width, size.height, size.wide);
    const frame = reelFrame(reel, p);
    const key = `${size.width}x${size.height}@${size.dpr}|${size.wide}|${shapes ? 1 : 0}`;
    // A new size, the outlines arriving, or the clock going back (the loop restarting): draw the settled layer again from the start.
    if (key !== drawn.current.key || frame.settled < drawn.current.settled) {
      base.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      base.clearRect(0, 0, size.width, size.height);
      drawStateOutlines(base, fit, shapes);
      drawn.current = { settled: 0, key };
    }
    drawSettled(base, fit, reel.tracks, drawn.current.settled, frame.settled);
    drawn.current.settled = frame.settled;
    live.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    live.clearRect(0, 0, size.width, size.height);
    drawActive(live, fit, reel.tracks, frame.settled, frame.progress);
  }, [reel, shapes, p, size, fitFor]);

  const toggle = () => {
    clearTimeout(hold.current);
    if (moving) {
      setMoving(false);
      pause();
    } else {
      setMoving(true);
      play();
    }
  };

  const frame = reel ? reelFrame(reel, p) : null;
  const total = reel ? reelFrame(reel, 1) : null;
  const canvasStyle = { width: size.width || "100%", height: size.height || "100%" };

  return (
    <>
      <div className="reel" aria-hidden="true">
        <canvas ref={baseRef} className="reel-canvas" width={size.width * size.dpr} height={size.height * size.dpr} style={canvasStyle} />
        <canvas ref={liveRef} className="reel-canvas" width={size.width * size.dpr} height={size.height * size.dpr} style={canvasStyle} />
        <div className="reel-scrim" />
      </div>
      {frame && total ? (
        <section className="reel-hud" aria-label="Tornado tracks, 2015 to 2025">
          <p className="sr">
            Behind this page, every tornado track the National Weather Service recorded in the lower 48 from 2015 to 2025 is drawn in date order: {total.count.toLocaleString("en-US")} tracks, {total.strong.toLocaleString("en-US")} of them EF3 or stronger, in which {total.deaths.toLocaleString("en-US")} people died.
          </p>
          <div className="reel-stats" aria-hidden="true">
            <span className="reel-year">{frame.year}</span>
            <span className="reel-stat">
              <b>{frame.count.toLocaleString("en-US")}</b> of {total.count.toLocaleString("en-US")} tornado tracks
            </span>
            <span className="reel-stat">
              <b>{frame.strong.toLocaleString("en-US")}</b> EF3 or stronger
            </span>
            <span className="reel-stat">
              <b>{frame.deaths.toLocaleString("en-US")}</b> deaths recorded
            </span>
          </div>
          <button type="button" className="reel-toggle" onClick={toggle}>
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              {moving ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" /> : <path d="M8 5.5v13l11-6.5z" fill="currentColor" />}
            </svg>
            <span>{moving ? "Pause" : "Play"} the tornado tracks</span>
          </button>
          <p className="reel-src">Every line is a real tornado track as the NWS filed it (NCEI Storm Events, {reel?.from.slice(0, 4)}–{total.year}, lower 48).</p>
        </section>
      ) : null}
    </>
  );
}
