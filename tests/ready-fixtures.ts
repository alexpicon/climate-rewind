import type { AreaEvent } from "@/lib/ready/events";
import type { LocalInputs } from "@/lib/ready/local";
import type { HeatSummary, NearbyFlood, NearbyTornado, StateIndex } from "@/lib/types";
import { flood, tornado } from "./helpers";

export const FLOOD_QUOTE = "ROSA PARKS BLVD UNDERWATER NEAR THE FARMERS MARKET WITH CARS STALLED";

export function nearbyFlood(id: string, start: string, distanceKm = 0.4): NearbyFlood {
  return { ...flood({ id, start, quote: FLOOD_QUOTE }), distanceKm, tier: "about1km" };
}

export function nearbyTornado(id = "SE-882999"): NearbyTornado {
  return { ...tornado({ id, ef: "EF3", start: "2020-03-03T00:32:00-06:00", widthYd: 1600, lengthMi: 21.49, deaths: 5, injuries: 220, narrative: "A violent tornado tracked across the county and destroyed homes." }), minDistanceKm: 2.1, closest: [36.17, -86.8] };
}

export const HEAT: HeatSummary = {
  byYear: { "2010": 0, "2011": 4, "2012": 7, "2013": 0 },
  hottest: { date: "2012-06-29", feelsF: 113.3 },
  worstWeek: { start: "2012-06-26", end: "2012-07-02", daily: [{ date: "2012-06-29", feelsF: 113.3 }] },
  regionalSlug: null,
};

export const EVENTS: AreaEvent[] = [
  {
    id: "SE-555001",
    episodeId: "E-1",
    type: "High Wind",
    start: "2018-12-31T16:00:00-06:00",
    area: { kind: "Z", code: "TNZ096", name: "DAVIDSON" },
    deaths: 0,
    injuries: 2,
    damageUsd: 1500000,
    narrative: "Strong winds downed trees and power lines across Davidson County.",
  },
  { id: "SE-555002", type: "Winter Storm", start: "2021-02-15T00:00:00-06:00", area: { kind: "Z", code: "TNZ096", name: "DAVIDSON" }, deaths: 0, injuries: 0, damageUsd: 0, narrative: "" , episodeNarrative: "An arctic outbreak brought heavy snow and ice to Middle Tennessee." },
  { id: "SE-555003", type: "Drought", start: "2019-09-01T00:00:00-05:00", area: { kind: "Z", code: "TNZ096", name: "DAVIDSON" }, narrative: "Dry." },
];

export function inputs(overrides: Partial<LocalInputs> = {}): LocalInputs {
  return {
    indexed: true,
    floods: [nearbyFlood("SE-1265274", "2021-03-27T22:55:00-05:00"), nearbyFlood("LSR-OHX-1", "2019-05-04T03:00:00-05:00", 1.2)],
    tornadoes: [nearbyTornado()],
    heat: HEAT,
    events: EVENTS,
    ...overrides,
  };
}

export function stateIndex(overrides: Partial<StateIndex> = {}): StateIndex {
  return {
    state: "TN",
    built: "2026-10-08T00:00:00Z",
    sources: ["NCEI Storm Events 2015-2025"],
    floods: [flood({ id: "SE-1265274", start: "2021-03-27T22:55:00-05:00", quote: FLOOD_QUOTE })],
    tornadoes: [tornado({ id: "SE-882999", ef: "EF3", begin: [36.17, -86.8], end: [36.18, -86.78] })],
    ...overrides,
  };
}
