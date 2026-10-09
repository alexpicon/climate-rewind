/**
 * The pieces of "Your area's story" that are plain logic: which family an event type belongs to (its color AND its shape, so the
 * timeline never relies on color alone), where a dot goes on the timeline, and the one-line facts and quiet-address sentences.
 * No React, so it is tested directly.
 */
import { NEARBY_ZONE_KM } from "../constants";
import type { AddressExtremes, AreaEvent, AreaZoneInfo, NearbyFlood, QuietPlacement } from "../types";
import { niceDate, placeName } from "./text";

export type Family = "wind" | "water" | "winter" | "heat" | "storm" | "other";

export interface FamilyStyle {
  label: string;
  /** A color that reads on the dark panel (4.5:1 or better against #0b1226). */
  color: string;
  shape: "circle" | "diamond" | "square" | "triangle" | "cross" | "ring";
}

export const FAMILIES: Record<Family, FamilyStyle> = {
  wind: { label: "Wind", color: "#7FD1FF", shape: "circle" },
  water: { label: "Rain and flooding", color: "#6FA8FF", shape: "diamond" },
  winter: { label: "Snow and ice", color: "#D6E4FF", shape: "square" },
  heat: { label: "Heat and smoke", color: "#FFB45A", shape: "triangle" },
  storm: { label: "Thunderstorm, hail, tornado", color: "#E59BFF", shape: "cross" },
  other: { label: "Other", color: "#B8C2D6", shape: "ring" },
};

export const FAMILY_ORDER: Family[] = ["wind", "water", "winter", "heat", "storm", "other"];

const FAMILY_BY_WORD: Array<[RegExp, Family]> = [
  [/tornado|funnel|waterspout|hail|lightning|thunderstorm|dust devil/i, "storm"],
  [/flood|heavy rain|debris flow|storm surge|tsunami|seiche|surf|rip current|sneakerwave|lakeshore/i, "water"],
  [/snow|blizzard|ice|winter|freez|frost|cold|chill|sleet|avalanche|lake-effect/i, "winter"],
  [/heat|drought|wildfire|smoke|dust storm|fire/i, "heat"],
  [/wind|gale|hurricane|tropical|typhoon/i, "wind"],
];

export function familyOf(type: string): Family {
  for (const [pattern, family] of FAMILY_BY_WORD) if (pattern.test(type)) return family;
  return "other";
}

// ---------------------------------------------------------------- the timeline

export interface TimelineDot {
  id: string;
  type: string;
  family: Family;
  /** 0 to 100, share of the way from 2000-01-01 to now. */
  x: number;
  /** Lane number, 0 at the top (by family). */
  lane: number;
  /** Dot radius in the chart's units: bigger for a more severe event. */
  r: number;
  label: string;
}

const startMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** "Heavy Rain, Jan 14, 2000, 15 injuries" */
export function eventLabel(event: AreaEvent): string {
  return `${event.type}, ${niceDate(event.start)}${eventHarm(event) ? `, ${eventHarm(event)}` : ""}`;
}

/** "1 death, 15 injuries, $14 million damage" or "". */
export function eventHarm(event: Pick<AreaEvent, "deaths" | "injuries" | "damageUsd">): string {
  const parts = [
    event.deaths > 0 ? `${event.deaths} ${event.deaths === 1 ? "death" : "deaths"}` : "",
    event.injuries > 0 ? `${event.injuries} ${event.injuries === 1 ? "injury" : "injuries"}` : "",
    event.damageUsd > 0 ? `${money(event.damageUsd)} damage` : "",
  ].filter(Boolean);
  return parts.join(", ");
}

export function money(amount: number): string {
  if (amount >= 1_000_000) return `$${Math.round((amount / 1_000_000) * 10) / 10} million`;
  if (amount >= 1000) return `$${Math.round(amount / 1000).toLocaleString("en-US")} thousand`;
  return `$${Math.round(amount)}`;
}

/**
 * Positions events on a 2000-to-now timeline. Only the family lanes that have events are used, in a fixed order, so a lane means
 * the same thing for every address. `weight` is each event's severity score, for the dot size.
 */
