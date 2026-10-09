/**
 * Wind speed to colour for the event replays' arrows, with the stops on the thresholds people know: tropical-storm force (39 mph),
 * severe (58), hurricane (74), and Saffir-Simpson categories 2 to 4. Quantised into buckets so a frame draws one path per colour.
 */
export const WIND_STOPS: ReadonlyArray<{ mph: number; rgb: [number, number, number]; label: string }> = [
  { mph: 0, rgb: [92, 128, 170], label: "Calm" },
  { mph: 15, rgb: [79, 195, 217], label: "15 mph" },
  { mph: 25, rgb: [94, 224, 138], label: "25 mph" },
  { mph: 39, rgb: [242, 224, 90], label: "39 mph, tropical-storm force" },
  { mph: 58, rgb: [255, 159, 64], label: "58 mph, severe" },
  { mph: 74, rgb: [255, 77, 77], label: "74 mph, hurricane force" },
  { mph: 96, rgb: [255, 45, 138], label: "96 mph, Category 2" },
  { mph: 111, rgb: [214, 77, 255], label: "111 mph, Category 3" },
  { mph: 130, rgb: [255, 255, 255], label: "130 mph, Category 4" },
];

/** Colour buckets: one every 4 mph up to 140. */
export const WIND_BUCKET_MPH = 4;
export const WIND_BUCKETS = Math.ceil(140 / WIND_BUCKET_MPH) + 1;

export function windRgb(mph: number): [number, number, number] {
  const stops = WIND_STOPS;
  if (mph <= stops[0].mph) return stops[0].rgb;
  for (let i = 1; i < stops.length; i += 1) {
    if (mph <= stops[i].mph) {
      const a = stops[i - 1];
      const b = stops[i];
      const t = (mph - a.mph) / (b.mph - a.mph);
      return [0, 1, 2].map((k) => Math.round(a.rgb[k] + (b.rgb[k] - a.rgb[k]) * t)) as [number, number, number];
    }
  }
  return stops[stops.length - 1].rgb;
}

export const windBucket = (mph: number) => Math.min(WIND_BUCKETS - 1, Math.max(0, Math.round(mph / WIND_BUCKET_MPH)));

/** "rgb(...)" for each bucket's middle speed. */
export const WIND_BUCKET_CSS: readonly string[] = Array.from({ length: WIND_BUCKETS }, (_, i) => {
  const [r, g, b] = windRgb(i * WIND_BUCKET_MPH);
  return `rgb(${r},${g},${b})`;
});

/** An arrow's length in screen pixels for a wind speed: long enough to read the difference between a breeze and a hurricane. */
export const arrowLength = (mph: number) => 5 + Math.min(mph, 150) * 0.24;
