import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { cameraFor, cameraIsAt, constrainToBounds, enterCamera, isPlaced, onPlaced, type Camera, type CameraLock } from "@/lib/ui/camera";

/** Just enough of a MapLibre map to drive enterCamera: a camera, a canvas size, move events and the lock setters. */
function fakeMap(size = { w: 1440, h: 900 }) {
  const handlers = new Map<string, Set<() => void>>();
  const state = { zoom: 4, center: [-96, 38] as [number, number], minZoom: 3, maxZoom: 14, maxBounds: undefined as unknown, flights: 0, jumps: [] as Camera[], fit: 0, resizes: 0 };
  const canvas = { clientWidth: size.w, clientHeight: size.h };
  const map = {
    getCanvas: () => canvas,
    getZoom: () => state.zoom,
    getCenter: () => ({ lng: state.center[0], lat: state.center[1] }),
    jumpTo(cam: Camera) {
      state.zoom = cam.zoom;
      state.center = cam.center;
      state.jumps.push(cam);
    },
    flyTo() {
      state.flights += 1;
    },
    resize() {
      state.resizes += 1;
    },
    fitBounds() {
      state.fit += 1;
    },
    setMinZoom: (z: number) => (state.minZoom = z),
    setMaxZoom: (z: number) => (state.maxZoom = z),
    setMaxBounds: (b: unknown) => (state.maxBounds = b),
    fire: () => undefined,
    on(type: string, fn: () => void) {
      handlers.set(type, (handlers.get(type) ?? new Set()).add(fn));
    },
    off(type: string, fn: () => void) {
      handlers.get(type)?.delete(fn);
    },
    emit(type: string) {
      for (const fn of [...(handlers.get(type) ?? [])]) fn();
    },
    cameraForBounds: vi.fn(),
  };
  return { map: map as unknown as MapLibreMap & typeof map, state, canvas };
}

