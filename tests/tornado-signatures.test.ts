/** Radar rotation flags on the tornado replay (lib/ui/tornado-signatures.ts): the window per tornado, which to ask, what shows when. */
import { describe, expect, it } from "vitest";
import type { VortexSignature } from "@/lib/radar-signatures";
import type { NearbyTornado } from "@/lib/types";
import { buildTimeline } from "@/lib/ui/tornado-model";
import { BEFORE_MS, flagsAt, groundMs, MAX_TORNADOES, tornadoesToAsk, TRACK_PAD_DEG, windowFor } from "@/lib/ui/tornado-signatures";

const tornado = (id: string, ef: string, start: string, km: number, lengthMi = 10): NearbyTornado => ({
  id,
  start,
  ef,
  begin: [36.19, -87.18],
  end: [36.17, -86.6],
  widthYd: 800,
  lengthMi,
  deaths: 0,
  injuries: 0,
  narrative: "A tornado touched down.",
  episodeNarrative: "",
  minDistanceKm: km,
  closest: [36.17, -86.78],
});

describe("windowFor", () => {
  it("pads the track's box and runs from 20 minutes before touchdown through its time on the ground", () => {
    const w = windowFor(tornado("SE-882999", "EF3", "2020-03-03T00:32:00-06:00", 0.65, 21.49));
    expect(w.bounds.map((v) => Number(v.toFixed(3)))).toEqual([-87.18 - TRACK_PAD_DEG, 36.17 - TRACK_PAD_DEG, -86.6 + TRACK_PAD_DEG, 36.19 + TRACK_PAD_DEG].map((v) => Number(v.toFixed(3))));
    expect(w.startMs).toBe(Date.parse("2020-03-03T06:32:00Z") - BEFORE_MS);
    expect(w.endMs).toBe(Date.parse("2020-03-03T06:32:00Z") + groundMs(21.49));
  });

  it("allows at least 20 minutes on the ground, and two minutes a mile beyond that", () => {
    expect(groundMs(3)).toBe(20 * 60_000);
    expect(groundMs(21.5)).toBe(43 * 60_000);
  });
});

describe("tornadoesToAsk", () => {
  it("asks about the strongest first, then the closest, at most MAX_TORNADOES", () => {
    const many = Array.from({ length: MAX_TORNADOES + 3 }, (_, i) => tornado(`SE-${i}`, i === 7 ? "EF3" : "EF0", "2019-01-01T00:00:00-06:00", 10 - i * 0.1));
    const asked = tornadoesToAsk(many);
    expect(asked).toHaveLength(MAX_TORNADOES);
    expect(asked[0].id).toBe("SE-7");
    expect(asked[1].minDistanceKm).toBeLessThan(asked[2].minDistanceKm);
  });
});

describe("flagsAt", () => {
  const t = tornado("SE-1", "EF3", "2020-03-03T00:32:00-06:00", 0.65, 10);
  const timeline = buildTimeline([t]);
  const item = timeline.items[0];
  const w = windowFor(t);
  const flag = (fraction: number): VortexSignature => ({ t: w.startMs + fraction * (w.endMs - w.startMs), lat: 36.18, lon: -87, kind: "TVS", shear: 60, deltaV: 100, radar: "KBNA" });
  const byId = new Map([["SE-1", [flag(0.1), flag(0.5), flag(0.9)]]]);

  it("reveals flags in time order as the track draws", () => {
    expect(flagsAt(timeline, byId, item.startMs - 1)).toEqual([]);
    expect(flagsAt(timeline, byId, item.startMs + item.drawMs * 0.5).map((f) => f.flag.t)).toEqual([flag(0.1).t, flag(0.5).t]);
    expect(flagsAt(timeline, byId, item.startMs + item.drawMs).every((f) => f.fresh === 1)).toBe(true);
  });

  it("fades them over the hold, then clears them", () => {
    const mid = flagsAt(timeline, byId, item.startMs + item.drawMs + item.holdMs / 2);
    expect(mid).toHaveLength(3);
    expect(mid[0].fresh).toBeCloseTo(0.5, 5);
    expect(flagsAt(timeline, byId, item.startMs + item.drawMs + item.holdMs + 1)).toEqual([]);
  });

  it("a tornado that was not asked about shows nothing", () => {
    expect(flagsAt(timeline, new Map(), item.startMs + item.drawMs)).toEqual([]);
  });
});

describe("nearTrack", () => {
  it("keeps flags within NEAR_TRACK_KM of the path and drops other storms' flags", async () => {
    const { nearTrack, NEAR_TRACK_KM } = await import("@/lib/ui/tornado-signatures");
    const path = { begin: [36.1717, -86.9562] as [number, number], end: [36.1767, -86.5717] as [number, number] };
    const at = (lat: number, lon: number): VortexSignature => ({ t: 0, lat, lon, kind: "TVS", shear: 60, deltaV: 100, radar: "KBNA" });
    const onPath = at(36.174, -86.76);
    const near = at(36.174 + (NEAR_TRACK_KM - 1) / 111, -86.76);
    const far = at(36.174 + (NEAR_TRACK_KM + 3) / 111, -86.76);
    expect(nearTrack([onPath, near, far], path)).toEqual([onPath, near]);
  });
});
