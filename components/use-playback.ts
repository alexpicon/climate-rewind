"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const SPEEDS = [1, 2, 0.5] as const;

export interface Playback {
  /** Progress through the animation, 0 to 1. */
  p: number;
  playing: boolean;
  speed: number;
  atEnd: boolean;
  setP: (p: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  cycleSpeed: () => void;
}

interface Options {
  /** Length of the animation at 1x, in milliseconds. */
  durationMs: number;
  /** Starting progress (1 shows the end state, used for reduced motion). */
  initialP: number;
  /** Pauses the clock while something else (like loading radar) is not ready. */
  stalled?: boolean;
  onEnd?: () => void;
}

/**
 * One animation clock for every view. The views draw as a pure function of `p`,
 * so playing, pausing, scrubbing and reduced motion all go through the same path.
 */
export function usePlayback({ durationMs, initialP, stalled = false, onEnd }: Options): Playback {
  const [p, setPState] = useState(initialP);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);

  const pRef = useRef(p);
  const speedRef = useRef(speed);
  const durationRef = useRef(durationMs);
  const stalledRef = useRef(stalled);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    speedRef.current = speed;
    durationRef.current = durationMs;
    stalledRef.current = stalled;
    onEndRef.current = onEnd;
  });

  const setP = useCallback((next: number) => {
    const clamped = Math.min(1, Math.max(0, next));
    pRef.current = clamped;
    setPState(clamped);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!last) last = now;
      const dt = Math.min(now - last, 80); // a background tab must not jump the animation
      last = now;
      if (stalledRef.current) return;
      const next = pRef.current + (dt * speedRef.current) / durationRef.current;
      if (next >= 1) {
        setP(1);
        setPlaying(false);
        onEndRef.current?.();
      } else {
        setP(next);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, setP]);

  const play = useCallback(() => {
    if (pRef.current >= 0.9995) setP(0);
    setPlaying(true);
  }, [setP]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, play, pause]);
  const cycleSpeed = useCallback(() => {
    setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]);
  }, []);

  return { p, playing, speed, atEnd: p >= 0.9995 && !playing, setP, play, pause, toggle, cycleSpeed };
}
