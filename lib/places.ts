/**
 * The search box's city fallback: when the Census finds no street address, "Fort Myers, FL", "Fort Myers, Florida" or just "Fort Myers"
 * opens at the centre of that city. The list is every US city, town and census-designated place from the Census Gazetteer, with its
 * population (lib/places-data.ts, built by scripts/build-places.py). Server only.
 */
import { PLACES_DATA } from "./places-data";

export interface Place {
  name: string;
  state: string;
  lat: number;
  lon: number;
  population: number;
}

export type PlaceMatch = { kind: "one"; place: Place } | { kind: "many"; name: string; choices: string[] } | null;

/** The 50 states and DC, the area our storm records cover. */
const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** One spelling for both sides: no accents, no punctuation, and "Saint", "Fort" and "Mount" the same as "St", "Ft" and "Mt". */
export function normalizePlace(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\bsaint\b/g, "st")
    .replace(/\bfort\b/g, "ft")
    .replace(/\bmount\b/g, "mt");
}

const STATE_BY_TEXT = new Map<string, string>();
for (const [code, name] of Object.entries(STATES)) {
  STATE_BY_TEXT.set(code.toLowerCase(), code);
  STATE_BY_TEXT.set(normalizePlace(name), code);
}

let index: Map<string, Place[]> | null = null;

function placeIndex(): Map<string, Place[]> {
  if (index) return index;
  index = new Map();
  for (const line of PLACES_DATA.split("\n")) {
    const [name, state, lat, lon, population] = line.split("|");
    if (!STATES[state]) continue;
    const key = normalizePlace(name);
    const list = index.get(key) ?? [];
    // The same name twice in one state (a city and a census-designated place): keep the bigger.
    const same = list.findIndex((p) => p.state === state);
    const place = { name, state, lat: Number(lat), lon: Number(lon), population: Number(population) };
    if (same === -1) list.push(place);
    else if (place.population > list[same].population) list[same] = place;
    index.set(key, list);
  }
  for (const list of index.values()) list.sort((a, b) => b.population - a.population);
  return index;
}

/** A name with no state picks the biggest place only when it is at least this many times bigger than the next one. */
const CLEAR_LEAD = 10;
const MAX_CHOICES = 6;
const BIG_CITY = 100_000;

/** "City, ST", "City, State", "City ST", "City State" or "City". Null when nothing matches. */
export function findPlace(input: string): PlaceMatch {
  const text = input.replace(/\b\d{5}(-\d{4})?\s*$/, "").trim();
  const places = placeIndex();

  // A state at the end: after the last comma, or the last one to three words.
  const comma = text.lastIndexOf(",");
  const tries: Array<[string, string | null]> = [];
  if (comma > 0) {
    const state = STATE_BY_TEXT.get(normalizePlace(text.slice(comma + 1)));
    if (state) tries.push([normalizePlace(text.slice(0, comma)), state]);
  } else {
    const words = normalizePlace(text).split(" ");
    for (let n = 3; n >= 1; n--) {
      if (words.length <= n) continue;
      const state = STATE_BY_TEXT.get(words.slice(-n).join(" "));
      if (state) tries.push([words.slice(0, -n).join(" "), state]);
    }
  }
  for (const [city, state] of tries) {
    const hit = places.get(city)?.find((p) => p.state === state);
    if (hit) return { kind: "one", place: hit };
  }
  // A comma that is not followed by a state ("Fort Myers, somewhere") is not a city search.
  if (comma > 0) return null;

  const list = places.get(normalizePlace(text));
  if (!list?.length) return null;
  // A state's name alone ("Texas", "Indiana") means the state, not a small town named after it; New York and Washington, DC are kept.
  if (STATE_BY_TEXT.has(normalizePlace(text)) && list[0].population < BIG_CITY) return null;
  if (list.length === 1 || list[0].population >= CLEAR_LEAD * Math.max(1, list[1].population)) return { kind: "one", place: list[0] };
  return { kind: "many", name: list[0].name, choices: list.slice(0, MAX_CHOICES).map((p) => `${p.name}, ${p.state}`) };
}

/** How a city search shows where it is, everywhere the matched address is shown. */
export const placeLabel = (place: Place): string => `Center of ${place.name}, ${place.state}`;
