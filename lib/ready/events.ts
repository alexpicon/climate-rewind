/**
 * Area events, all types (shape in CONTRACT.md, "Addendum (Oct 8, 2026)"). This file does NOT read data/events: the files are laid out per
 * area code (data/events/<ST>/<CODE>.json.gz) and the shared selector for "the events for this address" lives in lib/area-events.ts.
 * The plan takes the events as an injected array (see ReadyDeps.areaEvents); with none (null) it still works, from floods, tornadoes and heat.
 */
import type { HazardId } from "./types";

export interface AreaEvent {
  id: string;
  episodeId?: string | null;
  type: string;
  start: string;
  end?: string | null;
  area: { kind: "Z" | "C"; code: string; name: string };
  deaths?: number | null;
  injuries?: number | null;
  damageUsd?: number | null;
  magnitude?: number | null;
  magnitudeType?: string | null;
  narrative?: string | null;
  episodeNarrative?: string | null;
}

/** What the plan is given: the events for an address's county and zones, from whatever selector the app wires in. Null: no events data. */
export interface AreaEventsInput {
  lat: number;
  lon: number;
  state: string;
  /** Like TNC037, from api.weather.gov /points (null if that failed). */
  county: string | null;
  /** Like TNZ096. */
  zone: string | null;
}

/**
 * Fills in an event's episode narrative from an episodes map when the event does not carry one (the files store each episode once and
 * may leave it off the event). The event's own narrative is kept as it is; a missing one stays missing.
 */
export function withEpisodes(events: readonly AreaEvent[], episodes: Readonly<Record<string, string>> = {}): AreaEvent[] {
  return events.map((e) => (e.episodeNarrative || !e.episodeId || !episodes[e.episodeId] ? e : { ...e, episodeNarrative: episodes[e.episodeId] }));
}

/** NCEI Storm Events EVENT_TYPE -> the hazard the plan covers. Types not listed here are not planned for. */
const HAZARD_OF_TYPE: Record<string, HazardId> = {
  "Flash Flood": "flood",
  "Flood": "flood",
  "Coastal Flood": "flood",
  "Lakeshore Flood": "flood",
  "Heavy Rain": "flood",
  "Tornado": "tornado",
  "Excessive Heat": "heat",
  "Heat": "heat",
  "High Wind": "wind",
  "Strong Wind": "wind",
  "Thunderstorm Wind": "wind",
  "Hail": "wind",
  "Lightning": "wind",
  "Winter Storm": "winter",
  "Heavy Snow": "winter",
  "Blizzard": "winter",
  "Ice Storm": "winter",
  "Winter Weather": "winter",
  "Lake-Effect Snow": "winter",
  "Sleet": "winter",
  "Extreme Cold/Wind Chill": "winter",
  "Cold/Wind Chill": "winter",
  "Frost/Freeze": "winter",
  "Dense Smoke": "smoke",
  "Wildfire": "smoke",
};

export const hazardOfType = (type: string): HazardId | null => HAZARD_OF_TYPE[type] ?? null;
