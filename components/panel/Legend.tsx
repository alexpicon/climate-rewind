"use client";

import { useId, useState, type ReactNode } from "react";

/** The legend lives behind a small key button and opens on click or keyboard. */
export function Legend({ children, label = "Key" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div id="legend-wrap">
      <button
        type="button"
        className="legend-btn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <circle cx="8" cy="7" r="2.2" />
          <path d="M13 7h8" />
          <circle cx="8" cy="17" r="2.2" />
          <path d="M13 17h8" />
        </svg>
        {label}
      </button>
      <div id={panelId} className="glass legend-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
