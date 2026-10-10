/** Words for the day cards. Pure and client-safe. Dates are local calendar dates (YYYY-MM-DD) written as they are, with no time zone shifting. */
import type { DayForecast } from "./types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface DayHeading {
  /** "Today", "Tomorrow", or the weekday. */
  label: string;
  /** "Saturday, Oct 10" */
  full: string;
  weekday: string;
  /** What sits beside the label: "Oct 10" when the label is the weekday, else "Saturday, Oct 10". */
  dateText: string;
}

export function dayHeading(index: number, date: string): DayHeading {
  const d = new Date(`${date}T12:00:00Z`);
  const weekday = WEEKDAYS[d.getUTCDay()];
  const full = `${weekday}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const label = index === 0 ? "Today" : index === 1 ? "Tomorrow" : weekday;
  return { label, full, weekday, dateText: label === weekday ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` : full };
}

/** "71° / 62°", or just the one that is known, or null. */
export function tempsText(f: Pick<DayForecast, "highF" | "lowF">): string | null {
  if (f.highF === null && f.lowF === null) return null;
  if (f.highF === null) return `Low ${Math.round(f.lowF as number)}°`;
  if (f.lowF === null) return `High ${Math.round(f.highF)}°`;
  return `${Math.round(f.highF)}° / ${Math.round(f.lowF)}°`;
}

/** The NWS's own short words, tidied ("Showers And Thunderstorms" to "Showers and thunderstorms"). */
export function tidyWords(words: string | null): string | null {
  if (!words) return null;
  const lower = words.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** The one line a quiet day gets under "Nothing unusual expected". */
export function quietDetail(f: DayForecast): string {
  const parts = [tidyWords(f.words), tempsText(f)].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(" · ") : "Forecast not available yet";
}
