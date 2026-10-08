import { lerp } from "./anim";

/** [feels-like F, r, g, b]. The cool end stays quiet; the wave itself is a saturated red. */
export const HEAT_STOPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [76, 30, 80, 220],
  [84, 70, 100, 240],
  [90, 130, 64, 235],
  [95, 205, 36, 170],
  [99, 250, 24, 96],
  [103, 255, 12, 24],
  [108, 255, 30, 10],
  [112, 255, 72, 0],
  [115, 255, 140, 10],
  [118, 255, 225, 110],
];

export function heatRgb(value: number): [number, number, number] {
  const first = HEAT_STOPS[0];
  if (value <= first[0]) return [first[1], first[2], first[3]];
  for (let i = 1; i < HEAT_STOPS.length; i += 1) {
    const a = HEAT_STOPS[i - 1];
    const b = HEAT_STOPS[i];
    if (value <= b[0]) {
      const t = (value - a[0]) / (b[0] - a[0]);
      return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
    }
  }
  const last = HEAT_STOPS[HEAT_STOPS.length - 1];
  return [last[1], last[2], last[3]];
}

export const heatCss = (value: number) => `rgb(${heatRgb(value).map(Math.round).join(",")})`;
