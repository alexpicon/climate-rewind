/** Distances and windows from CONTRACT.md. Safe to import from client code (no server modules). */

export const FLOOD_RADIUS_KM = 5;
export const REPLAY_NIGHT_RADIUS_KM = 15;
export const TORNADO_RADIUS_KM = 10;
/** With no tornado within 10 km, the replay plays the tracks within this distance instead (and says so). */
export const NEARBY_REPLAY_KM = 25;
/** Reports farther than this are not drawn on the replay map. */
export const REPLAY_REGION_KM = 120;
/** A "night" is the busiest stretch of at most this many hours. */
export const REPLAY_CLUSTER_HOURS = 6;
export const REPLAY_PAD_MINUTES = 90;
/** The radar window never runs longer than this (85 frames at most). */
export const REPLAY_MAX_HOURS = 7;
export const FRAME_MINUTES = 5;

/** States with a flood and tornado index in data/index (a test keeps this list equal to the files). */
/** Every state with a file in data/index: all 50 states plus the District of Columbia (Storm Events; LSRs for 7 of them). */
export const INDEXED_STATE_NAMES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "District of Columbia", "Florida",
  "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts",
  "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico",
  "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
] as const;
export const INDEXED_STATES_TEXT = "all 50 states and Washington, DC";

/** "Storm nights" picker: always offer this many of the busiest nights... */
export const TOP_NIGHTS = 5;
/** ...plus any other night with at least this many reports within 15 km that is from this year on ("newer than 2023"). */
export const RECENT_NIGHT_FROM_YEAR = 2024;
export const RECENT_NIGHT_MIN_REPORTS = 2;

/** When nothing is within FLOOD_RADIUS_KM, the nearest placeable flood report is looked for out to this distance. */
export const NEAREST_FLOOD_MAX_KM = 50;
/** An address with fewer flood reports than this within 5 km is a "quiet" result and gets the extra cards (it is also the flood trigger's minimum). */
export const QUIET_BELOW_REPORTS = 3;
/** The area events count from this year (NCEI Storm Events, county and zone rows). */
export const AREA_EVENTS_FROM_YEAR = 2000;
/** How many of the most severe area events travel in the lookup payload, narratives included. */
export const AREA_EVENTS_TOP = 60;
/** A forecast zone whose edge is within this many km of the address counts as a "nearby zone" in the area story. */
export const NEARBY_ZONE_KM = 15;
/** How many events the AI story writes about. */
export const STORY_EVENTS = 10;
