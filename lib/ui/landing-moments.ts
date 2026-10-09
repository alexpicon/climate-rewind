/**
 * "Moments the records caught" on the landing page: famous events that the app's own data shows, each opening the replay that shows
 * it. Every number here was read from that data for that address (tests/landing-moments.test.ts checks the shipped parts): the tornado
 * distances and county totals from the state index, the deaths and damage from the NCEI event the card opens, the flood reports from
 * the storm night.
 */
import type { SampleAddress, Tab } from "./tabs";

export interface LandingMoment {
  id: string;
  /** "Dec 10, 2021 · Mayfield, Kentucky" */
  kicker: string;
  /** The big number, with its unit beside it. */
  big: string;
  unit: string;
  title: string;
  line: string;
  address: string;
  tab: Tab;
  night?: string;
  event?: string;
  /** The tornado the tornado replay starts from, and the year the area replay plays from. */
  tornado?: string;
  replayFrom?: number;
  /** What the button says. */
  action: string;
}

export const LANDING_MOMENTS: readonly LandingMoment[] = [
  {
    id: "mayfield",
    kicker: "Dec 10, 2021 · Mayfield, Kentucky",
    big: "0.65",
    unit: "km",
    title: "An EF4 tornado through downtown",
    line: "Its track passed this close to 100 E Broadway, downtown. 24 deaths and 210 injuries were recorded in Graves County.",
    address: "100 E Broadway, Mayfield, KY",
    tab: "tornado",
    tornado: "SE-994196",
    action: "Play the tornado",
  },
  {
    id: "rolling-fork",
    kicker: "Mar 24, 2023 · Rolling Fork, Mississippi",
    big: "0.3",
    unit: "km",
    title: "An EF4 at night",
    line: "Its track passed this close to 100 Walnut St. 14 deaths and 150 injuries were recorded in Sharkey County.",
    address: "100 Walnut St, Rolling Fork, MS",
    tab: "tornado",
    tornado: "SE-1102153",
    action: "Play the tornado",
  },
  {
    id: "ida",
    kicker: "Sept 1, 2021 · Flushing, Queens",
    big: "25",
    unit: "flood reports",
    title: "Hurricane Ida’s remnants hit New York",
    line: "Within 15 km in one night, with the radar and the lightning seen from space. 11 deaths were recorded in Queens.",
    address: "4105 Main St, Flushing, NY",
    tab: "storm",
    night: "2021-09-02T02:00",
    action: "Play the night",
  },
  {
    id: "lahaina",
    kicker: "Aug 8, 2023 · Lahaina, Hawaii",
    big: "102",
    unit: "deaths",
    title: "The Lahaina wildfire",
    line: "Recorded for the forecast zone that holds Front Street, with $5.5 billion in damage, on a day of high wind.",
    address: "658 Front St, Lahaina, HI",
    tab: "story",
    event: "SE-1118193",
    replayFrom: 2019,
    action: "Play the years",
  },
  {
    id: "ian",
    kicker: "Sept 28, 2022 · Fort Myers, Florida",
    big: "$7",
    unit: "billion",
    title: "Hurricane Ian’s landfall",
    line: "Recorded for coastal Lee County, next to downtown Fort Myers, with 60 deaths.",
    address: "2115 2nd St, Fort Myers, FL",
    tab: "story",
    event: "SE-1058654",
    replayFrom: 2018,
    action: "Play the years",
  },
];

/** The moment as a lookup the app opens like a sample card: the view, and the night or record it lands on. */
export function momentLookup(moment: LandingMoment): SampleAddress {
  // A story moment that plays the years lands on the replay, not on its record's card (both would pull the page to themselves).
  const event = moment.replayFrom === undefined ? moment.event : undefined;
  return { label: moment.kicker.split(" · ")[1] ?? moment.kicker, detail: "", hook: moment.title, address: moment.address, tab: moment.tab, night: moment.night, event, tornado: moment.tornado, replayFrom: moment.replayFrom };
}
