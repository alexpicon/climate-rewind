/** Satellite lightning on the storm replay (lib/ui/lightning.ts): finding a night's file, the flashes at a moment, the counts. */
import { describe, expect, it } from "vitest";
import { FLASH_FADE_MS, flashesAt, lightningCounts, lightningFileFor, MAX_SHOWN, satelliteName, type LightningIndex, type LightningNight } from "@/lib/ui/lightning";

const START = "2021-03-28T03:05:00Z";
const at = (seconds: number) => Date.parse(START) + seconds * 1000;
const night = (flashes: LightningNight["flashes"]): LightningNight => ({
  source: "NOAA GOES-16 Geostationary Lightning Mapper, Level 2 flashes (AWS open data)",
  note: "",
  nightId: "2021-03-28T03:55",
  startUtc: START,
  endUtc: "2021-03-28T10:10:00Z",
  files: 1276,
  filesExpected: 1276,
  filesMissing: 0,
  flashes,
});

describe("lightningFileFor", () => {
  const index: LightningIndex = { nights: [{ slug: "nashville", nightId: "2021-03-28T03:55", lat: 36.168175, lon: -86.777516, file: "data/lightning/nashville/2021-03-28T0355.json", flashes: 10 }] };

  it("finds the sample's own night at its address", () => {
    expect(lightningFileFor(index, 36.1682, -86.7775, "2021-03-28T03:55")).toBe("data/lightning/nashville/2021-03-28T0355.json");
  });

  it("never lends it to another night or another street", () => {
    expect(lightningFileFor(index, 36.1682, -86.7775, "2019-02-07T01:45")).toBeNull();
    expect(lightningFileFor(index, 36.18, -86.7775, "2021-03-28T03:55")).toBeNull();
    expect(lightningFileFor(index, 36.1682, -86.7775, null)).toBeNull();
  });
});

describe("flashesAt", () => {
  const n = night([[10, 36.1, -86.7, 50, 40], [100, 36.2, -86.8, 8000, 300], [700, 36.3, -86.9, 5, 20]]);

  it("shows a flash at its moment at full strength, then fades it over FLASH_FADE_MS", () => {
    expect(flashesAt(n, at(100))).toEqual([
      { lat: 36.1, lon: -86.7, energy: 50, fresh: 1 - 90 / (FLASH_FADE_MS / 1000) },
      { lat: 36.2, lon: -86.8, energy: 8000, fresh: 1 },
    ]);
    // Just past the first flash's fade: it is gone, and the second is part way out.
    const later = flashesAt(n, at(10 + FLASH_FADE_MS / 1000 + 1));
    expect(later.map((f) => f.energy)).toEqual([8000]);
    expect(later[0].fresh).toBeCloseTo(1 - (FLASH_FADE_MS / 1000 + 1 - 90) / (FLASH_FADE_MS / 1000), 6);
  });

  it("shows nothing before the first flash and nothing from the future", () => {
    expect(flashesAt(n, at(5))).toEqual([]);
    expect(flashesAt(n, at(699)).map((f) => f.energy)).not.toContain(5);
  });

  it("draws at most MAX_SHOWN, the newest", () => {
    const dense = night(Array.from({ length: MAX_SHOWN + 50 }, (_, i) => [i * 0.01, 36, -86, i, 1] as [number, number, number, number, number]));
    const shown = flashesAt(dense, at(20));
    expect(shown).toHaveLength(MAX_SHOWN);
    expect(shown.at(-1)!.energy).toBe(MAX_SHOWN + 49);
  });
});

describe("lightningCounts and satelliteName", () => {
  it("counts the flashes so far against the night's total", () => {
    const n = night([[10, 0, 0, 1, 1], [20, 0, 0, 1, 1], [30, 0, 0, 1, 1]]);
    expect(lightningCounts(n, at(20))).toEqual({ total: 3, soFar: 2 });
    expect(lightningCounts(n, at(0))).toEqual({ total: 3, soFar: 0 });
  });

  it("names the satellite from the source line", () => {
    expect(satelliteName("NOAA GOES-17 Geostationary Lightning Mapper")).toBe("GOES-17");
    expect(satelliteName("something else")).toBe("a GOES satellite");
  });
});
