/** The event replays' model (lib/ui/event-model.ts), wind colours (lib/ui/wind-colors.ts), and the shipped public/data/events files. */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVENTS } from "@/lib/ui/event-catalog";
import {
  buildEventModel,
  categoryOf,
  eventFrame,
  keyMomentP,
  kindCounts,
  reportKind,
  reportsUpTo,
  stormAt,
  windAt,
  type EventPackage,
  type EventReport,
  type EventTrackPoint,
} from "@/lib/ui/event-model";
import { WIND_STOPS, arrowLength, windBucket, windRgb } from "@/lib/ui/wind-colors";

const H0 = "2022-09-28T00:00:00Z";
const H1 = "2022-09-28T01:00:00Z";
const T0 = Date.parse(H0);
const HOUR = 3_600_000;

const fix = (t: string, lat: number, lon: number, windKt: number, landfall = false, r64 = [0, 0, 0, 0]): EventTrackPoint => ({
  t,
  lat,
  lon,
  windKt,
  pressureMb: 950,
  status: "HU",
  landfall,
  r34: [100, 100, 100, 100],
  r50: [50, 50, 50, 50],
  r64,
});

const report = (t: string, type: string, mag: number | null = null, unit = "", measured = false): EventReport => ({
  t,
  lat: 26.5,
  lon: -82.5,
  type,
  mag,
  unit,
  measured,
  city: "TEST",
  state: "FL",
  remark: "",
});

/** A 2 by 2 grid (26 to 27 N, 83 to 82 W), two hours: the wind from the west, then from the north and twice as strong. */
function pkg(overrides: Partial<EventPackage> = {}): EventPackage {
  return {
    id: "test",
    title: "Test",
    startUtc: H0,
    endUtc: H1,
    box: [26, 27, -83, -82],
    built: H0,
    wind: {
      source: "test",
      step: 1,
      south: 26,
      west: -83,
      rows: 2,
      cols: 2,
      hours: [H0, H1],
      speed: [[10, 10, 30, 30], [20, 20, 60, 60]],
      dir: [[270, 270, 270, 270], [0, 0, 0, 0]],
      gust: [[15, 15, 45, 45], [30, 30, 90, 90]],
    },
    track: [fix(H0, 26, -83, 100), fix("2022-09-28T00:30:00Z", 26.5, -82.5, 130, true, [20, 20, 20, 20]), fix(H1, 27, -82, 120)],
    trackSource: "test",
    reports: [
      report("2022-09-28T00:40:00Z", "TSTM WND GST", 90, "MPH", true),
      report("2022-09-28T00:10:00Z", "NON-TSTM WND GST", 50, "KTS"),
      report("2022-09-28T00:20:00Z", "TORNADO"),
      report("2022-09-28T00:50:00Z", "TSTM WND GST", 70, "MPH"),
    ],
    reportsSource: "test",
    ...overrides,
  };
}

describe("windAt", () => {
  const model = buildEventModel(pkg());

  it("points the arrow where the wind blows to, not where it comes from", () => {
    const west = windAt(model, 0, 26, -83)!;
    expect(west.dx).toBeCloseTo(1);
    expect(west.dy).toBeCloseTo(0);
    const north = windAt(model, 1, 26, -83)!;
    expect(north.dx).toBeCloseTo(0);
    // Screen y grows southward: a north wind blows down the screen.
    expect(north.dy).toBeCloseTo(1);
  });

  it("blends speeds bilinearly in space and linearly in time", () => {
    expect(windAt(model, 0, 26.5, -82.5)!.speed).toBeCloseTo(20);
    expect(windAt(model, 0.5, 26, -83)!.speed).toBeCloseTo(15);
    expect(windAt(model, 1, 27, -82, "gust")!.speed).toBeCloseTo(90);
  });

  it("keeps a turning wind's strength between hours (speeds blend as numbers, directions as vectors)", () => {
    const half = windAt(model, 0.5, 26, -83)!;
    expect(half.speed).toBeCloseTo(15);
    expect(Math.hypot(half.dx, half.dy)).toBeCloseTo(1);
    // Between a west wind (blowing east) and a north wind (blowing south), weighted toward the stronger.
    expect(half.dx).toBeGreaterThan(0);
    expect(half.dy).toBeGreaterThan(half.dx);
  });

  it("is null outside the grid", () => {
    expect(windAt(model, 0, 25.9, -82.5)).toBeNull();
    expect(windAt(model, 0, 26.5, -81.9)).toBeNull();
  });
});

