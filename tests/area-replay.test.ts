/** The area replay: the server's compact events and outlines (lib/area-replay.ts) and the frames (lib/ui/area-replay-model.ts). */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildAreaReplay, type AreaReplay } from "@/lib/area-replay";
import { buildReplayModel, finalTint, LIGHT_DAYS, replayDate, replayFrame, RESIDUE } from "@/lib/ui/area-replay-model";

const HERE = { lat: 36.17, lon: -86.78 };
const square = (west: number, south: number, east: number, north: number) => [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]];
const row = (id: string, code: string, type: string, start: string, extra: Record<string, unknown> = {}) => ({
  id,
  episodeId: null,
  type,
  start,
  end: null,
  area: { kind: code[2], code, name: code },
  deaths: 0,
  injuries: 0,
  damageUsd: 0,
  magnitude: null,
  magnitudeType: null,
  narrative: "",
  episodeNarrative: "",
  ...extra,
});

function eventsDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "area-replay-"));
  mkdirSync(path.join(dir, "TN"));
  const write = (name: string, body: unknown) => writeFileSync(path.join(dir, "TN", name), name.endsWith(".gz") ? gzipSync(JSON.stringify(body)) : JSON.stringify(body));
  write("zones.json", {
    TNZ027: { name: "Davidson", bbox: [-87.1, 35.9, -86.5, 36.4], polygon: { type: "MultiPolygon", coordinates: square(-87.1, 35.9, -86.5, 36.4) } },
    TNZ099: { name: "Far Away", bbox: [-84, 35, -83.5, 35.5], polygon: { type: "MultiPolygon", coordinates: square(-84, 35, -83.5, 35.5) } },
  });
  write("county-areas.json", { TNC037: ["TNC037", "TNZ027"] });
  write("TNC037.json.gz", { events: [row("SE-1", "TNC037", "Thunderstorm Wind", "2010-06-01T15:00:00-05:00"), row("SE-OLD", "TNC037", "Hail", "1998-05-01T15:00:00-05:00")] });
  write("TNZ027.json.gz", { events: [row("SE-2", "TNZ027", "Excessive Heat", "2012-06-29T12:00:00-05:00", { deaths: 3 }), row("SE-3", "TNZ027", "High Wind", "2012-07-01T12:00:00-05:00")] });
  return dir;
}

describe("buildAreaReplay", () => {
  it("lists every event since 2000 compactly, with the zone outlines each area lights", async () => {
    const replay = (await buildAreaReplay(HERE.lat, HERE.lon, "TN", "TNC037", eventsDir()))!;
    expect(replay.since).toBe(2000);
    expect(replay.types).toEqual(["Thunderstorm Wind", "Excessive Heat", "High Wind"]);
    expect(replay.areas.map((a) => [a.code, a.tier, a.shapes])).toEqual([
      ["TNC037", "county", ["TNZ027"]],
      ["TNZ027", "your zone", ["TNZ027"]],
    ]);
    expect(Object.keys(replay.shapes)).toEqual(["TNZ027"]);
    // Day 3804 is June 1, 2010 counted from Jan 1, 2000. The 1998 hail is before the replay starts.
    expect(replay.events[0]).toEqual([3804, 0, 0, 0, 0, 0]);
    expect(replay.events.map((e) => e[3])).toEqual([0, 3, 0]);
  });

  it("names a county as people say it, and leaves a zone's name alone", async () => {
    const { areaName } = await import("@/lib/area-replay");
    expect(areaName("KING", "C", "WAC033")).toBe("King County");
    expect(areaName("ORLEANS", "C", "LAC071")).toBe("Orleans Parish");
    expect(areaName("ST. LOUIS (C)", "C", "MOC510")).toBe("St. Louis City");
    expect(areaName("BALTIMORE CITY", "C", "MDC510")).toBe("Baltimore City");
    expect(areaName("ANCHORAGE", "C", "AKC020")).toBe("Anchorage");
    expect(areaName("Bellevue and Vicinity", "Z", "WAZ556")).toBe("Bellevue and Vicinity");
  });

  it("refuses a county from another state, and a state with no events is null", async () => {
    expect(await buildAreaReplay(HERE.lat, HERE.lon, "TN", "KYC001", eventsDir())).toBeNull();
    expect(await buildAreaReplay(HERE.lat, HERE.lon, "TX", "TXC001", eventsDir())).toBeNull();
  });
});

describe("the replay's frames", () => {
  const replay: AreaReplay = {
    source: "test",
    since: 2000,
    types: ["High Wind", "Excessive Heat", "Flash Flood"],
    areas: [
      { code: "TNC037", name: "Davidson", kind: "C", tier: "county", shapes: ["TNZ027"] },
      { code: "TNZ027", name: "Davidson", kind: "Z", tier: "your zone", shapes: ["TNZ027"] },
    ],
    shapes: {},
    events: [
      [100, 0, 0, 0, 0, 0],
      [110, 1, 1, 3, 0, 0],
      [5000, 2, 1, 0, 0, 2_500_000],
    ],
  };
  const model = buildReplayModel(replay);
  const at = (day: number) => replayFrame(model, day / model.spanDays);

  it("flares an area on its event's date, fading over LIGHT_DAYS to a glow that grows with its events so far", () => {
    // Area 1 is the busiest, with 2 events: one event is worth RESIDUE * ln 2 / ln 3.
    const oneEvent = (RESIDUE * Math.log(2)) / Math.log(3);
    expect(at(99).lit).toEqual([]);
    expect(at(110).lit).toEqual([
      { area: 0, family: "wind", strength: 1 - 10 / LIGHT_DAYS },
      { area: 1, family: "heat", strength: 1 },
    ]);
    const after = at(110 + LIGHT_DAYS + 1).lit;
    expect(after.map((a) => [a.area, a.family])).toEqual([[0, "wind"], [1, "heat"]]);
    for (const a of after) expect(a.strength).toBeCloseTo(oneEvent, 6);
    // The busiest area at the end of its events glows at RESIDUE.
    expect(at(5000 + LIGHT_DAYS).lit.find((a) => a.area === 1)?.strength).toBeCloseTo(RESIDUE, 6);
  });

  it("counts by family and deaths so far, and names the latest notable event within a year", () => {
    const frame = at(120);
    expect(frame.total).toBe(2);
    expect(frame.counts.wind).toBe(1);
    expect(frame.counts.heat).toBe(1);
    expect(frame.deaths).toBe(3);
    expect(frame.notable?.type).toBe("Excessive Heat");
    expect(at(110 + 400).notable).toBeNull();
    expect(at(5000).notable?.damageUsd).toBe(2_500_000);
    expect(at(5000).year).toBe(2013);
  });

  it("the finished picture colours each area by the family filed most there", () => {
    const tint = finalTint(model);
    // Area 1 has one heat and one flood event: a tie goes to the family listed first (rain and flooding before heat).
    expect(tint.map((t) => [t.area, t.family])).toEqual([[0, "wind"], [1, "water"]]);
    expect(tint.find((t) => t.area === 1)!.strength).toBe(1);
  });

  it("dates read plainly", () => {
    expect(replayDate(model, 110)).toBe("Apr 20, 2000");
  });
});
