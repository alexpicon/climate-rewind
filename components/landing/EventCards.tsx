"use client";

import { EVENTS, eventPath } from "@/lib/ui/event-catalog";
import { EventPreview } from "./EventPreview";

/** The landing page's storm replays: each card previews its wind and opens the full replay, already playing. */
export function EventCards() {
  return (
    <ul className="ev-cards" aria-labelledby="storms-h">
      {EVENTS.map((e) => (
        <li key={e.id} className="ev-card">
          <EventPreview id={e.id} />
          <div className="ev-card-body">
            <p className="mo-k">{e.when}</p>
            <h3 className="mo-t">{e.title}</h3>
            <p className="mo-l">{e.hook}</p>
            <p className="ev-card-src">Preview: NOAA HRRR model gusts, hour by hour{e.kind === "hurricane" ? ", the official track" : ""}, and the storm reports as filed.</p>
            <a className="feat-go mo-go" href={eventPath(e.id)}>
              Watch the replay
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}
