import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { radarCorners, radarFrameUrl } from "@/lib/ui/map-style";
import { RadarLoader, type RadarProgress } from "@/lib/ui/radar-loader";

describe("radarFrameUrl", () => {
  const bounds: [number, number, number, number] = [-88.1237, 35.0802, -85.4363, 37.2398];

  it("asks IEM's time-enabled WMS for one transparent PNG per frame", () => {
    const url = new URL(radarFrameUrl(bounds, "2021-03-28T04:00:00Z"));
    expect(`${url.origin}${url.pathname}`).toBe("https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi");
    expect(url.searchParams.get("LAYERS")).toBe("nexrad-n0q-wmst");
    expect(url.searchParams.get("TIME")).toBe("2021-03-28T04:00:00Z");
    expect(url.searchParams.get("SRS")).toBe("EPSG:3857");
    expect(url.searchParams.get("TRANSPARENT")).toBe("TRUE");
    expect(url.searchParams.get("FORMAT")).toBe("image/png; mode=8bit");
  });

  it("encodes spaces as %20 (some servers read + literally) and keeps the longest side at 384 px", () => {
    const text = radarFrameUrl(bounds, "2021-03-28T04:00:00Z");
    expect(text).not.toContain("+");
    const url = new URL(text);
    const w = Number(url.searchParams.get("WIDTH"));
    const h = Number(url.searchParams.get("HEIGHT"));
    expect(Math.max(w, h)).toBe(384);
    // The image shape matches the Web Mercator box, so the picture is not stretched.
    const [x0, y0, x1, y1] = (url.searchParams.get("BBOX") as string).split(",").map(Number);
    expect(h / w).toBeCloseTo((y1 - y0) / (x1 - x0), 1);
    expect(x0).toBeLessThan(x1);
    expect(y0).toBeLessThan(y1);
  });

  it("lists the corners clockwise from the top left, as [lon, lat]", () => {
    expect(radarCorners([-90, 30, -80, 40])).toEqual([[-90, 40], [-80, 40], [-80, 30], [-90, 30]]);
  });
});

describe("RadarLoader", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(
    total: number,
    fetchFrame: (index: number, signal: AbortSignal, progress: () => void) => Promise<string>,
    extra: Partial<ConstructorParameters<typeof RadarLoader<string>>[0]> = {},
  ) {
    const frames = new Map<number, string | null>();
    let last: RadarProgress | null = null;
    const loader = new RadarLoader<string>({
      total,
      fetchFrame,
      onFrame: (i, image) => frames.set(i, image),
      onProgress: (p) => (last = p),
      ...extra,
    });
    return { loader, frames, progress: () => last as RadarProgress | null };
  }

  it("loads every frame and reports done", async () => {
    const { loader, frames, progress } = setup(20, async (i) => `img${i}`);
    loader.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(frames.size).toBe(20);
    expect(progress()).toMatchObject({ total: 20, ready: 20, missing: 0, buffered: 20, playable: true, done: true, gaveUp: false });
  });

  it("never has more than 6 requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const { loader } = setup(30, async (i) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 50));
      inFlight -= 1;
      return `img${i}`;
    });
    loader.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(peak).toBe(6);
  });

  it("becomes playable once the first 12 frames are in, while later frames are still loading", async () => {
    const { loader, progress } = setup(85, (i) => new Promise((r) => setTimeout(() => r(`img${i}`), 100)));
    loader.start();
    await vi.advanceTimersByTimeAsync(150);
    expect(progress()?.playable).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    const mid = progress() as RadarProgress;
    expect(mid.playable).toBe(true);
    expect(mid.done).toBe(false);
    expect(mid.buffered).toBeGreaterThanOrEqual(12);
  });

  it("counts buffered as the leading run of settled frames only", async () => {
    // Frame 1 hangs; the frames after it load, but playback must not run past frame 0.
    const { loader, progress } = setup(
      10,
      (i, signal) => (i === 1 ? new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))) : Promise.resolve(`img${i}`)),
      { stallTimeoutMs: 10_000 },
    );
    loader.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(progress()).toMatchObject({ ready: 9, buffered: 1, done: false });
  });

  it("retries a failed frame once, then skips it", async () => {
    const calls = new Map<number, number>();
    const { loader, frames, progress } = setup(5, async (i) => {
      calls.set(i, (calls.get(i) ?? 0) + 1);
      if (i === 2) throw new Error("500");
      return `img${i}`;
    });
    loader.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls.get(2)).toBe(2);
    expect(frames.get(2)).toBeNull();
    expect(progress()).toMatchObject({ ready: 4, missing: 1, done: true, gaveUp: false });
  });

  it("aborts a request that stalls and retries within its limit", async () => {
    let calls = 0;
    const { loader, progress } = setup(
      1,
      (_i, signal) => {
        calls += 1;
        return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
      },
      { stallTimeoutMs: 1000, retryDelayMs: 200 },
    );
    loader.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(2);
    expect(progress()).toMatchObject({ missing: 1, done: true });
  });

  it("does not give up on a slow but steady download (bytes keep arriving)", async () => {
    const { loader, progress } = setup(
      1,
      async (i, _signal, touch) => {
        for (let k = 0; k < 10; k++) {
          await new Promise((r) => setTimeout(r, 3000)); // 30 s in all, a chunk every 3 s
          touch();
        }
        return `img${i}`;
      },
      { stallTimeoutMs: 8000, attemptMaxMs: 45_000 },
    );
    loader.start();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(progress()).toMatchObject({ ready: 1, missing: 0, done: true });
  });

  it("still caps one attempt at attemptMaxMs even if bytes trickle in", async () => {
    const { loader, progress } = setup(
      1,
      (_i, signal, touch) =>
        new Promise<string>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
          setInterval(touch, 1000);
        }),
      { stallTimeoutMs: 5000, attemptMaxMs: 20_000, maxAttempts: 1 },
    );
    loader.start();
    await vi.advanceTimersByTimeAsync(21_000);
    expect(progress()).toMatchObject({ missing: 1, done: true });
  });

  it("gives up after 4 failed frames in a row: no retry storm when the server is blocked", async () => {
    let requests = 0;
    const { loader, progress } = setup(85, async () => {
      requests += 1;
      throw new Error("blocked");
    });
    loader.start();
    await vi.advanceTimersByTimeAsync(60_000);
    const p = progress() as RadarProgress;
    expect(p).toMatchObject({ ready: 0, missing: 85, done: true, gaveUp: true });
    // 6 workers, 2 attempts each: a couple of dozen requests, not thousands.
    expect(requests).toBeLessThanOrEqual(24);
  });

  it("stops everything on stop()", async () => {
    let requests = 0;
    const { loader } = setup(85, (_i, signal) => {
      requests += 1;
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    loader.start();
    await vi.advanceTimersByTimeAsync(100);
    loader.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requests).toBe(6);
  });

  it("can load the last frame second (reduced motion opens on it)", async () => {
    const order: number[] = [];
    const { loader } = setup(5, async (i) => {
      order.push(i);
      return `img${i}`;
    }, { order: [0, 4, 1, 2, 3], concurrency: 1 });
    loader.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(order).toEqual([0, 4, 1, 2, 3]);
  });
});
