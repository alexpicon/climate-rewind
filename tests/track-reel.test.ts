/** The landing page's tornado reel: the projection (lib/ui/albers.ts), the frame model (lib/ui/track-reel.ts) and the shipped file. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { albers, fitLower48 } from "@/lib/ui/albers";
import { decodeReel, DRAW_IN_DAYS, reelFrame, startedBy, type TrackFile } from "@/lib/ui/track-reel";

const file = (rows: number[][], deaths: Array<[number, number]> = []): TrackFile => ({
  source: "test",
  built: "2026-10-08",
  region: "lower 48 states",
  from: "2015-01-01",
  to: "2015-12-31",
  count: rows.length,
  ef: ["EFU", "EF0", "EF1", "EF2", "EF3", "EF4", "EF5"],
  tracks: rows.flat(),
  deaths,
});

describe("the Albers projection", () => {
  it("puts its centre at the origin and keeps north up and east right", () => {
    const [x, y] = albers(37.5, -96);
    expect(Math.abs(x)).toBeLessThan(1e-12);
    expect(Math.abs(y)).toBeLessThan(1e-12);
    expect(albers(40, -96)[1]).toBeGreaterThan(0);
    expect(albers(37.5, -90)[0]).toBeGreaterThan(0);
  });

  it("fits the lower 48 inside the box, with Seattle top left of Miami", () => {
    const fit = fitLower48(1600, 900);
    for (const [lat, lon] of [[47.61, -122.33], [25.76, -80.19], [44.8, -68.8], [32.7, -117.2]]) {
      const [x, y] = fit.toScreen(lat, lon);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1600);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(900);
    }
    const seattle = fit.toScreen(47.61, -122.33);
    const miami = fit.toScreen(25.76, -80.19);
    expect(seattle[0]).toBeLessThan(miami[0]);
    expect(seattle[1]).toBeLessThan(miami[1]);
  });

  it("anchoring right moves the map right without changing its size", () => {
    const centred = fitLower48(2000, 800, 0.06, 0.5);
    const right = fitLower48(2000, 800, 0.06, 1);
    expect(right.scale).toBe(centred.scale);
    expect(right.toScreen(37.5, -96)[0]).toBeGreaterThan(centred.toScreen(37.5, -96)[0]);
  });
});

describe("the reel's frames", () => {
  // Three tracks: an EF1 on day 0, an EF3 that killed 2 on day 100, an EF0 on day 300.
  const reel = decodeReel(file([[0, 3600, -8600, 3610, -8590, 2], [100, 3500, -9000, 3520, -8980, 4], [300, 4000, -9500, 4001, -9499, 1]], [[1, 2]]));

  it("decodes tracks with their points, rating and deaths", () => {
    expect(reel.tracks).toHaveLength(3);
    expect(reel.tracks[1]).toEqual({ day: 100, a: [35, -90], b: [35.2, -89.8], ef: "EF3", strong: true, deaths: 2 });
    expect(reel.spanDays).toBe(300 + DRAW_IN_DAYS);
  });

  it("counts started tracks by day, with ties", () => {
    expect(startedBy(reel.tracks, -1)).toBe(0);
    expect(startedBy(reel.tracks, 0)).toBe(1);
    expect(startedBy(reel.tracks, 100)).toBe(2);
    expect(startedBy(reel.tracks, 10_000)).toBe(3);
  });

  it("at the start nothing is counted, and at the end every track is drawn and counted", () => {
    expect(reelFrame(reel, 0)).toEqual(expect.objectContaining({ settled: 0, started: 1, count: 1, strong: 0, deaths: 0, year: 2015 }));
    const end = reelFrame(reel, 1);
    expect(end).toEqual(expect.objectContaining({ settled: 3, started: 3, count: 3, strong: 1, deaths: 2, progress: [] }));
  });

  it("a track draws in over DRAW_IN_DAYS, then settles", () => {
    const halfway = reelFrame(reel, (100 + DRAW_IN_DAYS / 2) / reel.spanDays);
    expect(halfway.settled).toBe(1);
    expect(halfway.started).toBe(2);
    expect(halfway.progress[0]).toBeCloseTo(0.5, 5);
    expect(halfway.deaths).toBe(2);
    const after = reelFrame(reel, (100 + DRAW_IN_DAYS + 1) / reel.spanDays);
    expect(after.settled).toBe(2);
  });
});

describe("the shipped tracks file", () => {
  const shipped = JSON.parse(readFileSync("public/data/tornado-tracks.json", "utf8")) as TrackFile;
  const reel = decodeReel(shipped);

  it("is whole, sorted by date and inside the lower 48", () => {
    expect(shipped.tracks.length).toBe(shipped.count * 6);
    expect(reel.tracks).toHaveLength(shipped.count);
    for (let i = 1; i < reel.tracks.length; i += 1) expect(reel.tracks[i].day).toBeGreaterThanOrEqual(reel.tracks[i - 1].day);
    for (const track of reel.tracks) {
      for (const [lat, lon] of [track.a, track.b]) {
        expect(lat).toBeGreaterThanOrEqual(24);
        expect(lat).toBeLessThanOrEqual(50);
        expect(lon).toBeGreaterThanOrEqual(-125.5);
        expect(lon).toBeLessThanOrEqual(-66);
      }
    }
  });

  it("holds the Nashville EF3 of Mar 3, 2020 at the NWS's own points", () => {
    const index = JSON.parse(gunzipSync(readFileSync("data/index/TN.json.gz")).toString("utf8")) as { tornadoes: Array<{ id: string; start: string; ef: string; begin: [number, number]; end: [number, number]; deaths: number }> };
    const nashville = index.tornadoes.find((t) => t.id === "SE-882999")!;
    const day = (Date.parse(nashville.start.slice(0, 10)) - Date.parse(shipped.from)) / 86_400_000;
    const match = reel.tracks.find((t) => t.day === day && t.ef === nashville.ef && Math.abs(t.a[0] - nashville.begin[0]) < 0.006 && Math.abs(t.a[1] - nashville.begin[1]) < 0.006);
    expect(match).toBeDefined();
    expect(match!.deaths).toBe(nashville.deaths);
  });
});
