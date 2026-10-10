/**
 * The local half of a plan: the facts the AI may cite, built from this address's own record. Each fact has a stable id (a real NCEI/NWS
 * event id, or a "local-..." id for a number counted here) and the exact words the verifier checks the AI against. Totals and counts are
 * worked out HERE, in code, so the model copies numbers instead of calculating them.
 */
import { localMoment, pickReports } from "../ai/sources";
import type { AiSource } from "../ai/types";
import type { HeatSummary, NearbyFlood, NearbyTornado } from "../types";
import { dayHighWords, heatHighWords, heatLabels } from "../ui/data-source";
import { excerpt, niceDate } from "../ui/text";
import { hazardOfType, type AreaEvent } from "./events";
import type { HazardId, HazardSummary, LocalFact } from "./types";

export const MAX_FLOOD_REPORTS = 4;
export const MAX_TORNADOES = 3;
export const MAX_EVENTS_PER_HAZARD = 3;
export const MAX_EVENTS = 10;

const sanitize = (text: string) => text.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
/** NWS writes some names in capitals ("FLASH FLOOD", "DAVIDSON"): show those in ordinary capitals. Mixed-case text is left alone. */
const tidy = (text: string) => {
  const clean = sanitize(text);
  return clean === clean.toUpperCase() ? clean.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()) : clean;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const HAZARD_LABEL: Record<HazardId, string> = {
  flood: "Flooding",
  tornado: "Tornadoes",
  heat: "Extreme heat",
  wind: "Damaging wind and storms",
  winter: "Winter storms and cold",
  smoke: "Wildfire smoke",
};
export const hazardLabel = (id: HazardId): string => HAZARD_LABEL[id];

function ncdcLink(id: string): string | undefined {
  return id.startsWith("SE-") ? `https://www.ncdc.noaa.gov/stormevents/eventdetails.jsp?id=${id.replace(/^SE-/, "")}` : undefined;
}

export interface LocalInputs {
  /** False when the state's flood/tornado index is not built (the plan then rests on heat and area events only). */
  indexed: boolean;
  floods: NearbyFlood[];
  tornadoes: NearbyTornado[];
  heat: HeatSummary | null;
  /** Events recorded for this address's forecast zone or county (data/events), all types. */
  events: AreaEvent[];
}

export interface LocalFacts {
  sources: AiSource[];
  facts: Map<string, LocalFact>;
  hazards: HazardSummary[];
}

function floodFacts(floods: NearbyFlood[], out: { sources: AiSource[]; facts: LocalFact[]; evidence: Map<HazardId, string[]> }) {
  if (floods.length === 0) return;
  const dates = floods.map((f) => f.start.slice(0, 10)).sort();
  const days = new Set(dates).size;
  const closest = Math.min(...floods.map((f) => f.distanceKm));
  const onDays = days === 1 ? "on 1 day" : `on ${days} different days`;
  const evidence = `${plural(floods.length, "written NWS flood report")} within 5 km ${onDays}, latest ${niceDate(dates[dates.length - 1])}`;
  const span = dates[0] === dates[dates.length - 1] ? `on ${niceDate(dates[0])}` : `${niceDate(dates[0])} to ${niceDate(dates[dates.length - 1])}`;
  out.evidence.set("flood", [...(out.evidence.get("flood") ?? []), evidence]);
  out.sources.push({
    id: "local-flood-count",
    kind: "history",
    chip: "Flood reports nearby",
    title: `Flood reports within 5 km of this address, ${span}`,
    origin: "NCEI Storm Events and NWS Local Storm Reports, 2015 to 2025",
    text: `${plural(floods.length, "written NWS flood report")} within 5 km of this address, ${onDays}. The closest was ${closest.toFixed(1)} km away. A report is a written NWS report of flooding, not a measure of how deep the water was.`,
  });
  out.facts.push({ id: "local-flood-count", label: `${floods.length} flood reports within 5 km, ${span}`, hazard: "flood" });

  for (const report of pickReports(floods, MAX_FLOOD_REPORTS)) {
    const label = `${tidy(report.type)} report, ${niceDate(report.start)}`;
    out.sources.push({
      id: report.id,
      kind: "report",
      chip: "NWS flood report",
      title: label,
      origin: report.source === "StormEvents" ? "NCEI Storm Events" : "NWS Local Storm Report",
      text: `${tidy(report.type)} report, ${localMoment(report.start)}, ${tidy(report.city || report.county)}, ${tidy(report.county)} County. It is ${report.distanceKm.toFixed(1)} km from this address.`,
      quote: sanitize(report.quote),
      href: ncdcLink(report.id),
    });
    out.facts.push({ id: report.id, label, hazard: "flood", href: ncdcLink(report.id) });
  }
}

