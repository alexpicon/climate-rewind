/**
 * The whole-storm cost NOAA NCEI lists in its Billion-Dollar Weather and Climate Disasters table, for the two hurricanes whose cards
 * show a smaller figure (the NCEI Storm Events damage recorded for one county). Read 2026-10-09 from NCEI's own release
 * (https://www.ncei.noaa.gov/access/billions/events/US/1980-2024.csv, costs in millions, CPI-adjusted to 2024 dollars):
 * Hurricane Ian 119,626; Hurricane Helene 78,721. Nothing else on the site is given a full-cost line.
 */
export interface FullCost {
  /** "The storm’s full cost: about $119.6 billion in 2024 dollars (NOAA)" */
  text: string;
  url: string;
}

export const FULL_COST = {
  ian: {
    text: "The storm’s full cost: about $119.6 billion in 2024 dollars (NOAA)",
    url: "https://www.ncei.noaa.gov/access/billions/state-summary/FL",
  },
  helene: {
    text: "The storm’s full cost: about $78.7 billion in 2024 dollars (NOAA)",
    url: "https://www.ncei.noaa.gov/access/billions/state-summary/NC",
  },
} as const satisfies Record<string, FullCost>;

/** NCEI Storm Events ids of the events whose cards get a full-cost line. */
export const FULL_COST_OF_EVENT: Readonly<Record<string, FullCost>> = {
  "SE-1058654": FULL_COST.ian,
  "SE-1218197": FULL_COST.helene,
};
