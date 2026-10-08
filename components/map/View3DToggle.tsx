"use client";

import { useId } from "react";

/**
 * The "3D" switch on the map. Off by default (2D is the map). A real toggle button: aria-pressed, keyboard operable, and its visible
 * text "3D" is part of its accessible name.
 */
export function View3DToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const hint = useId();
  return (
    <>
      <button type="button" id="view3d" className="map-toggle" aria-pressed={on} aria-describedby={hint} onClick={onToggle}>
        <span aria-hidden="true" className="mt-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" focusable="false">
            <path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9z" />
            <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
          </svg>
        </span>
        <span>3D</span>
        <span className="sr"> view</span>
      </button>
      <span className="sr" id={hint}>
        {on ? "On. Tilts the map to show hills and buildings. Press to go back to the flat map." : "Off. Tilts the map to show hills and buildings. The radar, reports and tornado paths follow the ground."}
      </span>
    </>
  );
}
