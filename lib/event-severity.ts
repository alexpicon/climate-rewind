/**
 * How severe an event is and which to tell first. Pure functions over AreaEvent, safe to import from client code (the timeline sizes
 * its dots with them) and from the server (the lookup ranks with them).
 */
import type { AreaEvent } from "./types";

/** Calendar year of a local timestamp, read as written. */
export const yearOf = (iso: string): number => Number(iso.slice(0, 4));

/**
 * How severe an event is, as one number for ranking: a death outweighs an injury, an injury outweighs a dollar tier. Damage counts by
 * its order of magnitude (a $10 million event scores 16, $1 million 12, $100,000 8), a recorded magnitude adds up to 2, and a written
 * narrative adds 1 (it is what the story and the verbatim quote are made from). Not a measure of danger; a way to pick what to tell first.
 */
export function severityScore(event: AreaEvent): number {
  const damage = event.damageUsd > 0 ? Math.log10(1 + event.damageUsd / 1000) * 4 : 0;
  const magnitude = event.magnitude && event.magnitude > 0 ? Math.min(2, Math.log10(1 + event.magnitude)) : 0;
  const narrative = event.narrative.trim() || event.episodeNarrative.trim() ? 1 : 0;
  return event.deaths * 50 + event.injuries * 5 + damage + magnitude + narrative;
}

/** 0 for the address's own county and zone (or a bare row with no tier), 1 for a nearby zone, which only fills in behind them. */
export const tierRank = (event: Pick<AreaEvent, "tier">): number => (event.tier === "nearby zone" ? 1 : 0);

/**
 * What to tell first: events from the address's own zone and county before events from a nearby zone, then the most severe first.
 * Equal scores go to the newer event, then the id, so the order never changes between runs.
 */
export function rankBySeverity(events: readonly AreaEvent[]): AreaEvent[] {
  return events
    .map((event) => ({ event, score: severityScore(event) }))
    .sort((a, b) => tierRank(a.event) - tierRank(b.event) || b.score - a.score || (a.event.start < b.event.start ? 1 : a.event.start > b.event.start ? -1 : a.event.id < b.event.id ? -1 : 1))
    .map(({ event }) => event);
}

/**
 * The most severe events with at most one per episode (a single storm files one row per zone and county, and the story should not
 * tell the same night three times).
 */
export function topDistinctEpisodes(ranked: readonly AreaEvent[], limit: number): AreaEvent[] {
  const seen = new Set<string>();
  const out: AreaEvent[] = [];
  for (const event of ranked) {
    const key = event.episodeId ?? event.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
    if (out.length >= limit) break;
  }
  return out;
}
