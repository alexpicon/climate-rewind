"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { alertLevel } from "@/lib/ui/alerts";
import type { LiveAlert, LiveAlerts } from "@/lib/types";

export type LiveState = "loading" | "error" | "calm" | "watch" | "warn";

export interface Live {
  state: LiveState;
  alerts: LiveAlert[];
  checkedAt: number | null;
  checking: boolean;
  refresh: () => void;
}

const REFRESH_MS = 5 * 60 * 1000;

/**
 * The live NWS alert state for an address. Starts from what the lookup already fetched,
 * then re-checks every five minutes and on request. A failed re-check never hides an
 * alert we already know about, and never turns into "all clear".
 */
export function useLive(point: { lat: number; lon: number } | null, initial: LiveAlerts | null, lookingUp: boolean): Live {
  const [current, setCurrent] = useState<LiveAlerts | null>(initial);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    setCurrent(initial);
    setFailed(initial === null && point !== null && !lookingUp);
  }, [initial, point, lookingUp]);

  const refresh = useCallback(async () => {
    if (!point) return;
    const id = ++requestId.current;
    setChecking(true);
    try {
      const response = await fetch(`/api/alerts?lat=${point.lat}&lon=${point.lon}`, { cache: "no-store" });
      const body = (await response.json()) as { live: LiveAlerts | null };
      if (id !== requestId.current) return;
      if (body.live) {
        setCurrent(body.live);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      if (id === requestId.current) setFailed(true);
    } finally {
      if (id === requestId.current) setChecking(false);
    }
  }, [point]);

  useEffect(() => {
    if (!point) return;
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [point, refresh]);

  const alerts = [...(current?.alerts ?? [])].sort((a, b) => Number(alertLevel(a) !== "warn") - Number(alertLevel(b) !== "warn"));
  let state: LiveState;
  if (current) state = alerts.length ? alertLevel(alerts[0]) : "calm";
  else if (failed) state = "error";
  else state = "loading";

  return { state, alerts, checkedAt: current ? Date.parse(current.checkedAt) : null, checking, refresh };
}