function tornadoFacts(tornadoes: NearbyTornado[], out: { sources: AiSource[]; facts: LocalFact[]; evidence: Map<HazardId, string[]> }) {
  if (tornadoes.length === 0) return;
  const nearest = [...tornadoes].sort((a, b) => a.minDistanceKm - b.minDistanceKm);
  const latest = [...tornadoes].sort((a, b) => b.start.localeCompare(a.start))[0];
  out.evidence.set("tornado", [`${plural(tornadoes.length, "tornado track")} within 10 km, latest ${niceDate(latest.start)}`]);
  for (const t of nearest.slice(0, MAX_TORNADOES)) {
    const casualties = [t.deaths ? plural(t.deaths, "death") : "", t.injuries ? plural(t.injuries, "injury", "injuries") : ""].filter(Boolean).join(" and ");
    const label = `${t.ef} tornado, ${niceDate(t.start)}`;
    out.sources.push({
      id: t.id,
      kind: "tornado",
      chip: `${t.ef} tornado`,
      title: label,
      origin: "NCEI Storm Events",
      text: `${t.ef} tornado on ${niceDate(t.start)}. Its track passed ${t.minDistanceKm.toFixed(1)} km from this address. Recorded width up to ${t.widthYd} yards and length ${t.lengthMi} miles${casualties ? `; ${casualties} recorded for the county part of the track` : ""}.`,
      quote: sanitize(excerpt(t.narrative, 360).text),
      href: ncdcLink(t.id),
    });
    out.facts.push({ id: t.id, label, hazard: "tornado", href: ncdcLink(t.id) });
  }
}

function heatFacts(heat: HeatSummary | null, out: { sources: AiSource[]; facts: LocalFact[]; evidence: Map<HazardId, string[]> }) {
  if (!heat) return;
  const years = Object.keys(heat.byYear).sort();
  const hotYears = years.filter((y) => heat.byYear[y] > 0);
  const total = hotYears.reduce((sum, y) => sum + heat.byYear[y], 0);
  // Heat is a hazard here only if the record has a day this hot: otherwise the plan would invent a risk.
  if (total === 0) return;
  const first = years[0];
  const last = years[years.length - 1];
  const list = hotYears.map((y) => `${y}: ${plural(heat.byYear[y], "day")}`).join("; ");
  const measure = heatLabels(heat).measure;
  const high = heatHighWords(heat);
  const hottest = dayHighWords(heat.hottest, measure);
  out.evidence.set("heat", [`${plural(total, "day")} with a ${high.short} of 100°F or more in ${hotYears.length} of ${years.length} years (${first} to ${last}); hottest ${hottest} on ${niceDate(heat.hottest.date)}`]);
  const label = `Hottest day on record, ${niceDate(heat.hottest.date)} (${hottest})`;
  out.sources.push({
    id: "local-heat",
    kind: "heat",
    chip: "Heat record",
    title: label,
    origin: high.rule ? `Open-Meteo weather archive (ERA5), daily highs: ${high.rule}` : "Open-Meteo weather archive (ERA5), daily feels-like highs",
    text: `Days with a ${high.short} of 100°F or more at this address${high.rule ? ` (${high.rule})` : ""}, ${first} to ${last}: ${plural(total, "day")} in total. By year: ${list}. The hottest day was ${niceDate(heat.hottest.date)}, at ${hottest}.`,
  });
  out.facts.push({ id: "local-heat", label, hazard: "heat" });
}

