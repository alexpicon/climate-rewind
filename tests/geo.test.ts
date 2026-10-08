import { describe, expect, it } from "vitest";
import { boxAround, compassWord, distanceToSegmentKm, haversineKm, segmentDistance } from "@/lib/geo";

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm([36.17, -86.78], [36.17, -86.78])).toBe(0);
  });

  it("matches a known distance: Nashville to Memphis is about 316 km", () => {
    const km = haversineKm([36.1627, -86.7816], [35.1495, -90.049]);
    expect(km).toBeGreaterThan(310);
    expect(km).toBeLessThan(322);
  });

  it("is symmetric", () => {
    const a: [number, number] = [36.1, -86.7];
    const b: [number, number] = [35.9, -86.1];
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
});

describe("segmentDistance (tornado track distance)", () => {
  const origin: [number, number] = [36.17, -86.78];

  it("measures straight to the line when the point is abeam of the segment", () => {
    // An east-west track 0.045 degrees north of the origin: about 5 km.
    const hit = segmentDistance(origin, [36.215, -86.9], [36.215, -86.6]);
    expect(hit.km).toBeGreaterThan(4.9);
    expect(hit.km).toBeLessThan(5.1);
    expect(hit.nearest[1]).toBeCloseTo(-86.78, 3); // lands directly north of the origin
  });

  it("clamps to the nearest end when the point is beyond the segment", () => {
    // Track ends 0.1 degrees of longitude (about 9 km) east of the origin.
    const hit = segmentDistance(origin, [36.17, -86.68], [36.17, -86.5]);
    expect(hit.km).toBeGreaterThan(8.5);
    expect(hit.km).toBeLessThan(9.5);
    expect(hit.nearest).toEqual([36.17, -86.68]);
  });

  it("handles a zero-length track as a point", () => {
    const km = distanceToSegmentKm(origin, [36.215, -86.78], [36.215, -86.78]);
    expect(km).toBeGreaterThan(4.9);
    expect(km).toBeLessThan(5.1);
  });

  it("is zero when the point is on the track", () => {
    expect(distanceToSegmentKm(origin, [36.17, -86.9], [36.17, -86.6])).toBeCloseTo(0, 6);
  });
});

describe("compassWord", () => {
  it("names the eight directions", () => {
    const o: [number, number] = [36, -86];
    expect(compassWord(o, [36.5, -86])).toBe("north");
    expect(compassWord(o, [36, -85.5])).toBe("east");
    expect(compassWord(o, [35.5, -86])).toBe("south");
    expect(compassWord(o, [36, -86.5])).toBe("west");
    expect(compassWord(o, [35.9, -85.9])).toBe("southeast");
  });
});

describe("boxAround", () => {
  it("contains points inside the radius", () => {
    const [west, south, east, north] = boxAround([36.17, -86.78], 120);
    expect(west).toBeLessThan(-86.78);
    expect(east).toBeGreaterThan(-86.78);
    expect(south).toBeLessThan(36.17);
    expect(north).toBeGreaterThan(36.17);
    // roughly 1.08 degrees of latitude either way
    expect(north - 36.17).toBeCloseTo(1.085, 2);
  });
});
