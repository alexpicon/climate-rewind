/**
 * Turns an area's events into sources the model may cite: one per event (its id is the event id, its verbatim narrative is the quote)
 * and one for the area's totals. Shared by the area story and the 72-hour brief. No server-only imports, so it can sit under both.
 */
import { STORY_EVENTS } from "../constants";
import { rankBySeverity, topDistinctEpisodes } from "../event-severity";
import type { AreaEvent, AreaEventsSummary } from "../types";
import { niceDate, placeName } from "../ui/text";
import type { AiSource } from "./types";

export const COUNTS_SOURCE_ID = "area-counts";

const num = (n: number) => n.toLocaleString("en-US");
const sanitize = (text: string) => text.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();

/** "$1,500,000 (about $1.5 million)": both forms are in the source, so the model can copy either and the number check passes. */
export function usd(amount: number): string {
  if (amount >= 1_000_000_000) return `$${num(amount)} (about $${Math.round(amount / 10_000_000) / 100} billion)`;
  if (amount >= 1_000_000) {
    const millions = Math.round((amount / 1_000_000) * 10) / 10;
    return `$${num(amount)} (about $${millions} million)`;
  }
  return `$${num(amount)}`;
}

/** A short dollar figure for the totals line: "$72 million", "$450,000". */
export function usdShort(amount: number): string {
  if (amount >= 1_000_000_000) return `$${Math.round(amount / 10_000_000) / 100} billion`;
  if (amount >= 1_000_000) return `$${Math.round((amount / 1_000_000) * 10) / 10} million`;
  return `$${num(Math.round(amount))}`;
}

// ---------------------------------------------------------------- which events, and their sources

/** The events the story is about: the most severe, one per episode, oldest first. */
export function storyEvents(summary: AreaEventsSummary, limit: number = STORY_EVENTS): AreaEvent[] {
  return topDistinctEpisodes(rankBySeverity(summary.top), limit).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1));
}

/** The text the model reads for an event: its own narrative, plus the episode's if its own is thin. About 900 characters. */
export function eventQuote(event: AreaEvent, max = 900): string {
  const own = sanitize(event.narrative);
  const episode = sanitize(event.episodeNarrative);
  const text = own.length >= 80 || !episode ? own : `${own} ${episode}`.trim();
  if (text.length <= max) return text;
  // Cut on a sentence end so a quotation never stops mid-word; what is left out is simply not offered.
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "")).trim();
}

/** Whose event it is, in words the model can repeat: the county, "your zone", or a nearby zone by name. */
export function whereText(event: AreaEvent): string {
  const name = sanitize(event.zoneName ?? event.area.name) || event.area.code;
  if (event.tier === "nearby zone") return `${name} (forecast zone ${event.area.code}, a NEARBY zone within 15 km, not the zone the address is in)`;
  if (event.tier === "your zone") return `${name} (forecast zone ${event.area.code}, YOUR zone: the address is inside it)`;
  return `${name} (${event.area.kind === "Z" ? "forecast zone" : "county"} ${event.area.code})`;
}

export function eventSource(event: AreaEvent): AiSource {
  const where = whereText(event);
  const facts = [
    `${sanitize(event.type)} on ${niceDate(event.start)} in ${where}.`,
    `Deaths: ${event.deaths}. Injuries: ${event.injuries}.`,
    event.damageUsd > 0 ? `Recorded damage: ${usd(event.damageUsd)}.` : "No damage figure was recorded.",
    event.magnitude ? `Recorded magnitude: ${event.magnitude}${event.magnitudeType ? ` (${event.magnitudeType})` : ""}.` : "",
  ].filter(Boolean);
  return {
    id: event.id,
    kind: "event",
    chip: `${sanitize(event.type)} ${event.start.slice(0, 4)}`,
    title: `${sanitize(event.type)}, ${niceDate(event.start)}`,
    origin: "NCEI Storm Events, as filed by the National Weather Service",
    text: facts.join(" "),
    quote: eventQuote(event) || undefined,
    href: event.id.startsWith("SE-") ? `https://www.ncei.noaa.gov/access/storm-events-database/event-details/${event.id.replace(/^SE-/, "")}` : undefined,
  };
}

export function countsSource(summary: AreaEventsSummary): AiSource {
  const types = Object.entries(summary.counts)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 12)
    .map(([type, n]) => `${type} ${num(n)}`);
  const area = summary.county ? `${summary.countyName ? `${placeName(sanitize(summary.countyName))} County ` : "county "}(${summary.county}), the forecast zone the address is in and zones within 15 km of it` : "this area";
  return {
    id: COUNTS_SOURCE_ID,
    kind: "history",
    chip: "Area totals",
    title: "Weather events recorded in this area",
    origin: "NCEI Storm Events, county and forecast-zone rows",
    text: `The National Weather Service recorded ${num(summary.total)} weather events in ${area} since ${summary.since}. By type: ${types.join(", ")}. These are filed events, not every storm that happened.`,
  };
}

