/**
 * Text helpers for showing NWS report text. The stored quote is always verbatim;
 * these only change how it is displayed (case, highlights, excerpts).
 */

/** True when most letters are capitals, as in NWS Local Storm Reports. */
export function isShouty(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 8) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length > 0.7;
}

const ACRONYMS = /\b(tn|tx|nc|oem|us|nws|ems|i-\d+|hwy|hp)\b/gi;

/**
 * Display-only: turns SHOUTING NWS text into readable sentence case. Names the
 * report itself supplies (its city, county, and the place words we highlight) keep
 * their capitals. The stored quote is not changed.
 */
export function readableCase(text: string, names: string[] = []): string {
  if (!isShouty(text)) return text;

  let out = text.toLowerCase().replace(/\s+/g, " ").trim();
  out = out.replace(ACRONYMS, (m) => (m.toLowerCase().startsWith("i-") ? "I-" + m.slice(2) : m.toUpperCase()));
  out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());

  out = capitalizeRoadNames(out);

  for (const name of names) {
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "gi"), name);
  }
  return out;
}

const ROAD_SUFFIX = "rd|pk|road|blvd|boulevard|pike|dr|drive|st|street|ln|lane|ave|avenue|pkwy|parkway|hwy|highway|creek|river|place|pl|ct|court|bridge|way|trace|park|market|apartments|lake";
const NOT_A_NAME = new Set([
  "the", "a", "an", "and", "of", "on", "at", "in", "near", "flooded", "closed", "across", "several", "numerous", "major", "from", "to", "with",
  "is", "was", "were", "by", "for", "some", "their", "water", "roads", "homes", "many", "two", "one", "covers", "over", "ongoing", "houses",
  "people", "also", "both", "stranded", "main", "under", "second", "first", "around", "along", "including", "while", "but", "still", "road", "street",
]);

/** Capitalises "harding place", "woodmont blvd": up to two words before a road word, plus the road word. */
function capitalizeRoadNames(text: string): string {
  const pattern = new RegExp(`\\b([a-z']+)(\\s+[a-z']+)?\\s+(${ROAD_SUFFIX})\\b`, "g");
  return text.replace(pattern, (_match, first: string, second: string | undefined, suffix: string) => {
    const words = [first, second?.trim(), suffix].filter((w): w is string => Boolean(w));
    return words.map((w, i) => (i < words.length - 1 && NOT_A_NAME.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
  });
}

/**
 * "1 ENE MOUNT JULIET" -> "Mount Juliet": drops the NWS "distance direction" prefix and title-cases
 * a place name. Display only.
 */
export function placeName(city: string): string {
  const bare = city.replace(/^\d+\s+[NSEW]{1,3}\s+/i, "").trim().toLowerCase();
  return bare.replace(/\b([a-z])([a-z']*)/g, (_, a: string, rest: string) => a.toUpperCase() + rest);
}

/** "ROSA L PARKS BLVD, NASHVILLE, TN 37201" -> "Rosa L Parks Blvd" (first part, title case; NE, NW, SE and SW stay capitals). */
export function prettyPlace(match: string): string {
  const first = match.split(",")[0].trim().toLowerCase();
  return first.replace(/\b([a-z])([a-z']*)/g, (_, a: string, rest: string) => a.toUpperCase() + rest).replace(/\bI-(\d+)/gi, "I-$1").replace(/\b(Ne|Nw|Se|Sw)\b/g, (d) => d.toUpperCase());
}

export type MarkKind = "place" | "support" | "vague";

export interface TextSegment {
  text: string;
  mark: MarkKind | null;
}

export interface Highlights {
  /** Place words the detective used. */
  place?: string[];
  /** Supporting landmarks. */
  support?: string[];
  /** A vague region the text names (shown dashed). */
  vague?: string[];
}

/**
 * Splits text into plain and highlighted pieces. Matching ignores case, the first
 * occurrence of each phrase is used, and overlapping matches are dropped. Returned as
 * data (not HTML) so the UI renders it with React and nothing is injected.
 */
export function highlightSegments(text: string, highlights: Highlights): TextSegment[] {
  const lower = text.toLowerCase();
  const found: Array<{ from: number; to: number; mark: MarkKind }> = [];

  const addAll = (phrases: string[] | undefined, mark: MarkKind) => {
    for (const phrase of phrases ?? []) {
      const from = lower.indexOf(phrase.toLowerCase());
      if (from >= 0 && phrase.length > 0) found.push({ from, to: from + phrase.length, mark });
    }
  };
  addAll(highlights.place, "place");
  addAll(highlights.support, "support");
  addAll(highlights.vague, "vague");
  found.sort((a, b) => a.from - b.from);

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of found) {
    if (match.from < cursor) continue;
    if (match.from > cursor) segments.push({ text: text.slice(cursor, match.from), mark: null });
    segments.push({ text: text.slice(match.from, match.to), mark: match.mark });
    cursor = match.to;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), mark: null });
  return segments;
}

/**
 * The first sentences of a long narrative, up to about `max` characters, ending on a
 * sentence boundary. `truncated` tells the UI to add an ellipsis.
 */
export function excerpt(text: string, max = 340): { text: string; truncated: boolean } {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return { text: clean, truncated: false };

  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [clean];
  let out = "";
  for (const sentence of sentences) {
    if (out && (out + sentence).length > max) break;
    out += sentence;
  }
  out = out.trim();
  if (!out || out.length > max * 1.6) out = clean.slice(0, max).replace(/\s+\S*$/, "");
  return { text: out, truncated: out.length < clean.length };
}

// ---------------------------------------------------------------- local time from an ISO offset

/** Minutes east of UTC from a string like 2021-03-27T22:55:00-05:00 (0 if there is no offset). */
export function offsetMinutes(iso: string): number {
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** Formats an instant in a fixed UTC offset (so the clock reads local time at the storm). */
export function formatAtOffset(ms: number, offsetMin: number, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(ms + offsetMin * 60_000);
}

/** "UTC-5" */
export function offsetLabel(offsetMin: number): string {
  const hours = offsetMin / 60;
  return `UTC${hours < 0 ? "-" : "+"}${Math.abs(hours)}`;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2012-06-29" -> "Jun 29" */
export function shortDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "2020-03-03T00:32:00-06:00" -> "Mar 3, 2020" (the date as written, no timezone shifting) */
export function niceDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
