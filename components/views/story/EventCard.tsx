"use client";

import { forwardRef } from "react";
import { IMPACT_PHRASE } from "@/lib/ai/story-labels";
import type { VerifiedImpact } from "@/lib/ai/types";
import type { AreaEvent } from "@/lib/types";
import { eventHarm, tierLabel, zoneLabel } from "@/lib/ui/story-model";
import { niceDate } from "@/lib/ui/text";

/**
 * One event, in the National Weather Service's own words: what was recorded (deaths, injuries, damage), the narrative word for word,
 * the wider storm's narrative behind a disclosure, and the impacts the AI tagged ONLY where the narrative says them, each with the
 * words that show it.
 */
export const EventCard = forwardRef<HTMLElement, { event: AreaEvent; impacts: readonly VerifiedImpact[]; onClose: () => void; currentZoneCode?: string | null }>(function EventCard({ event, impacts, onClose, currentZoneCode }, ref) {
  const harm = eventHarm(event);
  const own = event.narrative.trim();
  const episode = event.episodeNarrative.trim();
  const where = tierLabel(event, currentZoneCode) ?? zoneLabel(event.area.name) ?? event.area.code;
  return (
    <section className="eventcard" ref={ref} tabIndex={-1} aria-label={`${event.type}, ${niceDate(event.start)}`}>
      <div className="src-head">
        <span className="src-kind">{event.type}</span>
        <button type="button" className="src-x" onClick={onClose}>
          Close<span className="sr"> event</span>
        </button>
      </div>
      <p className="src-title">{niceDate(event.start)}</p>
      <p className="src-origin">
        {where} · NCEI Storm Events{harm ? ` · ${harm}` : " · no deaths, injuries or damage figure recorded"}
        {event.magnitude ? ` · magnitude ${event.magnitude}` : ""}
      </p>
      {own ? <blockquote className="src-quote ev-quote">{own}</blockquote> : <p className="note">The National Weather Service wrote no narrative for this event.</p>}
      {episode && episode !== own ? (
        <details className="ev-episode">
          <summary>The wider storm, in the NWS’s words</summary>
          <blockquote className="src-quote ev-quote">{episode}</blockquote>
        </details>
      ) : null}
      {impacts.length > 0 ? (
        <div className="ev-impacts">
          <p className="src-origin">Tagged by the AI only where the narrative says so:</p>
          <ul>
            {impacts.map((impact) => (
              <li key={impact.tag}>
                <b>{IMPACT_PHRASE[impact.tag]}</b>
                <span>“{impact.evidence}”</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {event.id.startsWith("SE-") ? (
        <a className="src-link" href={`https://www.ncdc.noaa.gov/stormevents/eventdetails.jsp?id=${event.id.replace(/^SE-/, "")}`} target="_blank" rel="noopener noreferrer">
          Open the NCEI record<span className="sr"> (opens in a new tab)</span>
        </a>
      ) : null}
    </section>
  );
});
