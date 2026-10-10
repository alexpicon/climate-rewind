/**
 * Plain-language labels for where the heat and rain numbers came from. Open-Meteo (ERA5) is the usual source; when it is rate limited
 * or down, NASA POWER (MERRA-2) stands in, and the page says so. Client-safe.
 */
import { dayHigh, dayHighKind } from "../heat-measure";
import type { FloodTrigger, HeatDay, HeatSummary } from "../types";

export const POWER_NAME = "NASA POWER (MERRA-2)";
export const OPEN_METEO_NAME = "weather reanalysis (ERA5 via Open-Meteo)";

export interface HeatLabels {
  /** "feels-like" or "heat index", as used in "a feels-like high of 105". */
  measure: string;
  /** Where the daily highs come from, for "Daily highs from ...". */
  source: string;
  /** True when NASA POWER stands in for Open-Meteo. */
  fallback: boolean;
  /** One visible sentence for the fallback, else null. */
  explain: string | null;
}

export function heatLabels(heat: Pick<HeatSummary, "provider"> | null | undefined): HeatLabels {
  if (heat?.provider === "nasa-power") {
    return {
      measure: "heat index",
      source: POWER_NAME,
      fallback: true,
      explain: `Open-Meteo was not answering, so these daily highs come from ${POWER_NAME} reanalysis: the National Weather Service heat index, worked out from each day’s highest air temperature and the humidity at that temperature. It is a different measure from the usual feels-like, so the numbers differ.`,
    };
  }
  return { measure: "feels-like", source: OPEN_METEO_NAME, fallback: false, explain: null };
}

/**
 * How the heat tab names its daily high. With air temperatures in the data: "high", meaning the air temperature or the feels-like
 * (heat index) where humidity made it feel hotter. An older snapshot without them: the feels-like (heat index) high, as before.
 */
export function heatHighWords(heat: Pick<HeatSummary, "provider" | "hottest">): { short: string; rule: string | null } {
  const { measure } = heatLabels(heat);
  if (heat.hottest.airF === undefined) return { short: `${measure} high`, rule: null };
  return { short: "high", rule: `the air temperature, or the ${measure} where humidity made it feel hotter` };
}

/** One day's high in words, with the other measure beside it: "101°F air temperature (felt like 98°F)". */
export function dayHighWords(day: HeatDay, measure: string): string {
  const high = Math.round(dayHigh(day));
  if (day.airF === undefined) return `${high}°F ${measure}`;
  return dayHighKind(day) === "air"
    ? `${high}°F air temperature (${measure} ${Math.round(day.feelsF)}°F)`
    : `${high}°F ${measure} (air temperature ${Math.round(day.airF)}°F)`;
}

/** The gridded rain source (ERA5, NASA POWER or both), for the days no gauge read. */
function gridRainLabel(trigger: Pick<FloodTrigger, "rainSource">): string {
  if (trigger.rainSource === "nasa-power") return `${POWER_NAME} rainfall`;
  if (trigger.rainSource === "mixed") return `ERA5 and ${POWER_NAME} rainfall`;
  return "ERA5 rainfall";
}

/** How many of the flood days a NOAA rain gauge measured. */
export function gaugeDays(trigger: Partial<Pick<FloodTrigger, "history">>): { measured: number; total: number } {
  const history = trigger.history ?? [];
  return { measured: history.filter((day) => day.station).length, total: history.length };
}

/** The rain source for the flood trigger's fine print: NOAA rain gauges where they read the day, gridded rain for the rest. */
export function rainLabel(trigger: Pick<FloodTrigger, "rainSource"> & Partial<Pick<FloodTrigger, "history">>): string {
  const { measured, total } = gaugeDays(trigger);
  if (measured > 0 && measured === total) return "NOAA rain gauge measurements";
  if (measured > 0) return `NOAA rain gauge measurements (${measured} of ${total} days) and ${gridRainLabel(trigger)}`;
  return gridRainLabel(trigger);
}
