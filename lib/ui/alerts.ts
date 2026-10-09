import type { LiveAlert } from "../types";

export interface StormMotion {
  /** Direction the storm moves FROM, degrees. */
  from: number;
  knots: number;
  lat: number;
  lon: number;
}

/** Parses the NWS eventMotionDescription: "...262DEG...28KT...36.15,-86.9" */
export function parseMotion(raw: string | null): StormMotion | null {
  if (!raw) return null;
  const m = /(\d+)DEG\.\.\.(\d+)KT\.\.\.([\d.]+),\s*(-[\d.]+)/.exec(raw);
  return m ? { from: Number(m[1]), knots: Number(m[2]), lat: Number(m[3]), lon: Number(m[4]) } : null;
}

/** The alerts still in force at `nowMs`: one whose stated end has passed is no longer shown, red or otherwise. No end: in force. */
export function activeAlerts<T extends Pick<LiveAlert, "ends">>(alerts: readonly T[], nowMs: number): T[] {
  return alerts.filter((alert) => {
    const ends = alert.ends ? Date.parse(alert.ends) : Number.NaN;
    return Number.isNaN(ends) || ends > nowMs;
  });
}

export type AlertLevel = "warn" | "watch";

/** Warnings are the red level; watches, advisories and statements are the amber level. */
export function alertLevel(alert: Pick<LiveAlert, "event">): AlertLevel {
  return /warning$/i.test(alert.event) ? "warn" : "watch";
}
