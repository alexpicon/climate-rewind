export const TABS = ["ahead", "storm", "heat", "tornado", "how"] as const;
export type Tab = (typeof TABS)[number];

export const TAB_LABEL: Record<Tab, string> = {
  ahead: "Next 72 hours",
  storm: "Storm replay",
  heat: "Heat wave",
  tornado: "Tornadoes",
  how: "How it works",
};

/** Short labels for the bottom tab bar on a phone (five tabs share 390 px). The full label stays the link's accessible name. */
export const TAB_SHORT: Record<Tab, string> = {
  ahead: "72 hours",
  storm: "Storm",
  heat: "Heat",
  tornado: "Tornado",
  how: "How",
};

/** The tab a lookup opens on when the link names none: the AI briefing and the official outlooks. The storm replay is one click away. */
export const DEFAULT_TAB: Tab = "ahead";

export function parseTab(value: string | undefined | null): Tab {
  return TABS.find((tab) => tab === value) ?? DEFAULT_TAB;
}

/** Tabs whose map has the optional 3D view. */
export const HAS_3D: readonly Tab[] = ["storm", "tornado"];

/** A shareable URL for an address, a tab, (optionally) a storm night from the picker, and the 3D view if it is on. */
export function viewUrl(address: string | null, tab: Tab, night: string | null = null, view3d = false): string {
  const params = new URLSearchParams();
  if (address) params.set("address", address);
  // With no address the bare "/" is the landing page, whichever of the two opening tabs is meant.
  if (address || (tab !== "storm" && tab !== DEFAULT_TAB)) params.set("tab", tab);
  if (address && night) params.set("night", night);
  if (address && view3d && HAS_3D.includes(tab)) params.set("view", "3d");
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

export const SAMPLE_ADDRESSES = [
  { label: "Nashville, TN", detail: "Downtown, near the Cumberland River", address: "100 James Robertson Pkwy, Nashville, TN" },
  { label: "San Antonio, TX", detail: "Downtown, Military Plaza", address: "100 Military Plaza, San Antonio, TX" },
  { label: "Asheville, NC", detail: "River Arts District", address: "350 Riverside Dr, Asheville, NC" },
  { label: "Bellevue, WA", detail: "2021 heat dome", address: "450 110th Ave NE, Bellevue, WA" },
] as const;