export function timelineDots(events: readonly AreaEvent[], weight: (e: AreaEvent) => number, now: Date, fromYear = 2000): { dots: TimelineDot[]; lanes: Family[] } {
  const from = Date.UTC(fromYear, 0, 1);
  const span = Math.max(1, now.getTime() - from);
  const lanes = FAMILY_ORDER.filter((family) => events.some((e) => familyOf(e.type) === family));
  const max = Math.max(1, ...events.map(weight));
  const dots = events.map((event) => {
    const family = familyOf(event.type);
    const x = Math.min(100, Math.max(0, ((startMs(event.start) - from) / span) * 100));
    return {
      id: event.id,
      type: event.type,
      family,
      x: Math.round(x * 100) / 100,
      lane: lanes.indexOf(family),
      r: Math.round((3 + 4 * Math.sqrt(Math.max(0, weight(event)) / max)) * 10) / 10,
      label: eventLabel(event),
    };
  });
  return { dots, lanes };
}

/** Year ticks for the axis: every 5 years from 2000. */
export function axisTicks(now: Date, fromYear = 2000, step = 5): Array<{ year: number; x: number }> {
  const from = Date.UTC(fromYear, 0, 1);
  const span = Math.max(1, now.getTime() - from);
  const ticks: Array<{ year: number; x: number }> = [];
  for (let year = fromYear; Date.UTC(year, 0, 1) <= now.getTime(); year += step) ticks.push({ year, x: ((Date.UTC(year, 0, 1) - from) / span) * 100 });
  return ticks;
}

// ---------------------------------------------------------------- quiet-address sentences

/** "None on your street. The closest was 12.4 km away in 2019." Null when there is no such report. */
export function nearestFloodLine(nearest: Pick<NearbyFlood, "distanceKm" | "start"> | null | undefined): string | null {
  if (!nearest) return null;
  const km = nearest.distanceKm < 10 ? nearest.distanceKm.toFixed(1) : String(Math.round(nearest.distanceKm));
  return `None on your street. The closest was ${km} km away, in ${nearest.start.slice(0, 4)}.`;
}

/**
 * Where an address sits among the places we sampled, said positively and truthfully. "Quieter than" is used only when it is true of
 * at least half of them; with none, the honest comparison is the share that also had none; and with a few reports in a place where
 * most sampled points have none, the line says reports are sparse rather than calling the address quiet.
 */
export function quietLine(q: QuietPlacement | null | undefined): string | null {
  if (!q) return null;
  const sample = q.sample.toLocaleString("en-US");
  if (q.count === 0 && q.samePct > 0) return `No flood report within 5 km, like ${q.samePct}% of the ${sample} places we sampled across ${q.states} states.`;
  if (q.quieterThanPct >= 50) return `Quieter than ${q.quieterThanPct}% of the ${sample} places we sampled across ${q.states} states.`;
  return `${q.nonePct}% of the ${sample} places we sampled across ${q.states} states have no flood report within 5 km, so reports are sparse in our records.`;
}

/** The three records, as plain phrases for the extremes card; a missing one is left out. */
export function extremeItems(x: AddressExtremes | null | undefined): Array<{ key: "wettest" | "windiest" | "hottest"; label: string; value: string; date: string }> {
  if (!x) return [];
  const items: Array<{ key: "wettest" | "windiest" | "hottest"; label: string; value: string; date: string }> = [];
  if (x.wettest) items.push({ key: "wettest", label: "Wettest day", value: `${x.wettest.inches} in of rain`, date: niceDate(x.wettest.date) });
  if (x.windiest) items.push({ key: "windiest", label: x.windiest.measure === "gust" ? "Windiest day" : "Windiest day (sustained)", value: `${x.windiest.mph} mph ${x.windiest.measure === "gust" ? "gust" : "wind"}`, date: niceDate(x.windiest.date) });
  if (x.hottest) items.push({ key: "hottest", label: "Hottest day", value: `${x.hottest.feelsF}°F feels-like`, date: niceDate(x.hottest.date) });
  return items;
}

