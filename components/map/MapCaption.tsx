"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

/**
 * The small card on the map that says what is drawn and where it comes from. The title is a button that opens and closes the card: open on a
 * wide screen, closed on a phone (where the panel and the map share the screen). Everything drawn on the map is also said in words in the card
 * or in the panel.
 */
export function MapCaption({ title, summary, controls, keys, source }: { title: string; summary: ReactNode; controls?: ReactNode; keys?: ReactNode; source: ReactNode }) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  useEffect(() => {
    if (window.matchMedia("(max-width: 900px)").matches) setOpen(false);
  }, []);
  return (
    <aside className={`mapcap glass${open ? " open" : ""}`} aria-label={`Map: ${title}`}>
      <h2>
        <button type="button" className="mapcap-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5z" />
            <path d="M9 4v13M15 6.5v13" />
          </svg>
          <span>{title}</span>
          <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h2>
      <div id={bodyId} className="mapcap-body" hidden={!open}>
        {controls}
        <p className="mapcap-sum" role="status">
          {summary}
        </p>
        {keys}
        <p className="src">{source}</p>
      </div>
    </aside>
  );
}