const PAD = { top: 10, bottom: 10, left: 10, right: 10 };
const TARGET: Camera = { center: [-86.78, 36.06], zoom: 8.6 };
const LOCK: CameraLock = { bounds: [[-90, 33], [-82, 40]], minZoom: 8.4, maxZoom: 12.5 }; // a box wide enough that it never moves the test cameras

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("enterCamera", () => {
  it("jumps for the first camera of a page load (no flight in from the world view) and says it is settled", () => {
    const { map, state } = fakeMap();
    const placed = vi.fn();
    onPlaced(map, placed);
    const settled = vi.fn();
    enterCamera(map, TARGET, LOCK, false, 2400, settled);
    expect(state.flights).toBe(0);
    expect(state.zoom).toBe(8.6);
    expect(state.minZoom).toBe(8.4); // the lock is on
    expect(settled).toHaveBeenCalledTimes(1);
    expect(placed).toHaveBeenCalledTimes(1);
    expect(isPlaced(map)).toBe(true);
  });

  it("flies on later calls and settles only when the flight ends on the target", () => {
    const { map, state } = fakeMap();
    enterCamera(map, TARGET, LOCK, false, 2400); // first: jump
    state.zoom = 5; // somewhere else, as if the visitor moved to another view
    const settled = vi.fn();
    enterCamera(map, TARGET, LOCK, false, 2400, settled);
    expect(state.flights).toBe(1);
    expect(settled).not.toHaveBeenCalled();
    state.zoom = TARGET.zoom;
    state.center = TARGET.center;
    map.emit("moveend");
    expect(settled).toHaveBeenCalledTimes(1);
    expect(state.jumps).toHaveLength(1); // no correction needed
  });

  it("puts the camera on the target when a flight is interrupted part-way (a scroll, a resize, another effect)", () => {
    const { map, state } = fakeMap();
    enterCamera(map, TARGET, LOCK, false, 2400);
    state.zoom = 4;
    state.center = [-96, 38];
    const settled = vi.fn();
    enterCamera(map, TARGET, LOCK, false, 2400, settled);
    state.zoom = 5.3; // interrupted at the whole-US-ish zoom
    state.center = [-92, 37];
    map.emit("moveend");
    expect(state.jumps[state.jumps.length - 1]).toEqual(TARGET);
    expect(state.zoom).toBe(TARGET.zoom);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("settles even if the flight never reports back", () => {
    const { map, state } = fakeMap();
    enterCamera(map, TARGET, LOCK, false, 2400);
    state.zoom = 4;
    const settled = vi.fn();
    enterCamera(map, TARGET, LOCK, false, 2400, settled);
    vi.advanceTimersByTime(2400 + 1499);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(state.zoom).toBe(TARGET.zoom);
  });

  it("measures the target again when the flight ends (a resize in between)", () => {
    const { map, state } = fakeMap();
    enterCamera(map, TARGET, LOCK, false, 2400);
    state.zoom = 4;
    let target: Camera = TARGET;
    enterCamera(map, () => target, LOCK, false, 2400);
    target = { center: [-86.7, 36.1], zoom: 8.2 }; // the window changed size mid-flight
    map.emit("moveend");
    expect(state.zoom).toBe(8.2);
  });

  it("uses the lock box when the target cannot be worked out (never leaves the world view)", () => {
    const { map, state } = fakeMap();
    const settled = vi.fn();
    enterCamera(map, { center: [NaN, NaN], zoom: NaN }, LOCK, false, 2400, settled);
    expect(state.fit).toBe(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("waits for the map to have a size before measuring, and goes ahead after 3 s regardless", () => {
    const { map, state, canvas } = fakeMap({ w: 0, h: 0 });
    const settled = vi.fn();
    enterCamera(map, TARGET, LOCK, false, 2400, settled);
    expect(state.jumps).toHaveLength(0);
    canvas.clientWidth = 1440;
    canvas.clientHeight = 900;
    vi.advanceTimersByTime(150);
    expect(state.jumps).toHaveLength(1);
    expect(settled).toHaveBeenCalledTimes(1);

    const stuck = fakeMap({ w: 0, h: 0 });
    const stuckSettled = vi.fn();
    enterCamera(stuck.map, TARGET, LOCK, false, 2400, stuckSettled);
    vi.advanceTimersByTime(3100);
    expect(stuckSettled).toHaveBeenCalledTimes(1);
  });

  it("does not move or settle after it is cancelled", () => {
    const { map, state } = fakeMap();
    enterCamera(map, TARGET, LOCK, false, 2400);
    state.zoom = 4;
    const settled = vi.fn();
    const cancel = enterCamera(map, TARGET, LOCK, false, 2400, settled);
    cancel();
    map.emit("moveend");
    vi.advanceTimersByTime(10_000);
    expect(settled).not.toHaveBeenCalled();
    expect(state.zoom).toBe(4);
  });

  it("skips the flight when the camera is already on the target (a re-mounted view)", () => {
    const { map, state } = fakeMap();
    enterCamera(map, TARGET, LOCK, false, 2400);
    const settled = vi.fn();
    enterCamera(map, TARGET, LOCK, false, 2400, settled);
    expect(state.flights).toBe(0);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("jumps when motion is reduced", () => {
    const { map, state } = fakeMap();
    enterCamera(map, TARGET, LOCK, false, 2400);
    state.zoom = 4;
    enterCamera(map, TARGET, LOCK, true, 2400);
    expect(state.flights).toBe(0);
    expect(state.zoom).toBe(TARGET.zoom);
  });
});

describe("a page that is still settling", () => {
  it("makes the map read its container's size before measuring the camera", () => {
    const { map, state } = fakeMap();
    enterCamera(map, TARGET, LOCK, false, 2400);
    expect(state.resizes).toBeGreaterThanOrEqual(1);
  });

  it("re-measures and re-places the camera if the map is resized just after arriving (late CSS, a toolbar, devtools)", () => {
    const { map, state } = fakeMap();
    let target: Camera = TARGET;
    enterCamera(map, () => target, LOCK, false, 2400);
    expect(state.zoom).toBe(8.6);
    target = { center: [-86.78, 36.06], zoom: 8.1 }; // the window turned out to be smaller
    map.emit("resize");
    expect(state.zoom).toBe(8.1);
  });

  it("stops watching after 3 seconds, and as soon as the visitor drags the map", () => {
    const first = fakeMap();
    let target: Camera = TARGET;
    enterCamera(first.map, () => target, LOCK, false, 2400);
    vi.advanceTimersByTime(3100);
    target = { center: [-86.78, 36.06], zoom: 8.1 };
    first.map.emit("resize");
    expect(first.state.zoom).toBe(8.6);

    const second = fakeMap();
    target = TARGET;
    enterCamera(second.map, () => target, LOCK, false, 2400);
    second.map.emit("dragstart");
    target = { center: [-86.78, 36.06], zoom: 8.1 };
    second.map.emit("resize");
    expect(second.state.zoom).toBe(8.6);
  });

  it("takes the lock from a function too, measured again at the end", () => {
    const { map, state } = fakeMap();
    let minZoom = 8.4;
    enterCamera(map, TARGET, () => ({ ...LOCK, minZoom }), false, 2400);
    expect(state.minZoom).toBe(8.4);
  });
});

describe("cameraFor", () => {
  it("never returns a NaN camera", () => {
    const { map } = fakeMap();
    map.cameraForBounds.mockReturnValue({ center: { lng: NaN, lat: 36 }, zoom: NaN });
    expect(cameraFor(map, [[-87, 35], [-86, 36]], { padding: PAD })).toBeNull();
    map.cameraForBounds.mockReturnValue({ center: { lng: -86.5, lat: 35.5 }, zoom: 9 });
    expect(cameraFor(map, [[-87, 35], [-86, 36]], { padding: PAD })).toEqual({ center: [-86.5, 35.5], zoom: 9 });
  });
});

describe("cameraIsAt", () => {
  it("compares zoom and centre with a few pixels of slack", () => {
    const { map, state } = fakeMap();
    state.zoom = 9;
    state.center = [-86.78, 36.06];
    expect(cameraIsAt(map, { center: [-86.78, 36.06], zoom: 9 })).toBe(true);
    expect(cameraIsAt(map, { center: [-86.78, 36.06], zoom: 8 })).toBe(false);
    expect(cameraIsAt(map, { center: [-86.5, 36.06], zoom: 9 })).toBe(false);
  });
});

describe("constrainToBounds (the camera the radar-box lock leaves you at)", () => {
  // The Nashville radar box and a 1440 x 900 canvas: MapLibre's own lock moves a z7.73 camera to z8.567 at (-86.777, 36.055).
  const BOX: [[number, number], [number, number]] = [[-88.1128, 35.0828], [-85.4422, 37.2535]];

  it("zooms in until the box covers the canvas and keeps the centre inside it", () => {
    const { map } = fakeMap();
    const out = constrainToBounds(map, { center: [-87.494, 36.0545], zoom: 7.7278 }, BOX);
    expect(out.zoom).toBeCloseTo(8.567, 2);
    expect(out.center[0]).toBeCloseTo(-86.777, 2);
    expect(out.center[1]).toBeCloseTo(36.055, 1);
  });

  it("leaves a camera that is already inside the lock alone", () => {
    const { map } = fakeMap();
    const inside = { center: [-86.777, 36.0545] as [number, number], zoom: 9.5 };
    const out = constrainToBounds(map, inside, BOX);
    expect(out.zoom).toBe(9.5);
    expect(out.center[0]).toBeCloseTo(-86.777, 1);
  });

  it("does nothing for a pitched (3D) camera, no box, or a box it cannot read", () => {
    const { map } = fakeMap();
    const cam = { center: [-87.4, 36] as [number, number], zoom: 7.7, pitch: 62 };
    expect(constrainToBounds(map, cam, BOX)).toBe(cam);
    const flat = { center: [-87.4, 36] as [number, number], zoom: 7.7 };
    expect(constrainToBounds(map, flat, null)).toBe(flat);
    expect(constrainToBounds(map, flat, [-88, 35, -85, 37])).toBe(flat);
  });

  it("is what enterCamera flies to, so the flight lands where the lock leaves it (no jump at the end)", () => {
    const { map, state } = fakeMap();
    const lock = { bounds: BOX, minZoom: 7.88, maxZoom: 12.5 };
    enterCamera(map, { center: [-87.494, 36.0545], zoom: 7.7278 }, lock, false, 2400);
    expect(state.zoom).toBeCloseTo(8.567, 2);
  });
});
