/**
 * Data contract types (see CONTRACT.md). Coordinates are always [lat, lon].
 * Fields marked "additive" are not in CONTRACT v1; they only add information.
 */

export type Coord = [lat: number, lon: number];

export type CoordPrecision = "precise" | "rounded" | "placeholder" | "none";

export interface Detective {
  verdict: "placed" | "unknown";
  clues: string[];
  match: string | null;
  matchType: "intersection" | "address" | "named_area" | null;
  confidence: "high" | "medium" | "low" | null;
  model: string;
  ranAt: string;
}

export interface FloodRow {
  id: string;
  source: "StormEvents" | "LSR";
  type: string;
  /** Local time with UTC offset, e.g. 2021-03-27T22:55:00-05:00 */
  start: string;
  county: string;
  wfo: string;
  city: string;
  /** Verbatim NWS text. */
  quote: string;
  /** As the NWS filed it. May be null when coordPrecision is "none". */
  filed: Coord | null;
  coordPrecision: CoordPrecision;
  placed: Coord | null;
  detective: Detective | null;
  dupOf: string | null;
}

export interface TornadoRow {
  id: string;
  start: string;
  ef: string;
  begin: Coord;
  end: Coord;
  widthYd: number;
  lengthMi: number;
  deaths: number;
  injuries: number;
  narrative: string;
  episodeNarrative: string;
}

export interface StateIndex {
  state: string;
  built: string;
  sources: string[];
  /** True for hand-built development fixtures (not pipeline output). */
  fixture?: boolean;
  floods: FloodRow[];
  tornadoes: TornadoRow[];
}

/**
 * One damage place the AI damage mapper pinned from an NWS tornado survey (additive; data/damage/<ST>.json).
 * `phrase` is the survey's own words, verbatim. `tornadoId` is the tornado on the map the pin goes with.
 */
export interface DamagePin {
  tornadoId: string;
  place: string;
  phrase: string;
  ef: string | null;
  lat: number;
  lon: number;
  matchType: string | null;
  confidence: string | null;
}

export type FloodTier = "mentioned" | "about1km" | "citywide";

export interface NearbyFlood extends FloodRow {
  distanceKm: number;
  tier: FloodTier;
}

export interface NearbyTornado extends TornadoRow {
  minDistanceKm: number;
  /** Point on the track closest to the address (additive). */
  closest: Coord;
}

export interface TierCounts {
  mentioned: number;
  about1km: number;
  citywide: number;
}

export interface StormReplay {
  /** Which night this is, like 2021-03-28T03:55 (UTC minute of its first report); matches a `stormNights` id (additive). */
  nightId: string;
  /** Local date (YYYY-MM-DD) of the first report in the replay. */
  date: string;
  startUtc: string;
  endUtc: string;
  frameMinutes: 5;
  /** Reports within 15 km of the address that define the night. */
  reportIds: string[];
  /** Radar box [west, south, east, north] (additive). */
  bounds: [number, number, number, number];
  /** Every report in the radar box during the window, for the map (additive). */
  reports: FloodRow[];
}

/** One choice in the "Storm nights" picker (additive). */
export interface StormNight {
  /** UTC minute of the night's first report, like 2021-03-28T03:55. Pass it back as `night`. */
  id: string;
  /** Local date (YYYY-MM-DD) of the first report. */
  date: string;
  /** Reports within 15 km of the address that night. */
  reports: number;
  startUtc: string;
  endUtc: string;
}

export interface FemaZone {
  zone: string;
  subtype: string;
  sfha: boolean;
}

export interface PolygonGeometry {
  type: "Polygon";
  coordinates: number[][][];
}

export interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

/** NWS alert outline, [lon, lat] pairs (GeoJSON order). */
export type AlertGeometry = PolygonGeometry | MultiPolygonGeometry;

export interface LiveAlert {
  id: string;
  event: string;
  headline: string;
  ends: string | null;
  polygon: AlertGeometry | null;
  /** Raw NWS eventMotionDescription, e.g. "...262DEG...28KT...36.15,-86.9" */
  motion: string | null;
  severity: string | null;
  urgency: string | null;
}

