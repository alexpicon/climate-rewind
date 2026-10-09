/**
 * The words for "your street's flood trigger". One place, so the storm card and the live drawer always say the same thing.
 * The signal is history-based: it never says a flood "will" happen.
 */
import type { FloodTrigger } from "../types";
import { rainLabel } from "./data-source";

export const TRIGGER_FINE_PRINT = "Based on NWS reports near this address and ERA5 rainfall; a history-based signal, not a flood forecast.";
/** The fine print under the trigger; names the rain gauges, and NASA POWER when it stood in for Open-Meteo. */
export function triggerFinePrint(trigger: Pick<FloodTrigger, "rainSource"> & Partial<Pick<FloodTrigger, "history">>): string {
  return `Based on NWS reports near this address and ${rainLabel(trigger)}; a history-based signal, not a flood forecast.`;
}
export const TRIGGER_TITLE = "Your street’s flood trigger";
export const NOT_ENOUGH_HISTORY = "Not enough history at this address yet.";

/** "0.08", "0.2", "1.8", "12.0": enough digits to tell a trace from a drizzle, no more. */
export function formatInches(value: number): string {
  return value < 0.1 ? value.toFixed(2) : value.toFixed(1);
}

/** "Today’s", "Tomorrow’s", or the weekday (“Saturday’s”) of a forecast day. */
export function dayPossessive(index: number, date: string): string {
  if (index === 0) return "Today’s";
  if (index === 1) return "Tomorrow’s";
  const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return `${weekday}’s`;
}

export type TriggerTone = "above" | "near" | "below" | "history" | "none" | "error";

export interface TriggerCopy {
  tone: TriggerTone;
  /** The one sentence to lead with. */
  headline: string;
  /** What the history says (or how often it was this much), under the headline. Null when there is nothing to add. */
  context: string[];
  /** A plain note about something that could not be loaded, or null. */
  notice: string | null;
}

export function triggerCopy(trigger: FloodTrigger): TriggerCopy {
  if (trigger.status === "insufficient") return { tone: "none", headline: NOT_ENOUGH_HISTORY, context: [], notice: trigger.notices.history ?? null };
  if (trigger.status === "unavailable" || trigger.triggerIn === null) {
    return {
      tone: "error",
      headline: "The rainfall records for this address could not be loaded right now.",
      context: [],
      notice: trigger.notices.history ?? null,
    };
  }

  const typical = formatInches(trigger.triggerIn);
  const history = `On days with flood reports here, the typical rain was ${typical} in.`;
  const forecast = trigger.forecast;
  if (!forecast) {
    return { tone: "history", headline: history, context: [], notice: trigger.notices.forecast ?? "The official forecast could not be loaded right now." };
  }

  const peak = forecast.peak;
  const peakText = formatInches(peak.inches);
  const day = dayPossessive(Math.max(0, forecast.days.findIndex((d) => d.date === peak.date)), peak.date);
  // How often the rain on a flood day was under what is forecast: backs up an "above" (near the median it would only say "about half").
  const under = trigger.history.filter((d) => d.rainIn < peak.inches).length;
  const share = `On ${under} of the ${trigger.history.length} days with flood reports here, the rain was under ${peakText} in.`;

  if (forecast.verdict === "above") {
    return {
      tone: "above",
      headline: `${day} official forecast (${peakText} in) is above the typical rain on days with flood reports here.`,
      context: [history, ...(under > 0 ? [share] : [])],
      notice: null,
    };
  }
  if (forecast.verdict === "near") {
    return {
      tone: "near",
      headline: `${day} official forecast (${peakText} in) is close to the typical rain on days with flood reports here.`,
      context: [history],
      notice: null,
    };
  }
  const well = peak.inches < trigger.triggerIn * 0.5 ? "well below" : "below";
  const amount = peak.inches < 0.05 ? "(no measurable rain)" : `(up to ${peakText} in a day)`;
  return {
    tone: "below",
    headline: `The next 3 days’ forecast ${amount} is ${well} the typical rain on days with flood reports here.`,
    context: [history],
    notice: null,
  };
}
