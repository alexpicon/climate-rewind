"use client";

import { useContext } from "react";
import { NavContext } from "@/components/nav-context";
import { HISTORY_LABEL, HISTORY_VIEWS, viewUrl, type HistoryView } from "@/lib/ui/tabs";

/**
 * The segmented control inside "Your history": Story, Storm replay, Heat wave, Tornadoes. Four real links (each is a shareable URL and
 * works without script); a plain click changes the view in place. The current one is marked with aria-current, never by color alone.
 */
export function HistoryNav({ current, address }: { current: HistoryView; address: string }) {
  const nav = useContext(NavContext);
  return (
    <nav className="seg" aria-label="Your history: choose a view">
      {HISTORY_VIEWS.map((view) => (
        <a
          key={view}
          href={viewUrl(address, view)}
          aria-current={view === current ? "page" : undefined}
          onClick={(event) => {
            if (!nav || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            if (view !== current) nav.goTab(view);
          }}
        >
          {HISTORY_LABEL[view]}
        </a>
      ))}
    </nav>
  );
}
