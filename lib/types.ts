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
  /** The feels-like high (Open-Meteo) or heat-index high (NASA POWER), °F. */
  feelsF: number;
  /** The air temperature high, °F (additive; older snapshots lack it). The heat tab uses the higher of the two (lib/heat-measure.ts). */
  airF?: number;
}

/** Where the daily highs came from. Absent means Open-Meteo (ERA5 feels-like), the usual source. */
export type HeatSource = "open-meteo" | "nasa-power";

export interface HeatSummary {
  /** Days per year with a high of 100 F or more: the air temperature, or the feels-like where it was higher (lib/heat-measure.ts). */
  byYear: Record<string, number>;
  hottest: HeatDay;
  /** The 7 days centred on the hottest day. */
  worstWeek: { start: string; end: string; daily: HeatDay[] };
  /** Slug of a regional grid in data/heat/ that matches worstWeek, if any (additive). */
  regionalSlug: string | null;
  /**
   * Additive. "nasa-power" when Open-Meteo was rate limited or down and the highs are a heat index (NWS formula) computed from
   * NASA POWER (MERRA-2) instead of Open-Meteo's feels-like. Absent: Open-Meteo.
   */
  provider?: HeatSource;
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
  /** 3-digit county FIPS from the Census match, like "033" (additive). Null if the Census did not give it. */
  countyFips?: string | null;
}

/** One local date with flood reports within 5 km, and the rain at the address on it (additive). */
export interface TriggerDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Inches: the largest daily total around the date, from a NOAA rain gauge when `station` is set, else gridded rain at the address. */
  rainIn: number;
  /** Additive: measured by NOAA rain gauges (GHCN-Daily): the median of `gauges` stations, the nearest of which is `station`, `stationKm` away. */
  station?: string;
  stationKm?: number;
  gauges?: number;
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
  /**
   * Additive. Where the rain on the flood dates came from: ERA5 via Open-Meteo (absent or "era5"), NASA POWER (MERRA-2) when Open-Meteo
   * was rate limited or down ("nasa-power"), or a mix of both ("mixed").
   */
  rainSource?: "era5" | "nasa-power" | "mixed";
}

export type Coverage = "indexed" | "fixture" | "not yet indexed";

/**
 * The pieces a lookup is made of when the page asks for them one by one (lib/lookup.ts lookupPart): `records` (flood and tornado index, storm
 * nights, damage places, quiet placement), `area` (NCEI events), `live` (NWS alerts), `fema`, `heat` (the 26-year heat summary and the
 * wettest/windiest days) and `trigger` (the flood trigger with the NWS forecast). The address match comes first (lookupGeocode).
 */
export type LookupPart = "records" | "area" | "live" | "fema" | "heat" | "trigger";
export const LOOKUP_PARTS: readonly LookupPart[] = ["records", "area", "live", "fema", "heat", "trigger"];

export type NoticeKey = "fema" | "live" | "heat" | "index" | "areaEvents" | "extremes";

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
  /** Additive: what has happened in the address's county, its NWS forecast zone and the zones within 15 km since 2000, every event type. Null when unavailable. */
  areaEvents?: AreaEventsSummary | null;
  /** Additive: with no flood report within 5 km, the nearest placeable one up to 50 km away (null when there is none that close). */
  nearestFlood?: NearbyFlood | null;
  /** Additive: the wettest, windiest and hottest days on record at the address. */
  extremes?: AddressExtremes | null;
  /** Additive: how the address compares with the sampled points of its state. */
  quiet?: QuietPlacement | null;
  /** Additive: parts still being read when the first view is drawn (the page asks for them one by one). Absent or empty: the payload is whole. */
  pending?: LookupPart[];
}


// ---------------------------------------------------------------- area events (additive; CONTRACT addendum, Oct 8)

/**
 * How an event relates to the address (lib/area-events.ts): filed for its county, for the forecast zone the address is inside
 * ("your zone"), or for a zone whose edge is within 15 km ("nearby zone", always shown with the zone's name).
 */