/** Where an event belongs, in words: "Your zone: Bellevue and Vicinity", "Nearby zone: Seattle and Vicinity", or null for a county row. Never colour alone. */
export function tierLabel(event: Pick<AreaEvent, "tier" | "zoneName"> & { area?: { code: string } }, currentCode?: string | null): string | null {
  if (event.tier !== "your zone" && event.tier !== "nearby zone") return null;
  const name = zoneLabel(event.zoneName ?? null);
  // An event filed under an earlier number for the address's place: say so, so "your zone" never shows two different names.
  if (event.tier === "your zone" && currentCode && event.area && event.area.code !== currentCode) return name ? `Your zone, filed then as ${name}` : "Your zone, filed under an earlier number";
  const head = event.tier === "your zone" ? "Your zone" : "Nearby zone";
  return name ? `${head}: ${name}` : head;
}

/**
 * One sentence on which zones the count covers: "Your zone: Bellevue and Vicinity. Also counted, within 15 km: Seattle and Vicinity
 * (3.8 km away)." Null when the state has no zone outlines. Retired zone numbers repeat a name, so each name is said once, and a nearby name already given as yours is not repeated.
 */
export function zonesLine(zones: readonly AreaZoneInfo[] | undefined): string | null {
  if (!zones || zones.length === 0) return null;
  const names = (tier: AreaZoneInfo["tier"]) => {
    const seen = new Map<string, number>();
    for (const z of zones.filter((x) => x.tier === tier)) {
      const label = zoneLabel(z.name) ?? z.code;
      seen.set(label, Math.min(seen.get(label) ?? Infinity, z.distanceKm));
    }
    return [...seen];
  };
  const yours = names("your zone").map(([label]) => label);
  // A zone NWS redrew keeps its name under a new number; if its older outline holds the address, the newer one is not "also" anything.
  const near = names("nearby zone")
    .filter(([label]) => !yours.includes(label))
    .map(([label, km]) => `${label} (${km < 1 ? "under 1" : Math.round(km)} km away)`);
  return [yours.length ? `Your zone: ${yours.join(", ")}.` : "", near.length ? `Also counted, within ${NEARBY_ZONE_KM} km: ${near.join(", ")}.` : ""].filter(Boolean).join(" ") || null;
}

/**
 * The ONE zone to call "your zone": of the zones whose outline holds the address, the one NWS used most recently (the latest validTo;
 * a tie goes to the higher code). Older numbers for the same place are retired outlines and are told under "More".
 */
export function currentZone(zones: readonly AreaZoneInfo[] | undefined): AreaZoneInfo | null {
  const yours = (zones ?? []).filter((z) => z.tier === "your zone");
  if (yours.length === 0) return null;
  return [...yours].sort((a, b) => (b.validTo ?? "").localeCompare(a.validTo ?? "") || (a.code < b.code ? 1 : -1))[0];
}

/** The rest of the zone names the count covers: earlier names for the address's place, then nearby zones. Null when there are none. */
export function otherZonesLine(zones: readonly AreaZoneInfo[] | undefined): string | null {
  const now = currentZone(zones);
  if (!zones || !now) return zones && zones.length ? zonesLine(zones) : null;
  const nowLabel = zoneLabel(now.name) ?? now.code;
  const earlier = [...new Set(zones.filter((z) => z.tier === "your zone" && z.code !== now.code).map((z) => zoneLabel(z.name) ?? z.code))].filter((label) => label !== nowLabel);
  const near = new Map<string, number>();
  for (const z of zones.filter((x) => x.tier === "nearby zone")) {
    const label = zoneLabel(z.name) ?? z.code;
    if (label === nowLabel || earlier.includes(label)) continue;
    near.set(label, Math.min(near.get(label) ?? Infinity, z.distanceKm));
  }
  const nearText = [...near].map(([label, km]) => `${label} (${km < 1 ? "under 1" : Math.round(km)} km away)`);
  const parts = [
    earlier.length ? `Earlier names or numbers NWS used for the same place, counted too: ${earlier.join(", ")}.` : "",
    nearText.length ? `Nearby zones within ${NEARBY_ZONE_KM} km, counted and marked “nearby”: ${nearText.join(", ")}.` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** "Seattle And Vicinity" -> "Seattle and Vicinity": the NWS zone name in sentence-friendly case. */
export function zoneLabel(name: string | null): string | null {
  if (!name) return null;
  return placeName(name).replace(/\b(And|Of|The|In|On|To)\b/g, (w) => w.toLowerCase());
}
