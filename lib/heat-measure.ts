import type { HeatDay } from "./types";

/**
 * A day's high for the heat tab: the air temperature, or the feels-like where humidity made it feel hotter, whichever is higher.
 * Feels-like alone hides dry heat: in desert air it runs below the thermometer (Albuquerque's air reached 100°F on days its
 * feels-like never did). A day without an air temperature (an older snapshot) is its feels-like.
 */
export function dayHigh(day: HeatDay): number {
  return day.airF !== undefined && day.airF > day.feelsF ? day.airF : day.feelsF;
}

/** Which of the two gave the day's high. */
export function dayHighKind(day: HeatDay): "air" | "feels" {
  return day.airF !== undefined && day.airF > day.feelsF ? "air" : "feels";
}

/** True when the days carry air temperatures, so the heat tab can say it counts the higher of the two. */
export const hasAirTemps = (days: readonly HeatDay[]): boolean => days.some((d) => d.airF !== undefined);
