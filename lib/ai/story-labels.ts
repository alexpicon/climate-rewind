/** Words for the impact tags. Client-safe (the event card shows them). */
import type { ImpactTag } from "./types";

export const IMPACT_PHRASE: Record<ImpactTag, string> = {
  power_outage: "power outages",
  trees_down: "trees down",
  roads_blocked: "roads closed or blocked",
  flooding: "flooding",
  structure_damage: "damage to homes or buildings",
  travel_disruption: "travel trouble",
};