export type AreaTier = "county" | "your zone" | "nearby zone";

/** One NCEI Storm Events row for a county or NWS forecast zone (any event type), as stored in data/events/<ST>/<CODE>.json.gz. */
export interface AreaEvent {
  id: string;
  episodeId: string | null;
  /** EVENT_TYPE verbatim, like "High Wind". */
  type: string;
  /** Local time with UTC offset. */
  start: string;
  end: string | null;
  area: { kind: "Z" | "C"; code: string; name: string };
  deaths: number;
  injuries: number;
  damageUsd: number;
  magnitude: number | null;
  magnitudeType: string | null;
  /** Verbatim EVENT_NARRATIVE; may be empty. */
  narrative: string;
  /** Verbatim EPISODE_NARRATIVE; may be empty. */
  episodeNarrative: string;
  /** Additive: how this event relates to the address. Set by selectAreaEvents; absent on a bare row. */
  tier?: AreaTier;
  /** Additive: the forecast zone's name for the two zone tiers (like "Bellevue and Vicinity"); null for a county row. */
  zoneName?: string | null;
}

/** A zone that selectAreaEvents chose, for the story's fine print. */
export interface AreaZoneInfo {
  code: string;
  name: string;
  tier: Exclude<AreaTier, "county">;
  /** 0 for your zone; else km from the address to the zone's edge (for an approximate zone, to its bounding box). */
  distanceKm: number;
  /** Events counted from this zone since the first year. */
  events: number;
  /** Additive: when NWS stopped using this outline (YYYY-MM-DD). Of the zones that hold the address, the latest is the current one. */
  validTo?: string | null;
}

/** What happened in the address's county and the forecast zones over it since 2000: counts for all of it, the most severe events in full. */
export interface AreaEventsSummary {
  /** The address's county as an NCEI area code (state + "C" + county FIPS), like WAC033. */
  county: string | null;
  countyName: string | null;
  /** The county code plus every forecast zone (including zones NWS has since renumbered) that contains the address or lies within 15 km of it. */
  areaCodes: string[];
  /** Additive: those zones, with their tier. Empty when the state has no zone outlines. */
  zones?: AreaZoneInfo[];
  /** First year counted. */
  since: number;
  /** Events for the zone and county since `since`. */
  total: number;
  /** Events by EVENT_TYPE. */
  counts: Record<string, number>;
  /** Events by calendar year of the start. */
  byYear: Record<string, number>;
  /** The most severe events (deaths, injuries, damage, magnitude, narrative), most severe first, with their narratives. */
  top: AreaEvent[];
  source: string;
}

/** The wettest, windiest and hottest days on record at the address (reanalysis, not a gauge). */
export interface AddressExtremes {
  wettest: { date: string; inches: number } | null;
  /** `gust` is Open-Meteo's daily maximum 10 m gust; `wind` is NASA POWER's daily maximum 10 m wind speed (not a gust). */
  windiest: { date: string; mph: number; measure: "gust" | "wind" } | null;
  hottest: HeatDay | null;
  /** Where the wettest and windiest days came from. */
  source: "open-meteo" | "nasa-power" | "snapshot";
}

/** Where an address sits among the sample points of all indexed states, pooled (data/quiet-percentiles.json). */
export interface QuietPlacement {
  state: string;
  /** Distinct flood reports within 5 km of the address (what the points were measured by). */
  count: number;
  /** Share of sampled points (0 to 100, rounded down) with MORE reports than this address. */
  quieterThanPct: number;
  /** Share with exactly as many. */
  samePct: number;
  /** Share with no report at all within 5 km. */
  nonePct: number;
  /** Points in the sample, and how many states they came from. */
  sample: number;
  states: number;
}

export interface LookupErrorBody {
  error: string;
  /** Places to pick from, when a city name matched more than one. */
  choices?: string[];
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