function eventRank(a: AreaEvent, b: AreaEvent): number {
  const hurt = (e: AreaEvent) => (e.deaths ?? 0) * 10 + (e.injuries ?? 0);
  return hurt(b) - hurt(a) || (b.damageUsd ?? 0) - (a.damageUsd ?? 0) || b.start.localeCompare(a.start);
}

function eventFacts(events: AreaEvent[], taken: ReadonlySet<string>, out: { sources: AiSource[]; facts: LocalFact[]; evidence: Map<HazardId, string[]> }) {
  const byHazard = new Map<HazardId, AreaEvent[]>();
  for (const event of events) {
    const hazard = hazardOfType(event.type);
    if (!hazard) continue;
    byHazard.set(hazard, [...(byHazard.get(hazard) ?? []), event]);
  }
  let used = 0;
  for (const [hazard, list] of byHazard) {
    const sorted = [...list].sort(eventRank);
    const latest = [...list].sort((a, b) => b.start.localeCompare(a.start))[0];
    const where = latest.area.name ? tidy(latest.area.name) : latest.area.code;
    const counts = new Map<string, number>();
    for (const e of list) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    const kinds = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([type, n]) => `${n} ${sanitize(type)}`).join(" and ");
    const evidence = `${kinds} ${list.length === 1 ? "event" : "events"} recorded for ${where} since ${list.map((e) => e.start.slice(0, 4)).sort()[0]} (NCEI Storm Events), latest ${niceDate(latest.start)}`;
    out.evidence.set(hazard, [...(out.evidence.get(hazard) ?? []), evidence]);
    for (const event of sorted.slice(0, MAX_EVENTS_PER_HAZARD)) {
      if (used >= MAX_EVENTS || taken.has(event.id)) continue;
      used += 1;
      const label = `${sanitize(event.type)}, ${niceDate(event.start)}`;
      const effects = [
        event.deaths ? plural(event.deaths, "death") : "",
        event.injuries ? plural(event.injuries, "injury", "injuries") : "",
        event.damageUsd ? `${money(event.damageUsd)} in property and crop damage` : "",
      ].filter(Boolean);
      const narrative = event.narrative?.trim() || event.episodeNarrative?.trim() || "";
      out.sources.push({
        id: event.id,
        kind: "history",
        chip: sanitize(event.type),
        title: label,
        origin: "NCEI Storm Events, recorded for the area this address is in",
        text: `${sanitize(event.type)}, ${localMoment(event.start)}, recorded for ${tidy(event.area.name || event.area.code)} (${event.area.kind === "Z" ? "NWS forecast zone" : "county"}), the area this address is in; not necessarily at this exact address.${effects.length ? ` Recorded: ${effects.join(", ")}.` : ""}`,
        ...(narrative ? { quote: sanitize(excerpt(narrative, 360).text) } : {}),
        href: ncdcLink(event.id),
      });
      out.facts.push({ id: event.id, label, hazard, href: ncdcLink(event.id) });
    }
  }
}

/** Everything the plan may cite from this address's record, and the per-hazard summary the page shows even when the AI is resting. */
export function buildLocalFacts(input: LocalInputs): LocalFacts {
  const out = { sources: [] as AiSource[], facts: [] as LocalFact[], evidence: new Map<HazardId, string[]>() };
  floodFacts(input.floods, out);
  tornadoFacts(input.tornadoes, out);
  heatFacts(input.heat, out);
  // An event the index already gave us (same id) is not listed twice.
  eventFacts(input.events, new Set(out.sources.map((s) => s.id)), out);

  const order: HazardId[] = ["flood", "tornado", "heat", "wind", "winter", "smoke"];
  const hazards: HazardSummary[] = order
    .filter((id) => out.evidence.has(id))
    .map((id) => ({ id, label: HAZARD_LABEL[id], evidence: (out.evidence.get(id) as string[]).join("; ") }));
  return { sources: out.sources, facts: new Map(out.facts.map((f) => [f.id, f])), hazards };
}
