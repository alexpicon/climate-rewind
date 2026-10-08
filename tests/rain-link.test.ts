import { describe, expect, it } from "vitest";
import { dbzOfPixel, HEAVY_DBZ, peakNear, pixelOf, rainBeforeReport, rainNoteText, type PixelFrame } from "@/lib/ui/rain-link";

// A radar box around Nashville, like the replay's: [west, south, east, north].
const BOUNDS: [number, number, number, number] = [-87.5, 35.6, -86.0, 36.7];
const W = 300;
const H = 220;
const SPOT: [number, number] = [36.17, -86.78];

const YELLOW = [234, 210, 4]; // 40 dBZ in IEM's table
const RED = [255, 0, 0]; // 50 dBZ
const GREEN = [13, 158, 17]; // 28 dBZ
const BLUE = [67, 97, 162]; // 10 dBZ

/** A blank frame with one block of a colour painted over `at`. */
function frame(paint?: { at: [number, number]; rgb: number[]; half?: number }): PixelFrame {
  const data = new Uint8ClampedArray(W * H * 4); // all transparent
  if (paint) {
    const { x, y } = pixelOf(BOUNDS, W, H, paint.at);
    const half = paint.half ?? 4;
    for (let py = Math.floor(y) - half; py <= Math.floor(y) + half; py += 1) {
      for (let px = Math.floor(x) - half; px <= Math.floor(x) + half; px += 1) {
        const i = (py * W + px) * 4;
        data.set([...paint.rgb, 255], i);
      }
    }
  }
  return { width: W, height: H, data };
}

describe("dbzOfPixel", () => {
  it("reads IEM's colour table back into dBZ", () => {
    expect(dbzOfPixel(...(YELLOW as [number, number, number]), 255)).toBe(40);
    expect(dbzOfPixel(...(RED as [number, number, number]), 255)).toBe(50);
    expect(dbzOfPixel(...(GREEN as [number, number, number]), 255)).toBe(28);
    // A slightly different palette entry (the picture is re-quantised) still lands on the nearest value.
    expect(dbzOfPixel(236, 208, 6, 255)).toBe(40);
  });
  it("ignores clear sky and colours that are not on the scale", () => {
    expect(dbzOfPixel(0, 0, 0, 0)).toBeNull();
    expect(dbzOfPixel(10, 10, 200, 255)).toBeNull();
  });
});

describe("pixelOf", () => {
  it("puts the corners of the box on the corners of the picture", () => {
    expect(pixelOf(BOUNDS, W, H, [36.7, -87.5])).toEqual({ x: 0, y: 0 });
    const se = pixelOf(BOUNDS, W, H, [35.6, -86]);
    expect(se.x).toBeCloseTo(W, 6);
    expect(se.y).toBeCloseTo(H, 6);
  });
});

describe("peakNear", () => {
  it("finds the strongest pixel within about 1 km", () => {
    expect(peakNear(frame({ at: SPOT, rgb: RED }), BOUNDS, SPOT)).toBe(50);
  });
  it("finds nothing when the rain is well away from the point", () => {
    expect(peakNear(frame({ at: [36.4, -86.4], rgb: RED }), BOUNDS, SPOT)).toBeNull();
  });
  it("is null for a point off the picture", () => {
    expect(peakNear(frame(), BOUNDS, [40, -80])).toBeNull();
  });
});

describe("rainBeforeReport", () => {
  const MIN = 60_000;
  const t0 = Date.parse("2021-03-28T03:00:00Z");
  const frameTimesMs = Array.from({ length: 36 }, (_, i) => t0 + i * 5 * MIN); // 03:00 to 05:55
  const reportMs = t0 + 100 * MIN; // 04:40

  it("says heavy when a loaded frame in the prior hour shows it over the spot, and how long before", () => {
    const heavyAt = 17; // 04:25, 15 min before the report
    const link = rainBeforeReport({
      at: SPOT,
      ms: reportMs,
      bounds: BOUNDS,
      frameTimesMs,
      frame: (i) => (i === heavyAt ? frame({ at: SPOT, rgb: YELLOW }) : i >= 8 && i <= 20 ? frame() : null),
    });
    expect(link).toMatchObject({ level: "heavy", peakDbz: 40, minutesBefore: 15 });
    expect(rainNoteText(link!)).toEqual({ text: "Filed after heavy rain crossed this spot", detail: "Radar showed it about 15 min earlier, within about 1 km" });
  });

  it("says very heavy for red, and 'while' when it was over the spot as the report came in", () => {
    const link = rainBeforeReport({ at: SPOT, ms: reportMs, bounds: BOUNDS, frameTimesMs, frame: (i) => (i === 20 ? frame({ at: SPOT, rgb: RED }) : null) });
    expect(link).toMatchObject({ level: "very heavy", peakDbz: 50, minutesBefore: 0 });
    expect(rainNoteText(link!).text).toBe("Filed while very heavy rain was over this spot");
  });

  it("says nothing for light or moderate rain", () => {
    const link = rainBeforeReport({ at: SPOT, ms: reportMs, bounds: BOUNDS, frameTimesMs, frame: () => frame({ at: SPOT, rgb: GREEN }) });
    expect(link).toBeNull();
    expect(HEAVY_DBZ).toBeGreaterThan(28);
    expect(rainBeforeReport({ at: SPOT, ms: reportMs, bounds: BOUNDS, frameTimesMs, frame: () => frame({ at: SPOT, rgb: BLUE }) })).toBeNull();
  });

  it("says nothing when there is no rain, or the rain is elsewhere", () => {
    expect(rainBeforeReport({ at: SPOT, ms: reportMs, bounds: BOUNDS, frameTimesMs, frame: () => frame() })).toBeNull();
    expect(rainBeforeReport({ at: SPOT, ms: reportMs, bounds: BOUNDS, frameTimesMs, frame: () => frame({ at: [36.45, -86.3], rgb: RED }) })).toBeNull();
  });

  it("ignores heavy rain that fell before the 60 minute window, or after the report", () => {
    const old = rainBeforeReport({ at: SPOT, ms: reportMs, bounds: BOUNDS, frameTimesMs, frame: (i) => (i === 5 ? frame({ at: SPOT, rgb: RED }) : null) }); // 03:25, 75 min before
    expect(old).toBeNull();
    const later = rainBeforeReport({ at: SPOT, ms: reportMs, bounds: BOUNDS, frameTimesMs, frame: (i) => (i === 25 ? frame({ at: SPOT, rgb: RED }) : null) }); // after
    expect(later).toBeNull();
  });

  it("makes no claim when the frames have not loaded", () => {
    expect(rainBeforeReport({ at: SPOT, ms: reportMs, bounds: BOUNDS, frameTimesMs, frame: () => null })).toBeNull();
  });
});
