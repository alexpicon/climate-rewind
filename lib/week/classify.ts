/**
 * Which days are notable, and what each notable day says in plain words. Pure: forecast numbers and official outlook levels in,
 * hazards out. No network, no clock. The official names go in `source`, never in the plain line.
 */
import { ERO_LABEL, ERO_MEANING, HEATRISK_LABEL } from "../outlook-types";
import type { DayForecast, DayOfficial, WeekHazard, WeekLevel } from "./types";

const ERO_LEVEL: Record<string, WeekLevel | 0> = { none: 0, MRGL: 0, SLGT: 1, ENH: 2, MDT: 3, HIGH: 3 };
const max = (...levels: Array<WeekLevel | 0>): WeekLevel | 0 => Math.max(...levels) as WeekLevel | 0;

/** Heat: HeatRisk Moderate (2) or worse, or a feels-like of 100 F or more. */
export function heatLevel(feelsF: number | null, risk: DayOfficial["heatRisk"]): WeekLevel | 0 {
  const byRisk: WeekLevel | 0 = risk === 4 ? 3 : risk === 3 ? 2 : risk === 2 ? 1 : 0;
  const byFeels: WeekLevel | 0 = feelsF === null ? 0 : feelsF >= 110 ? 3 : feelsF >= 105 ? 2 : feelsF >= 100 ? 1 : 0;
  return max(byRisk, byFeels);
}

/** Flooding: WPC Slight risk or worse, or an inch of forecast rain or more. */
export function floodLevel(ero: DayOfficial["ero"], rainIn: number | null): WeekLevel | 0 {
  const byEro = ero ? (ERO_LEVEL[ero] ?? 0) : 0;
  const byRain: WeekLevel | 0 = rainIn === null ? 0 : rainIn >= 2.5 ? 2 : rainIn >= 1 ? 1 : 0;
  return max(byEro, byRain);
}

/** Storms: SPC tornado probability 2% or more (Days 1, 2), or 15% or more of any severe weather (Day 3). */
export function stormLevel(spc: DayOfficial["spc"]): WeekLevel | 0 {
  if (!spc) return 0;
  if (spc.kind === "tornado") return spc.percent >= 10 ? 3 : spc.percent >= 5 ? 2 : spc.percent >= 2 ? 1 : 0;
  return spc.percent >= 45 ? 3 : spc.percent >= 30 ? 2 : spc.percent >= 15 ? 1 : 0;
}

/** Wind: forecast gusts of 45 mph or more (about where the NWS starts wind advisories). */
export function windLevel(gustMph: number | null): WeekLevel | 0 {
  if (gustMph === null) return 0;
  return gustMph >= 65 ? 3 : gustMph >= 55 ? 2 : gustMph >= 45 ? 1 : 0;
}

const HEAT_PLAIN: Record<number, string> = {
  1: "Hot enough to bother people who are sensitive to heat.",
  2: "Hot enough to affect anyone without cooling or enough water.",
  3: "Dangerous heat for everyone, with little relief overnight.",
};

const dayWord = (index: number, kind: "outlook" | "forecast") => (kind === "outlook" ? `Day ${index + 1}` : "");

/** The notable hazards of one day, worst first. Empty: a quiet day. `index` is 0 for today. */
export function classifyDay(forecast: DayForecast, official: DayOfficial, index: number): Omit<WeekHazard, "before" | "climate">[] {
  const out: Array<Omit<WeekHazard, "before" | "climate">> = [];

  const heat = heatLevel(forecast.feelsF, official.heatRisk);
  if (heat > 0) {
    const sources = [`NWS forecast: feels-like up to ${Math.round(forecast.feelsF ?? 0)}°F`];
    if (official.heatRisk !== null && official.heatRisk >= 1) sources.push(`NWS HeatRisk: ${HEATRISK_LABEL[official.heatRisk]} (level ${official.heatRisk} of 4)`);
    out.push({
      kind: "heat",
      level: heat as WeekLevel,
      title: heat >= 3 ? "Dangerous heat" : "Hot",
      plain: `${forecast.feelsF !== null ? `It will feel like ${Math.round(forecast.feelsF)}°F at the hottest. ` : ""}${HEAT_PLAIN[heat]}`,
      source: sources.join(" · "),
    });
  }

  const flood = floodLevel(official.ero, forecast.rainIn);
  if (flood > 0) {
    const rain = forecast.rainIn !== null && forecast.rainIn >= 0.1 ? ` About ${forecast.rainIn.toFixed(1)} in of rain is forecast.` : "";
    const sources: string[] = [];
    if (official.ero && ERO_LEVEL[official.ero] >= 1) sources.push(`WPC Excessive Rainfall Outlook, ${dayWord(index, "outlook")}: ${ERO_LABEL[official.ero]} risk (${ERO_MEANING[official.ero]})`);
    if (forecast.rainIn !== null && forecast.rainIn >= 0.1) sources.push("NWS rain forecast");
    out.push({
      kind: "flood",
      level: flood as WeekLevel,
      title: "Heavy rain",
      plain: `${flood >= 3 ? "Heavy rain may bring dangerous flash flooding nearby." : flood === 2 ? "Heavy rain is more likely than usual to flood streets and creeks nearby." : "Heavy rain could flood streets and creeks nearby."}${rain}`,
      source: sources.join(" · ") || "NWS rain forecast",
    });
  }

  const storm = stormLevel(official.spc);
  if (storm > 0 && official.spc) {
    out.push({
      kind: "storm",
      level: storm as WeekLevel,
      title: "Storms",
      plain: official.spc.kind === "tornado" ? `Severe storms are possible, and a tornado cannot be ruled out nearby (${official.spc.percent}% chance within 25 miles).` : `Severe storms are possible nearby (${official.spc.percent}% chance within 25 miles).`,
      source: `SPC ${official.spc.kind === "tornado" ? "Tornado Outlook" : "Day 3 Convective Outlook, any severe weather"}, ${dayWord(index, "outlook")}: ${official.spc.percent}%`,
    });
  }

  const wind = windLevel(forecast.gustMph);
  if (wind > 0 && forecast.gustMph !== null) {
    out.push({ kind: "wind", level: wind as WeekLevel, title: "Strong wind", plain: `Gusts up to ${Math.round(forecast.gustMph)} mph, enough to bring down branches and lift loose objects.`, source: "NWS hourly wind gust forecast" });
  }

  return out.sort((a, b) => b.level - a.level);
}
