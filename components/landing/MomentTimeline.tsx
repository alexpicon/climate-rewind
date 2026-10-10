"use client";

import { useEffect, useRef } from "react";
import { usePlayback } from "@/components/use-playback";
import { useReducedMotion } from "@/components/use-reduced-motion";
import { useShown } from "./use-shown";
import { nightX, TIMELINE_MS, timelineEnds, timelineFrame, timelineHighlight, timelineLabel, timelineSummary, type MomentTimeline as Timeline } from "@/lib/ui/moment-timeline";

const W = 600;
const H = 72;
const EF_COLORS = ["#C7D6FF", "#8FB0FF", "#B58CFF", "#FF4FA3", "#FF4FA3", "#FF4FA3"];

/** The marks of a timeline, lit up to the playhead. Drawn in a 600 by 72 box that stretches to the card's width. */
function Marks({ timeline, x, reached }: { timeline: Timeline; x: number; reached: number }) {
  if (timeline.kind === "years") {
    const most = Math.max(1, ...timeline.counts);
    const step = W / timeline.counts.length;
    return (
      <>
        {timeline.counts.map((count, i) => {
          const year = timeline.from + i;
          const highlight = year === timeline.highlightYear;
          const h = Math.max(2, (count / most) * (H - 14));
          return <rect key={year} className={`mt-bar${highlight ? " hi" : ""}${i < reached ? " lit" : ""}`} x={i * step + step * 0.18} y={H - h} width={step * 0.64} height={h} rx={1.5} />;
        })}
      </>
    );
  }
  if (timeline.kind === "tornadoes") {
    return (
      <>
        {timeline.marks.map((m, i) => {
          const h = 12 + Math.max(0, m.ef) * 12;
          const cx = nightX(timeline, m.t) * W;
          return <rect key={`${m.t}-${i}`} className={`mt-tor${m.focus ? " hi" : ""}${i < reached ? " lit" : ""}`} x={cx - (m.focus ? 2.5 : 1.5)} y={H - h} width={m.focus ? 5 : 3} height={h} rx={1.5} fill={EF_COLORS[Math.max(0, Math.min(5, m.ef))]} />;
        })}
      </>
    );
  }
  const most = Math.max(1, ...timeline.lightning);
  const step = W / timeline.lightning.length;
  return (
    <>
      {timeline.lightning.map((count, i) => {
        const h = Math.max(1.5, (count / most) * (H - 16));
        return <rect key={i} className={`mt-bolt${i < reached ? " lit" : ""}`} x={i * step + step * 0.12} y={H - 10 - h} width={step * 0.76} height={h} rx={1} />;
      })}
      {timeline.reports.map((t, i) => {
        const cx = nightX(timeline, t) * W;
        return <rect key={`r${i}`} className={`mt-report${nightX(timeline, t) <= x ? " lit" : ""}`} x={cx - 1.5} y={H - 7} width={3} height={7} rx={1} />;
      })}
    </>
  );
}

/**
 * A moment card's timeline: the night's tornadoes, the night's lightning and flood reports, or the area's events by year, with a
 * playhead, a clock and running totals. It plays once when it comes into view; the button plays it again or pauses it. With reduced
 * motion it shows the whole timeline at once.
 */
export function MomentTimeline({ timeline }: { timeline: Timeline }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const playback = usePlayback({ durationMs: TIMELINE_MS, initialP: 0 });
  const { p, playing, play, pause, setP } = playback;
  const frame = timelineFrame(timeline, p);
  const [startLabel, endLabel] = timelineEnds(timeline);
  const highlight = timelineHighlight(timeline);
  const label = timelineLabel(timeline);

  // Plays once, the first time its card is really on screen.
  const shown = useShown(ref, 0.6);
  useEffect(() => {
    if (!shown || started.current) return;
    started.current = true;
    if (reduced) setP(1);
    else play();
  }, [shown, reduced, play, setP]);

  const atEnd = p >= 0.9995;
  return (
    <div className="mt" ref={ref}>
      {label ? <p className="mt-label">{label}</p> : null}
      <div className="mt-head">
        <button
          type="button"
          className="mt-play"
          onClick={() => {
            if (playing) pause();
            else {
              if (atEnd) setP(0);
              play();
            }
          }}
          aria-label={playing ? "Pause the timeline" : atEnd ? "Play the timeline again" : "Play the timeline"}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" /> : <path d="M8 5.5v13l11-6.5z" fill="currentColor" />}
          </svg>
        </button>
        <p className="mt-now" aria-hidden="true">
          <b>{frame.when}</b> {frame.totals}
        </p>
      </div>
      <p className="sr">{timelineSummary(timeline)}</p>
      <div className="mt-strip">
        {highlight ? (
          <span
            className={`mt-tag${frame.x >= highlight.x ? " lit" : ""}${highlight.x > 0.7 ? " end" : highlight.x < 0.3 ? " start" : ""}`}
            style={{ left: `${(highlight.x * 100).toFixed(2)}%` }}
            aria-hidden="true"
          >
            {highlight.label}
          </span>
        ) : null}
        <svg className="mt-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <Marks timeline={timeline} x={frame.x} reached={frame.reached} />
          <line className="mt-head-line" x1={frame.x * W} x2={frame.x * W} y1={0} y2={H} />
        </svg>
      </div>
      <div className="mt-ends" aria-hidden="true">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}
