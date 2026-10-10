/**
 * "What you'll see" on the landing page: one tile per thing the app shows, each with a one-click example on a sample address. Each line
 * says only what that view really does (lightning only where it was extracted, the local track record only for the samples).
 */
import { SAMPLE_ADDRESSES, type SampleAddress, type Tab } from "./tabs";

export type FeatureIcon = "clock" | "radar" | "tornado" | "calendar" | "heat" | "trend";

export interface LandingFeature {
  id: string;
  icon: FeatureIcon;
  title: string;
  body: string;
  /** The sample address the example opens, by its label on the landing page. */
  sample: string;
  /** The view it opens on, and for the storm replay, the night. */
  tab: Tab;
  night?: string;
}

export const LANDING_FEATURES: readonly LandingFeature[] = [
  {
    id: "ahead",
    icon: "clock",
    title: "The next 7 days",
    body: "A card for each of the next 7 days: the official forecast in plain words, what days like it meant on your street before, and what to do, with every piece of advice tied to an official guidance line.",
    sample: "Nashville, TN",
    tab: "ahead",
  },
  {
    id: "storm",
    icon: "radar",
    title: "Storm replay",
    body: "Real NEXRAD radar of a flood night near you, each flood report at the minute it was filed, and the radar’s own hail and rotation flags. On the sample nights, lightning seen from space.",
    sample: "San Antonio, TX",
    tab: "storm",
    night: "2021-05-01T18:05",
  },
  {
    id: "tornado",
    icon: "tornado",
    title: "Tornadoes",
    body: "Every recorded tornado track within 10 km, drawn on with the National Weather Service’s damage survey and the radar’s rotation flags along the path.",
    sample: "Nashville, TN",
    tab: "tornado",
  },
  {
    id: "story",
    icon: "calendar",
    title: "Every event since 2000",
    body: "Everything the National Weather Service filed for your county and forecast zone, from high wind and heat waves to ice storms, coastal floods and rip currents, replayed year by year.",
    sample: "Bellevue, WA",
    tab: "story",
  },
  {
    id: "heat",
    icon: "heat",
    title: "Heat",
    body: "26 years of feels-like highs at your address: the hottest day, the worst week, and how many days passed 100°F each year.",
    sample: "Bellevue, WA",
    tab: "heat",
  },
  {
    id: "future",
    icon: "trend",
    title: "What’s changing, and getting ready",
    body: "The trend in your own record, what climate models project for the 2040s, and a checklist built from what has actually happened here.",
    sample: "Nashville, TN",
    tab: "future",
  },
];

/** The sample a feature's example opens, landing on the feature's view (and night). Null if the label names no sample. */
export function featureSample(feature: LandingFeature): SampleAddress | null {
  const sample = SAMPLE_ADDRESSES.find((s) => s.label === feature.sample);
  if (!sample) return null;
  return { ...sample, tab: feature.tab, night: feature.night, event: undefined };
}
