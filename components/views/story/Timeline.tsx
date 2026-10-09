"use client";

import { useMemo } from "react";
import { severityScore } from "@/lib/event-severity";
import type { AreaEvent } from "@/lib/types";
import { axisTicks, FAMILIES, timelineDots, type Family } from "@/lib/ui/story-model";

const W = 400;
const LANE_H = 26;
const TOP = 8;
const PAD_X = 14;

function Marker({ family, x, y, r, selected }: { family: Family; x: number; y: number; r: number; selected: boolean }) {
  const { color, shape } = FAMILIES[family];
  const common = { fill: shape === "ring" ? "none" : color, stroke: shape === "ring" ? color : "rgba(6,10,19,.85)", strokeWidth: shape === "ring" ? 2 : 1 };
  const k = r * 1.15;
  let mark;
  switch (shape) {
    case "diamond":
      mark = <path d={`M${x} ${y - k}L${x + k} ${y}L${x} ${y + k}L${x - k} ${y}Z`} {...common} />;
      break;
    case "square":
      mark = <rect x={x - r} y={y - r} width={r * 2} height={r * 2} {...common} />;
      break;
    case "triangle":
      mark = <path d={`M${x} ${y - k}L${x + k} ${y + k * 0.8}L${x - k} ${y + k * 0.8}Z`} {...common} />;
      break;
    case "cross":
      mark = <path d={`M${x - r} ${y - r * 0.4}h${r * 0.6}v${-r * 0.6}h${r * 0.8}v${r * 0.6}h${r * 0.6}v${r * 0.8}h${-r * 0.6}v${r * 0.6}h${-r * 0.8}v${-r * 0.6}h${-r * 0.6}Z`} {...common} />;
      break;
    default:
      mark = <circle cx={x} cy={y} r={r} {...common} />;
  }
  return (
    <>
      {selected ? <circle cx={x} cy={y} r={r + 5} fill="none" stroke="#FFE2B0" strokeWidth={2} /> : null}
      {mark}
    </>
  );
}

/**
 * The area's events from 2000 to today, one dot each, in a lane per kind of weather. Dot size follows severity. The chart is a picture
 * for sighted mouse and touch users (a click opens the event); keyboard and screen reader users get the same events as a list, so the
 * dots are not tab stops.
 */
export function Timeline({ events, selectedId, onSelect, now }: { events: readonly AreaEvent[]; selectedId: string | null; onSelect: (id: string) => void; now: Date }) {
  const { dots, lanes } = useMemo(() => timelineDots(events, severityScore, now), [events, now]);
  const ticks = useMemo(() => axisTicks(now), [now]);
  const height = TOP + lanes.length * LANE_H + 22;
  const xOf = (pct: number) => PAD_X + ((W - 2 * PAD_X) * pct) / 100;
  // Draw the selected dot last so it is on top.
  const ordered = [...dots].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId));

  return (
    <div className="tl">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`Timeline from 2000 to ${now.getUTCFullYear()} of the ${events.length} most significant weather events in your area. The same events are listed below.`} focusable="false">
        {lanes.map((family, i) => (
          <g key={family}>
            <line x1={PAD_X} x2={W - PAD_X} y1={TOP + i * LANE_H + LANE_H / 2} y2={TOP + i * LANE_H + LANE_H / 2} stroke="rgba(255,255,255,.1)" strokeDasharray="2 5" />
          </g>
        ))}
        {ticks.map((tick) => (
          <g key={tick.year}>
            <line x1={xOf(tick.x)} x2={xOf(tick.x)} y1={TOP} y2={TOP + lanes.length * LANE_H} stroke="rgba(255,255,255,.08)" />
            <text x={xOf(tick.x)} y={height - 6} fill="#B8C2D6" fontSize="11" textAnchor="middle">
              {tick.year}
            </text>
          </g>
        ))}
        {ordered.map((dot) => (
          <g key={dot.id} className="tl-dot" onClick={() => onSelect(dot.id)} style={{ cursor: "pointer" }}>
            <title>{dot.label}</title>
            {/* A larger invisible target so a finger or a mouse does not have to hit a 6 px dot. */}
            <circle cx={xOf(dot.x)} cy={TOP + dot.lane * LANE_H + LANE_H / 2} r={Math.max(11, dot.r + 4)} fill="transparent" />
            <Marker family={dot.family} x={xOf(dot.x)} y={TOP + dot.lane * LANE_H + LANE_H / 2} r={dot.r} selected={dot.id === selectedId} />
          </g>
        ))}
      </svg>
      <ul className="tl-key" aria-label="Key to the timeline">
        {lanes.map((family) => (
          <li key={family}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <Marker family={family} x={8} y={8} r={4.5} selected={false} />
            </svg>
            {FAMILIES[family].label}
          </li>
        ))}
      </ul>
    </div>
  );
}