export interface LiveAlerts {
  checkedAt: string;
  alerts: LiveAlert[];
}

export interface HeatDay {
  date: string;
  feelsF: number;
}

export interface HeatSummary {
  /** Days per year with a feels-like high of 100 F or more. */
  byYear: Record<string, number>;
  hottest: HeatDay;
  /** The 7 days centred on the hottest day. */
  worstWeek: { start: string; end: string; daily: HeatDay[] };
  /** Slug of a regional grid in data/heat/ that matches worstWeek, if any (additive). */
  regionalSlug: string | null;
}

export interface LookupAddress {
  input: string;
  matched: string;
  lat: number;
  lon: number;
  state: string;
  county: string | null;
  /** City from the Census match (additive). */
  city: string | null;
}

/** One local date with flood reports within 5 km, and the rain at the address on it (additive). */
export interface TriggerDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Inches: the larger of that day's rain and the day before's (ERA5 via Open-Meteo, at the address). */
  rainIn: number;
}

export interface ForecastDay {
  /** Local date at the address, YYYY-MM-DD. */
  date: string;
  /** Inches of rain the National Weather Service forecasts for that local day. */
  inches: number;
}

export type TriggerVerdict = "below" | "near" | "above";

/**
 * "Your street's flood trigger" (additive). A history-based signal, not a flood forecast:
 * the typical (median) rain on days with flood reports within 5 km, compared with the official forecast for the next 3 days.
 */
export interface FloodTrigger {
  /** ready: 3 or more flood dates with rain records. insufficient: fewer than 3. unavailable: the rain records could not be fetched. */
  status: "ready" | "insufficient" | "unavailable";
  /** Distinct local dates with flood reports within 5 km (before rain records are looked up). */
  floodDays: number;
  /** The typical rain on those dates (the median of the totals), inches, or null unless status is ready. The field keeps its name for older clients. */
  triggerIn: number | null;
  /** The dates with the rain on each, oldest first. Empty unless status is ready. */
  history: TriggerDay[];
  /** The official forecast for the next 3 local days, or null (not asked for, or unavailable: see notices.forecast). */
  forecast: {
    days: ForecastDay[];
    /** The wettest of those days. */
    peak: ForecastDay;
    verdict: TriggerVerdict;
    /** When the NWS last updated the grid, ISO, if it said. */
    updated: string | null;
  } | null;
  notices: { history?: string; forecast?: string };
}

export type Coverage = "indexed" | "fixture" | "not yet indexed";

export type NoticeKey = "fema" | "live" | "heat" | "index";

export interface LookupPayload {
  address: LookupAddress;
  fema: FemaZone | null;
  live: LiveAlerts | null;
  floods: { reports: NearbyFlood[]; tierCounts: TierCounts };
  stormReplay: StormReplay | null;
  /** Additive: the nights offered by the "Storm nights" picker, the default (most reports) first. Empty when none. */
  stormNights: StormNight[];
  tornadoes: NearbyTornado[];
  /** Additive: AI-pinned damage places from the NWS surveys of the tornadoes above (empty when the damage mapper has not run for this state). */
  damage?: DamagePin[];
  heat: HeatSummary | null;
  /** Additive: the street's flood trigger and the official forecast beside it. */
  floodTrigger: FloodTrigger;
  /** Additive: how much of the state index we have. */
  coverage: Coverage;
  /** Additive: plain-language reasons any source is null or empty. */
  notices: Partial<Record<NoticeKey, string>>;
}

export interface LookupErrorBody {
  error: string;
}

/** Regional heat grid file, data/heat/<slug>.json (v3.3 prototype format). */
export interface HeatGrid {
  slug: string;
  label: string;
  source: string;
  days: string[];
  step: number;
  bounds: { lon: [number, number]; lat: [number, number] };
  /** [lat, lon, values per day] */
  cells: Array<[number, number, number[]]>;
}
