/**
 * The event replays the landing page offers, and what the player needs to know about each beyond its data file: the local clock,
 * how long it plays, how often the radar is sampled, and the honest words around the model's wind.
 */
export interface EventEntry {
  id: string;
  title: string;
  /** "Sep 28 to 29, 2022 · southwest Florida" */
  when: string;
  /** One line for the landing card. */
  hook: string;
  /** What the replay shows, for the panel. */
  lede: string;
  /** Said plainly when the model and the ground disagree. */
  caveat: string | null;
  offsetMin: number;
  zone: string;
  /** How long the replay plays at 1x. */
  durationMs: number;
  /** Minutes between radar frames. */
  radarEveryMin: number;
  /** What the arrows open on. */
  field: "speed" | "gust";
  /** "hurricane" draws the best track and wind radii. */
  kind: "hurricane" | "derecho";
}

export const EVENTS: readonly EventEntry[] = [
  {
    id: "ian",
    title: "Hurricane Ian makes landfall",
    when: "Sep 28 to 29, 2022 · southwest Florida",
    hook: "A Category 4 eyewall comes ashore at Cayo Costa, and the wind field swings across the whole peninsula.",
    lede:
      "Hour by hour, the wind a NOAA weather model saw over Florida as Ian came ashore, with the hurricane's official track and how far its tropical-storm and hurricane-force winds reached, the archived radar, and every storm report as it was filed.",
    caveat: null,
    offsetMin: -240,
    zone: "EDT",
    durationMs: 40_000,
    radarEveryMin: 30,
    field: "speed",
    kind: "hurricane",
  },
  {
    id: "derecho",
    title: "The Iowa derecho",
    when: "Aug 10, 2020 · Iowa and Illinois",
    hook: "A line of storms crosses Iowa in an afternoon; a 126 mph gust is measured at Atkins, near Cedar Rapids.",
    lede:
      "The 2020 derecho, by NOAA's count the costliest thunderstorm event in US records, crossing Iowa and into Illinois: the archived radar, the wind a NOAA weather model saw each hour, and the National Weather Service's reports of measured and estimated gusts and damage as they came in.",
    caveat:
      "The model's hourly snapshot misses gusts that lasted minutes: it peaks near 60 mph while the ground measured 126. The reports are the measurements; the arrows show the pattern.",
    offsetMin: -300,
    zone: "CDT",
    durationMs: 30_000,
    radarEveryMin: 15,
    field: "gust",
    kind: "derecho",
  },
  {
    id: "helene",
    title: "Hurricane Helene, Gulf to mountains",
    when: "Sep 26 to 27, 2024 · Florida to the Carolinas",
    hook: "Landfall in Florida's Big Bend at night, then a hurricane still as it races into Georgia, and on into the southern Appalachians.",
    lede:
      "Helene from the Gulf to the southern Appalachians: the wind a NOAA weather model saw each hour, the hurricane's official track and wind reach, the archived radar, and almost a thousand storm reports, from storm surge on the coast to flash floods in the mountains.",
    caveat: null,
    offsetMin: -240,
    zone: "EDT",
    durationMs: 40_000,
    radarEveryMin: 30,
    field: "speed",
    kind: "hurricane",
  },
];

export function eventEntry(id: string | null | undefined): EventEntry | null {
  return EVENTS.find((e) => e.id === id) ?? null;
}

export const eventPath = (id: string) => `/event/${id}`;
