import { AVAILABLE_OPTIONAL_TABS } from "./optional-tabs.generated";

/** Every tab id. "future" and "ready" only show up in the bar when their view files exist (see scripts/optional-views.mjs). */
export const TABS = ["ahead", "story", "storm", "heat", "tornado", "future", "ready", "how"] as const;
export type Tab = (typeof TABS)[number];

/** Tabs whose view lives in a file another person may not have written yet; they are hidden until the file exists. */
export const OPTIONAL_TABS = ["future", "ready"] as const;
export type OptionalTab = (typeof OPTIONAL_TABS)[number];

/** The tabs shown in the bar and accepted from a link. */
export const VISIBLE_TABS: readonly Tab[] = TABS.filter((tab) => !(OPTIONAL_TABS as readonly string[]).includes(tab) || (AVAILABLE_OPTIONAL_TABS as readonly string[]).includes(tab));

/** What each view is called (page titles, the panel headings). The top bar uses the four names under it. */
export const TAB_LABEL: Record<Tab, string> = {
  ahead: "Next 72 hours",
  story: "Your history: Story",
  storm: "Your history: Storm replay",
  heat: "Your history: Heat wave",
  tornado: "Your history: Tornadoes",
  future: "What’s changing",
  ready: "Get ready",
  how: "How it works",
};

/** The four top tabs. "Your history" holds four views behind a segmented control; "How it works" is a small link, not a tab. */
export const TOP_TABS = ["ahead", "history", "future", "ready"] as const;
export type TopTab = (typeof TOP_TABS)[number];

export const HISTORY_VIEWS = ["story", "storm", "heat", "tornado"] as const;
export type HistoryView = (typeof HISTORY_VIEWS)[number];

export const TOP_LABEL: Record<TopTab, string> = {
  ahead: "Next 72 hours",
  history: "Your history",
  future: "What’s changing",
  ready: "Get ready",
};

/** Short labels for a phone's bottom bar and a narrow top bar (four tabs share 390 px). The full label stays the link's accessible name. */
export const TOP_SHORT: Record<TopTab, string> = {
  ahead: "72 hours",
  history: "History",
  future: "Changing",
  ready: "Ready",
};

export const HISTORY_LABEL: Record<HistoryView, string> = {
  story: "Story",
  storm: "Storm replay",
  heat: "Heat wave",
  tornado: "Tornadoes",
};

/** The view a top tab opens (history opens on the story). */
export const TOP_TAB_VIEW: Record<TopTab, Tab> = { ahead: "ahead", history: "story", future: "future", ready: "ready" };

/** Which top tab a view belongs to; null for "How it works". */
export function topTabOf(tab: Tab): TopTab | null {
  if ((HISTORY_VIEWS as readonly string[]).includes(tab)) return "history";
  return tab === "how" ? null : (tab as TopTab);
}

export const isHistoryView = (tab: Tab): tab is HistoryView => (HISTORY_VIEWS as readonly string[]).includes(tab);

/** The top tabs shown in the bar (future and ready only when their view files exist). */
export const VISIBLE_TOP_TABS: readonly TopTab[] = TOP_TABS.filter((top) => VISIBLE_TABS.includes(TOP_TAB_VIEW[top]));

/** The tab a lookup opens on when the link names none: the AI briefing and the official outlooks. The storm replay is one click away. */
export const DEFAULT_TAB: Tab = "ahead";

/** A link's `tab` value as a view. Every old view id still works (?tab=storm is Your history, Storm replay); "history" opens the story. */
export function parseTab(value: string | undefined | null): Tab {
  if (value === "history") return "story";
  return VISIBLE_TABS.find((tab) => tab === value) ?? DEFAULT_TAB;
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

/** A sample card on the landing page: one click lands on the view its hook is about, already playing. */
export interface SampleAddress {
  label: string;
  detail: string;
  /** The one line under the name. It names what the card opens on. */
  hook: string;
  address: string;
  /** The view the hook is about. */
  tab: Tab;
  /** For the story: the NWS record the hook names, opened on arrival. */
  event?: string;
}

/**
 * The four samples on the landing page. Each hook is checked against the data we ship (tests/samples.test.ts reads the snapshots,
 * and the numbers below come from a lookup of that address): Nashville's EF3 of Mar 3, 2020 passed 0.65 km away; San Antonio's
 * busiest flood night has 7 reports downtown; Buncombe County's Sept 27, 2024 flash flood (SE-1218197) is Helene's; Bellevue's
 * hottest feels-like day is 114.7 F on June 28, 2021.
 */
export const SAMPLE_ADDRESSES: readonly SampleAddress[] = [
  { label: "Nashville, TN", detail: "Downtown, near the Cumberland River", hook: "An EF3 tornado passed 0.65 km away", address: "100 James Robertson Pkwy, Nashville, TN", tab: "tornado" },
  { label: "San Antonio, TX", detail: "Downtown, Military Plaza", hook: "Flash floods on downtown streets", address: "100 Military Plaza, San Antonio, TX", tab: "storm" },
  { label: "Asheville, NC", detail: "River Arts District", hook: "Hurricane Helene’s floods", address: "350 Riverside Dr, Asheville, NC", tab: "story", event: "SE-1218197" },
  { label: "Bellevue, WA", detail: "Downtown, City Hall area", hook: "The 2021 heat dome, 115°F feels-like", address: "450 110th Ave NE, Bellevue, WA", tab: "heat" },
];

/**
 * What a sample card does when chosen. Fill the box first (so the address is visible, and in the URL once looked up). With a runner,
 * look it up in the same click; without one, leave the keyboard in the box so Enter finishes the job.
 */
export function chooseSample(sample: SampleAddress, handlers: { fill: (address: string) => void; run?: (sample: SampleAddress) => void; focusInput: () => void }): void {
  handlers.fill(sample.address);
  if (handlers.run) handlers.run(sample);
  else handlers.focusInput();
}