describe("the hurricane", () => {
  const model = buildEventModel(pkg());

  it("moves between fixes and quotes the latest fix, never a blended number", () => {
    const at = stormAt(model, T0 + 15 * 60_000)!;
    expect(at.lat).toBeCloseTo(26.25);
    expect(at.lon).toBeCloseTo(-82.75);
    expect(at.fix.windKt).toBe(100);
    expect(at.r64[0]).toBeCloseTo(10);
    expect(stormAt(model, T0 + 30 * 60_000)!.fix.windKt).toBe(130);
  });

  it("is absent outside the track and for an event without one", () => {
    expect(stormAt(model, T0 - 1)).toBeNull();
    expect(stormAt(buildEventModel(pkg({ track: null })), T0)).toBeNull();
  });

  it("names the Saffir-Simpson category from the best-track wind", () => {
    expect(categoryOf(30)).toBe("Tropical depression");
    expect(categoryOf(34)).toBe("Tropical storm");
    expect(categoryOf(64)).toBe("Category 1");
    expect(categoryOf(83)).toBe("Category 2");
    expect(categoryOf(96)).toBe("Category 3");
    expect(categoryOf(130)).toBe("Category 4");
    expect(categoryOf(137)).toBe("Category 5");
    expect(categoryOf(40, "LO")).toBe("Post-tropical");
  });
});

describe("the reports", () => {
  const model = buildEventModel(pkg());

  it("sorts by time, sorts the kinds, and reads gusts in mph (knots converted)", () => {
    expect(model.reports.map((r) => r.kind)).toEqual(["gust", "tornado", "gust", "gust"]);
    expect(model.reports[0].gustMph).toBe(58);
    expect(model.reports[1].gustMph).toBeNull();
    expect(reportKind("STORM SURGE")).toBe("surge");
    expect(reportKind("FLASH FLOOD")).toBe("flood");
    expect(reportKind("HURRICANE")).toBe("wind");
    expect(reportKind("HAIL")).toBe("hail");
  });

  it("counts what has come in and keeps the highest gust so far", () => {
    expect(reportsUpTo(model, T0 + 20 * 60_000)).toBe(2);
    expect(eventFrame(model, 0.5).topGust?.gustMph).toBe(58);
    expect(eventFrame(model, 1).topGust?.gustMph).toBe(90);
    expect(kindCounts(model, 4)).toEqual(expect.objectContaining({ gust: 3, tornado: 1 }));
  });

  it("lists landfalls once they have happened", () => {
    expect(eventFrame(model, 0.4).landfalls).toHaveLength(0);
    expect(eventFrame(model, 0.6).landfalls).toHaveLength(1);
  });
});

describe("keyMomentP", () => {
  it("is the strongest landfall for a hurricane", () => {
    expect(keyMomentP(buildEventModel(pkg()))).toBeCloseTo(0.5);
  });

  it("is the highest gust reported without a track, and the end without either", () => {
    expect(keyMomentP(buildEventModel(pkg({ track: null })))).toBeCloseTo(40 / 60);
    expect(keyMomentP(buildEventModel(pkg({ track: null, reports: [] })))).toBe(1);
  });
});

describe("wind colours", () => {
  it("hits each stop exactly and stays monotonic in arrow length", () => {
    for (const stop of WIND_STOPS) expect(windRgb(stop.mph)).toEqual(stop.rgb);
    expect(windRgb(500)).toEqual(WIND_STOPS[WIND_STOPS.length - 1].rgb);
    expect(arrowLength(10)).toBeLessThan(arrowLength(80));
    expect(windBucket(-5)).toBe(0);
    expect(windBucket(1000)).toBe(windBucket(140));
  });
});

describe("the shipped event files", () => {
  for (const entry of EVENTS) {
    it(`${entry.id}: the grid, hours and reports agree with each other and with the card`, () => {
      const path = `public/data/events/${entry.id}.json`;
      expect(existsSync(path)).toBe(true);
      const file = JSON.parse(readFileSync(path, "utf8")) as EventPackage;
      const points = file.wind.rows * file.wind.cols;
      expect(file.wind.hours.length).toBeGreaterThan(10);
      for (const series of [file.wind.speed, file.wind.dir, file.wind.gust]) {
        expect(series).toHaveLength(file.wind.hours.length);
        for (const hour of series) expect(hour).toHaveLength(points);
      }
      expect(Boolean(file.track?.length)).toBe(entry.kind === "hurricane");
      const model = buildEventModel(file);
      expect(model.endMs - model.startMs).toBe((file.wind.hours.length - 1) * HOUR);
      expect(model.reports.length).toBeGreaterThan(100);
    });
  }

  it("the derecho card's 126 mph measured gust at Atkins is in the reports", () => {
    const file = JSON.parse(readFileSync("public/data/events/derecho.json", "utf8")) as EventPackage;
    expect(file.reports.some((r) => r.city === "ATKINS" && r.mag === 126 && r.measured)).toBe(true);
  });

  it("Ian's strongest landfall in the window is the Category 4 at 19:05 UTC", () => {
    const model = buildEventModel(JSON.parse(readFileSync("public/data/events/ian.json", "utf8")) as EventPackage);
    const at = model.startMs + keyMomentP(model) * (model.endMs - model.startMs);
    expect(new Date(at).toISOString()).toBe("2022-09-28T19:05:00.000Z");
    expect(categoryOf(stormAt(model, at)!.fix.windKt)).toBe("Category 4");
  });
});
