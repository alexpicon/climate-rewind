/**
 * Plain-language labels for where the heat and rain numbers came from. Open-Meteo (ERA5) is the usual source; when it is rate limited
 * or down, NASA POWER (MERRA-2) stands in, and the page says so. Client-safe.
 */
import type { FloodTrigger, HeatSummary } from "../types";

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

/** The rain source for the flood trigger's fine print. */
export function rainLabel(trigger: Pick<FloodTrigger, "rainSource">): string {
  if (trigger.rainSource === "nasa-power") return `${POWER_NAME} rainfall`;
  if (trigger.rainSource === "mixed") return `ERA5 and ${POWER_NAME} rainfall`;
  return "ERA5 rainfall";
}
