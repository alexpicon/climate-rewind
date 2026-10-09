"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePlayback } from "@/components/use-playback";
import { useReducedMotion } from "@/components/use-reduced-motion";
import { fitBox, type Fit } from "@/lib/ui/albers";
import { buildRecordModel, recordFrame, type RecordFlashFile, type RecordModel } from "@/lib/ui/record-flash-model";
import { drawStateOutlines, type StateShapes } from "@/lib/ui/state-outlines";

/** The ten seconds play over this long: two and a half times slower than they happened. */
const REPLAY_MS = 25_000;
const HEIGHT = 380;
/** The map frame: the Gulf coast the flash crossed, a little tighter than the box the light was read from. */
const VIEW = { south: 26.4, north: 32.4, west: -98.0, east: -86.8 };

const radiusOf = (energy: number) => 1.5 + Math.min(6, Math.log1p(energy) * 0.8);

function drawTrace(ctx: CanvasRenderingContext2D, fit: Fit, groups: RecordFlashFile["groups"], from: number, to: number) {
  ctx.fillStyle = "rgba(185,198,255,0.16)";
  for (let i = from; i < to; i += 1) {
    const [x, y] = fit.toScreen(groups[i][1], groups[i][2]);
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }
}

function drawGlow(ctx: CanvasRenderingContext2D, fit: Fit, model: RecordModel, from: number, to: number, ms: number) {
  ctx.globalCompositeOperation = "lighter";
  const groups = model.file.groups;
  for (let i = from; i < to; i += 1) {
    const [t, lat, lon, energy] = groups[i];
    const fresh = Math.max(0, 1 - (ms - t) / 350);
    const [x, y] = fit.toScreen(lat, lon);
    const r = radiusOf(energy) * (0.6 + 0.4 * fresh);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
    glow.addColorStop(0, `rgba(255,255,255,${(0.9 * fresh).toFixed(3)})`);
    glow.addColorStop(0.35, `rgba(185,198,255,${(0.45 * fresh).toFixed(3)})`);
    glow.addColorStop(1, "rgba(120,140,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
  }
  ctx.globalCompositeOperation = "source-over";
}

/**
 * The world-record lightning flash of 29 April 2020, replayed from the satellite's own light records: ten seconds of every light
 * group GOES-16 saw over the storm, two and a half times slower, the light running from near Houston into Mississippi. It starts
 * when it comes into view; with reduced motion it shows where all the light fell, still, and plays only when asked.
 */
export function RecordFlash() {
  const reduced = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const traceRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const [file, setFile] = useState<RecordFlashFile | null>(null);
  const [shapes, setShapes] = useState<StateShapes | null>(null);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const started = useRef(false);
  const drawn = useRef({ upTo: 0, key: "" });

  const model = useMemo(() => (file ? buildRecordModel(file) : null), [file]);
  const playback = usePlayback({ durationMs: REPLAY_MS, initialP: 0 });
  const { p, playing, play, pause, setP } = playback;
  const frame = model ? recordFrame(model, p) : null;

  // Load the data only once the card is close to the screen, and start the replay the first time it is in view.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: "200px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || file) return;
    const controller = new AbortController();
    const get = <T,>(url: string) => fetch(url, { signal: controller.signal }).then((r) => (r.ok ? (r.json() as Promise<T>) : null));
    get<RecordFlashFile>("/data/lightning/record-2020-04-29.json").then((f) => f && setFile(f)).catch(() => undefined);
    get<StateShapes>("/data/us-states.json").then((s) => s && setShapes(s)).catch(() => undefined);
    return () => controller.abort();
  }, [visible, file]);
  useEffect(() => {
    if (!model || !visible || started.current) return;
    started.current = true;
    if (reduced) setP(1);
    else play();
  }, [model, visible, reduced, play, setP]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
  useEffect(() => {
    const trace = traceRef.current?.getContext("2d");
    const live = liveRef.current?.getContext("2d");
    if (!model || !frame || !trace || !live || !width) return;
    const fit = fitBox(width, HEIGHT, VIEW, 10);
    const key = `${width}|${dpr}|${shapes ? 1 : 0}`;
    if (key !== drawn.current.key || frame.glowFrom < drawn.current.upTo) {
      trace.setTransform(dpr, 0, 0, dpr, 0, 0);
      trace.clearRect(0, 0, width, HEIGHT);
      drawStateOutlines(trace, fit, shapes, "rgba(186,194,209,0.28)", [20, 50]);
      drawn.current = { upTo: 0, key };
    }
    // Reduced motion and the end: every group, faint. Otherwise the light that has faded joins the trace as it goes.
    const traceTo = reduced && !playing ? model.file.groups.length : frame.glowFrom;
    drawTrace(trace, fit, model.file.groups, drawn.current.upTo, traceTo);
    drawn.current.upTo = Math.max(drawn.current.upTo, traceTo);
    live.setTransform(dpr, 0, 0, dpr, 0, 0);
    live.clearRect(0, 0, width, HEIGHT);
    drawGlow(live, fit, model, frame.glowFrom, frame.seen, frame.ms);
  }, [model, frame, width, dpr, shapes, reduced, playing]);

  const record = file?.record;
  const atEnd = p >= 0.9995;
  return (
    <figure className="record-flash" aria-labelledby="rf-h">
      <div className="rf-stage" ref={wrapRef} style={{ height: HEIGHT }}>
        <canvas ref={traceRef} width={width * dpr} height={HEIGHT * dpr} style={{ width, height: HEIGHT }} aria-hidden="true" />
        <canvas ref={liveRef} width={width * dpr} height={HEIGHT * dpr} style={{ width, height: HEIGHT }} aria-hidden="true" />
        {frame ? (
          <div className="rf-hud" aria-hidden="true">
            <span className="rf-clock">{frame.clock} UTC</span>
            <span className="rf-span">
              <b>{frame.spanKm.toLocaleString("en-US")} km</b> lit, west to east
            </span>
          </div>
        ) : null}
        {model ? (
          <button
            type="button"
            className="rf-play"
            onClick={() => {
              if (playing) pause();
              else {
                if (atEnd) setP(0);
                play();
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" /> : <path d="M8 5.5v13l11-6.5z" fill="currentColor" />}
            </svg>
            <span>{playing ? "Pause" : atEnd ? "Watch it again" : "Play"} the record flash</span>
          </button>
        ) : null}
      </div>
      <figcaption>
        <h3 id="rf-h" className="rf-t">
          A world-record lightning flash: {record ? `${record.lengthKm} km (${record.lengthMi} miles)` : "768 km (477 miles)"} in about seven seconds
        </h3>
        <p className="rf-b">
          On 29 April 2020 at 14:32:39 UTC, one flash ran {record?.where ?? "from near Houston, Texas, into southeastern Mississippi"}, certified by the{" "}
          {record?.certified ?? "World Meteorological Organization, 2022"}. This is the satellite’s own record of it: every bit of light NOAA’s GOES-16 saw over
          that storm in those ten seconds, slowed down two and a half times. Other flashes in the same storm are lit too, so the light here spans a little more
          ({file?.spanKm ?? 803} km) than the certified flash.
        </p>
        <p className="rf-n">{record?.since ?? ""}</p>
      </figcaption>
    </figure>
  );
}
