/**
 * How the detective step decides where each city-point report goes.
 *
 * Real detective results (CONTRACT `placed` + `detective`) win. Where the detective has not
 * run (`detective: null`), the Nashville night uses the placements from the approved prototype
 * and every one of them is tagged SAMPLE in the UI. Anything else stays unresolved (null), and the
 * UI says plainly that the detective has not run for that area.
 */
import { prettyPlace } from "./text";
import type { Coord, FloodRow } from "../types";

export type PlacementStatus = "verified" | "area" | "sample" | "unknown";

export interface Placement {
  status: PlacementStatus;
  /** Where the words say it happened. Null when the words are too vague to place. */
  dest: Coord | null;
  label: string;
  /** "street", "address" or "area" */
  kind: "street" | "address" | "area" | "region";
  /** Place words in the report text (underlined). */
  place: string[];
  /** Supporting landmarks (dotted underline). */
  support: string[];
  /** Vague region (dashed underline). */
  vague: string[];
  /** Why we believe this placement. */
  why: string;
}

interface SamplePlacement {
  dest: Coord | null;
  label: string;
  kind: Placement["kind"];
  place: string[];
  support: string[];
  vague: string[];
  why: string;
}

/**
 * Sample placements from the v3.3 prototype for the five reports the NWS pinned to the Nashville city
 * point on the night of Mar 27 to 28, 2021. They are NOT detective output.
 *
 * They are matched by the report's own words (and county and office), not by id, because the pipeline
 * numbers LSR ids within a minute and a rebuild can shift them. The points: Rosa Parks and 95 Wallace Rd
 * are Census points, Oak Hill is an OpenStreetMap neighbourhood centre, Linbar Dr is an OpenStreetMap
 * street centre. The fifth report names only a region, which a strict rule leaves unplaced.
 */
const SAMPLE_PLACEMENTS: Array<SamplePlacement & { quoteStart: string }> = [
  {
    quoteStart: "ROSA PARKS BLVD UNDERWATER NEAR THE FARMERS MARKET",
    dest: [36.1714, -86.7902],
    label: "Rosa Parks Blvd",
    kind: "street",
    place: ["Rosa Parks Blvd"],
    support: ["Farmers Market"],
    vague: [],
    why: "The words name Rosa Parks Blvd near the Farmers Market. The spot is approximate.",
  },
  {
    quoteStart: "1ST FLOOR OF HOTEL FLOODED AT 95 WALLACE ROAD",
    dest: [36.0825, -86.7021],
    label: "95 Wallace Rd",
    kind: "address",
    place: ["95 Wallace Road"],
    support: [],
    vague: [],
    why: "The words give a street address, 95 Wallace Road. The spot is a Census check made by hand for the prototype.",
  },
  {
    quoteStart: "NUMEROUS WATER RESCUES BEING CONDUCTED IN SOUTH NASHVILLE IN OAK HILL AREA",
    dest: [36.0558, -86.7377],
    label: "Oak Hill / Edmondson Pike",
    kind: "area",
    place: ["Oak Hill", "Edmondson Pike"],
    support: ["South Nashville"],
    vague: [],
    why: "The words name an area, not a point. The pin is the neighbourhood centre.",
  },
  {
    quoteStart: "FLASH FLOODING AT THE SOUTH BROOKE APARTMENTS ON LINBAR DRIVE",
    dest: [36.0834, -86.7038],
    label: "Linbar Dr",
    kind: "street",
    place: ["Linbar Drive"],
    support: ["South Brooke Apartments"],
    vague: [],
    why: "The words name South Brooke Apartments on Linbar Drive. The pin is the middle of the street.",
  },
  {
    quoteStart: "MAJOR FLASH FLOODING ONGOING ACROSS THE SOUTHERN HALF OF NASHVILLE",
    dest: null,
    label: "I don't know",
    kind: "region",
    place: [],
    support: [],
    vague: ["southern half of Nashville"],
    why: "The words name a whole region, not a place. The note stays at the city centre. No guess.",
  },
];

/** The prototype's sample placement for a report, if this is one of the five Nashville reports. */
export function samplePlacementFor(report: Pick<FloodRow, "quote" | "county" | "wfo">): SamplePlacement | null {
  if (report.wfo !== "OHX" || report.county !== "Davidson") return null;
  const quote = report.quote.replace(/\s+/g, " ").trim().toUpperCase();
  return SAMPLE_PLACEMENTS.find((sample) => quote.startsWith(sample.quoteStart)) ?? null;
}

/** The report text the sample or detective placement should highlight, for a report with a real detective result. */
export function resolvePlacement(report: FloodRow): Placement | null {
  const result = report.detective;

  if (result) {
    if (result.verdict === "unknown" || !report.placed) {
      return { status: "unknown", dest: null, label: "I don't know", kind: "region", place: [], support: [], vague: [], why: "The words are too vague to place. The note stays at the city centre. No guess." };
    }
    const verified = result.matchType === "address" || result.matchType === "intersection";
    return {
      status: verified ? "verified" : "area",
      dest: report.placed,
      label: result.match ? prettyPlace(result.match) : "Placed",
      kind: result.matchType === "address" ? "address" : result.matchType === "intersection" ? "street" : "area",
      place: result.clues,
      support: [],
      vague: [],
      why: verified
        ? `The words give ${result.matchType === "address" ? "a street address" : "an intersection"}, matched by the Census geocoder.`
        : "The words name an area, so the pin is the area centre.",
    };
  }

  const sample = samplePlacementFor(report);
  if (!sample) return null;
  return { status: sample.dest ? "sample" : "unknown", ...sample };
}
