/**
 * Local time-zone abbreviations (CDT, CST, EDT...) for times the data gives us only as a UTC offset.
 * The abbreviation comes from Intl, not from a hand-written table of names: we find the US zone whose
 * offset at that instant matches the report's own offset, preferring the zones of the report's state.
 */

const US_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;

/** States whose zone differs from, or is checked before, the default order. */
const PREFERRED: Record<string, string[]> = {
  AZ: ["America/Phoenix"],
  TN: ["America/Chicago", "America/New_York"],
  TX: ["America/Chicago", "America/Denver"],
  NC: ["America/New_York"],
  GA: ["America/New_York"],
  MO: ["America/Chicago"],
  CO: ["America/Denver"],
  DC: ["America/New_York"],
  CA: ["America/Los_Angeles"],
  OR: ["America/Los_Angeles"],
  WA: ["America/Los_Angeles"],
  NV: ["America/Los_Angeles"],
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string, timeZoneName: "short" | "longOffset"): Intl.DateTimeFormat {
  const key = `${zone}|${timeZoneName}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName });
    formatters.set(key, f);
  }
  return f;
}

const part = (f: Intl.DateTimeFormat, ms: number) => f.formatToParts(ms).find((p) => p.type === "timeZoneName")?.value ?? "";

/** "GMT-05:00" -> -300 ("GMT" alone is 0). */
function offsetOf(zone: string, ms: number): number | null {
  const text = part(formatter(zone, "longOffset"), ms);
  if (text === "GMT") return 0;
  const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(text);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
}

/** "UTC-5" when no US zone matches. */
function plainOffset(offsetMin: number): string {
  const hours = offsetMin / 60;
  return `UTC${hours < 0 ? "-" : "+"}${Number.isInteger(hours) ? Math.abs(hours) : Math.abs(hours).toFixed(1)}`;
}

/**
 * The short zone name for a moment in time ("CDT"), given the UTC offset the report was filed with and,
 * if known, the state. Falls back to "UTC-5" if no US zone had that offset at that moment.
 */
export function zoneAbbreviation(ms: number, offsetMin: number, state?: string | null): string {
  const preferred = PREFERRED[(state ?? "").toUpperCase()] ?? [];
  for (const zone of [...preferred, ...US_ZONES]) {
    if (offsetOf(zone, ms) === offsetMin) {
      const name = part(formatter(zone, "short"), ms);
      if (/^[A-Z]{2,5}$/.test(name)) return name;
    }
  }
  return plainOffset(offsetMin);
}

const EASTERN = new Set(["CT", "DE", "DC", "GA", "ME", "MD", "MA", "NH", "NJ", "NY", "NC", "OH", "PA", "RI", "SC", "VT", "VA", "WV"]);
const CENTRAL = new Set(["AL", "AR", "IL", "IA", "LA", "MN", "MS", "MO", "OK", "WI"]);
const MOUNTAIN = new Set(["CO", "MT", "NM", "UT", "WY"]);
const PACIFIC = new Set(["CA", "NV", "WA", "OR"]);

/**
 * The IANA time zone of an address, from its state and longitude (states that straddle a boundary are split by longitude).
 * Null when the state is unknown, so the caller can fall back to the viewer's own zone.
 */
export function zoneIdFor(state: string | null | undefined, lon: number): string | null {
  const st = (state ?? "").toUpperCase();
  if (EASTERN.has(st)) return "America/New_York";
  if (CENTRAL.has(st)) return "America/Chicago";
  if (MOUNTAIN.has(st)) return "America/Denver";
  if (PACIFIC.has(st)) return "America/Los_Angeles";
  switch (st) {
    case "AZ": return "America/Phoenix";
    case "AK": return "America/Anchorage";
    case "HI": return "Pacific/Honolulu";
    case "FL": return lon > -85.4 ? "America/New_York" : "America/Chicago";
    case "MI": return lon > -87.6 ? "America/New_York" : "America/Chicago";
    case "IN": return lon > -86.9 ? "America/New_York" : "America/Chicago";
    case "KY": return lon > -86 ? "America/New_York" : "America/Chicago";
    case "TN": return lon > -85.5 ? "America/New_York" : "America/Chicago";
    case "TX": return lon < -105.5 ? "America/Denver" : "America/Chicago";
    case "KS": return lon < -101.5 ? "America/Denver" : "America/Chicago";
    case "NE": return lon < -101 ? "America/Denver" : "America/Chicago";
    case "ND": return lon < -101 ? "America/Denver" : "America/Chicago";
    case "SD": return lon < -100.3 ? "America/Denver" : "America/Chicago";
    case "ID": return "America/Denver";
    default: return null;
  }
}

/** "5:30 PM CDT": a clock time in the address's own zone (the viewer's zone when the address's is unknown). */
export function timeAtPlace(ms: number, zoneId: string | null): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", ...(zoneId ? { timeZone: zoneId } : {}) });
}
