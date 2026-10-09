"use client";

import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
import { viewUrl, type Tab } from "@/lib/ui/tabs";

/** What a card inside a view can ask the app shell to do without a page load. */
export interface AppNav {
  goTab: (tab: Tab) => void;
  openAddress: (address: string, tab: Tab) => void;
}

const NavContext = createContext<AppNav | null>(null);
export const NavProvider = NavContext.Provider;

/**
 * A real link (it works without script and can be opened in a new tab) that the app shell takes over for a plain click, so the
 * panel changes in place like the tab bar does.
 */
export function NavLink({ address, tab, to, className, children }: { address: string; tab: Tab; to?: string; className?: string; children: ReactNode }) {
  const nav = useContext(NavContext);
  const target = to ?? address;
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!nav || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    if (to) nav.openAddress(to, tab);
    else nav.goTab(tab);
  };
  return (
    <a className={className} href={viewUrl(target, tab)} onClick={onClick}>
      {children}
    </a>
  );
}
