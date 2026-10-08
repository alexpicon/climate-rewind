/** Distances and windows from CONTRACT.md. Safe to import from client code (no server modules). */

export const FLOOD_RADIUS_KM = 5;
export const REPLAY_NIGHT_RADIUS_KM = 15;
export const TORNADO_RADIUS_KM = 10;
/** Reports farther than this are not drawn on the replay map. */
export const REPLAY_REGION_KM = 120;
/** A "night" is the busiest stretch of at most this many hours. */
export const REPLAY_CLUSTER_HOURS = 6;
export const REPLAY_PAD_MINUTES = 90;
/** The radar window never runs longer than this (85 frames at most). */
export const REPLAY_MAX_HOURS = 7;
export const FRAME_MINUTES = 5;

/** States with a flood and tornado index in data/index (a test keeps this list equal to the files). */
export const INDEXED_STATE_NAMES = ["Tennessee", "Texas", "North Carolina", "Missouri", "Arizona", "Georgia", "Washington"] as const;
export const INDEXED_STATES_TEXT = `${INDEXED_STATE_NAMES.slice(0, -1).join(", ")} and ${INDEXED_STATE_NAMES[INDEXED_STATE_NAMES.length - 1]}`;

/** "Storm nights" picker: always offer this many of the busiest nights... */
export const TOP_NIGHTS = 5;
/** ...plus any other night with at least this many reports within 15 km that is from this year on ("newer than 2023"). */
export const RECENT_NIGHT_FROM_YEAR = 2024;
export const RECENT_NIGHT_MIN_REPORTS = 2;
