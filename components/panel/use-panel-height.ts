"use client";

import { useEffect } from "react";

/**
 * Publishes the story panel's height as --panel-h, so a card that has to sit just above the panel on a phone
 * (the step 2 report card) can be placed against it instead of guessing. Removed when the view goes away.
 */
export function usePanelHeight(): void {
  useEffect(() => {
    const panel = document.getElementById("panel");
    if (!panel) return;
    const set = () => document.documentElement.style.setProperty("--panel-h", `${Math.round(panel.getBoundingClientRect().height)}px`);
    set();
    const observer = new ResizeObserver(set);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--panel-h");
    };
  }, []);
}
