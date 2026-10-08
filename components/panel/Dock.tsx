"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { Playback } from "../use-playback";

const ICON_PLAY = (
  <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
  </svg>
);
const ICON_PAUSE = (
  <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor" />
    <rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor" />
  </svg>
);
const ICON_REPLAY = (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v5h5" />
  </svg>
);

interface Props {
  playback: Playback;
  /** True while something (like radar) is still loading; play and the slider wait. */
  busy?: boolean;
  busyLabel?: string;
  clockMain: ReactNode;
  clockSub: string;
  sliderLabel: string;
  sliderValueText: string;
  /** Left and right captions above the slider. */
  captions?: [string, string];
  /** Marks along the slider (flood report ticks, tornado ticks). */
  ticks?: ReactNode;
  /** Year labels under the slider (tornadoes). */
  yearLabels?: ReactNode;
  /** Replaces the slider with one button per step (heat days). */
  stepButtons?: ReactNode;
  showSpeed?: boolean;
  withYears?: boolean;
}

/** Play or pause, the clock, a slider and the speed button. Every animated view has one. */
export function Dock({
  playback,
  busy = false,
  busyLabel = "Loading",
  clockMain,
  clockSub,
  sliderLabel,
  sliderValueText,
  captions,
  ticks,
  yearLabels,
  stepButtons,
  showSpeed = true,
  withYears = false,
}: Props) {
  const { p, playing, atEnd, speed } = playback;

  // Other floating pieces (the Key button, the radar progress) sit just above the dock, whatever its height on this tab.
  const dockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = dockRef.current;
    if (!node) return;
    const set = () => document.documentElement.style.setProperty("--dock-h", `${Math.round(node.getBoundingClientRect().height)}px`);
    set();
    const observer = new ResizeObserver(set);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--dock-h");
    };
  }, []);

  // Space plays and pauses, unless the visitor is typing or on another control.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = document.activeElement?.tagName ?? "";
      if (event.code === "Space" && !/^(INPUT|BUTTON|SUMMARY|A|TEXTAREA|SELECT)$/.test(tag)) {
        event.preventDefault();
        if (!busy) playback.toggle();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, playback]);

  const label = busy ? busyLabel : playing ? "Pause animation" : atEnd ? "Replay animation" : "Play animation";
  const speedText = speed === 0.5 ? "0.5" : String(speed);

  return (
    <div id="dock" ref={dockRef} className={`glass${withYears ? " yrs" : ""}`} role="group" aria-label="Animation controls">
      <button id="play" type="button" aria-label={label} disabled={busy} onClick={() => playback.toggle()}>
        {playing ? ICON_PAUSE : atEnd ? ICON_REPLAY : ICON_PLAY}
      </button>
      <div id="clock">
        <div className="t">{clockMain}</div>
        <div className="d">{clockSub}</div>
      </div>
      <div id="mid">
        {captions ? (
          <div id="midcap" aria-hidden="true">
            <span>{captions[0]}</span>
            <span>{captions[1]}</span>
          </div>
        ) : null}
        {stepButtons ? (
          <div id="strip" role="group" aria-label={sliderLabel} style={{ display: "flex" }}>
            {stepButtons}
          </div>
        ) : (
          <div id="scrub">
            <div id="ticks" aria-hidden="true">
              {ticks}
            </div>
            <label className="sr" htmlFor="range">
              {sliderLabel}
            </label>
            <input
              id="range"
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(p * 1000)}
              disabled={busy}
              aria-valuetext={sliderValueText}
              style={{ "--fill": `${(p * 100).toFixed(1)}%` } as React.CSSProperties}
              onChange={(event) => {
                playback.pause();
                playback.setP(Number(event.target.value) / 1000);
              }}
            />
          </div>
        )}
        {yearLabels ? <div id="yearlbls" aria-hidden="true">{yearLabels}</div> : null}
      </div>
      {showSpeed ? (
        <button
          id="speed"
          type="button"
          aria-label={`Playback speed ${speedText} times. Press to change.`}
          title="Playback speed"
          onClick={() => playback.cycleSpeed()}
        >
          {speedText}&times;
        </button>
      ) : null}
    </div>
  );
}
