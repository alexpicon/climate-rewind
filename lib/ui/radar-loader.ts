/**
 * Loads the radar replay frames one image each, a few at a time, and reports honest progress.
 * Pure logic: the caller supplies how to fetch one frame and what to do with it, so tests need no browser.
 *
 * Bounded on purpose, so a slow or blocked server can never cause a retry storm:
 * - at most `concurrency` requests in flight;
 * - each frame gets `maxAttempts` tries (default 2), each given up on if no bytes arrive for `stallTimeoutMs`
 *   (or after `attemptMaxMs` in all), with one pause between. A slow but steady connection is not a failure;
 * - after `maxConsecutiveFailures` frames in a row fail, or `maxFailures` in all, the rest are given up and counted as missing.
 */

export interface RadarProgress {
  total: number;
  /** Frames loaded and drawable. */
  ready: number;
  /** Frames that failed or were given up; the replay skips them. */
  missing: number;
  /** How many frames from the start are settled (ready or missing). Playback can safely reach this far. */
  buffered: number;
  /** Enough frames are in to start playing. */
  playable: boolean;
  /** Every frame is settled. */
  done: boolean;
  /** The loader gave up early because the server kept failing. */
  gaveUp: boolean;
}

export interface RadarLoaderOptions<T> {
  total: number;
  /** The order frames are requested in. Defaults to 0, 1, 2 ... */
  order?: number[];
  /** Fetch one frame. Call `progress()` whenever bytes arrive: it restarts the stall timer. */
  fetchFrame: (index: number, signal: AbortSignal, progress: () => void) => Promise<T>;
  /** Called once per frame: the image when it loaded, null when it is missing. */
  onFrame: (index: number, image: T | null) => void;
  onProgress: (progress: RadarProgress) => void;
  concurrency?: number;
  /** An attempt is abandoned if no bytes arrive for this long. */
  stallTimeoutMs?: number;
  /** ...or if it takes this long in all. */
  attemptMaxMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  maxConsecutiveFailures?: number;
  maxFailures?: number;
  /** Frames needed before playback may start. */
  minPlayable?: number;
}

export const RADAR_DEFAULTS = {
  concurrency: 6,
  stallTimeoutMs: 8_000,
  attemptMaxMs: 45_000,
  maxAttempts: 2,
  retryDelayMs: 1_500,
  maxConsecutiveFailures: 4,
  maxFailures: 10,
  minPlayable: 12,
} as const;

export class RadarLoader<T> {
  private readonly o: Required<Omit<RadarLoaderOptions<T>, "order" | "fetchFrame" | "onFrame" | "onProgress" | "total">>;
  private readonly queue: number[];
  private readonly state: Array<"pending" | "ready" | "missing">;
  private readonly controller = new AbortController();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private active = 0;
  private failures = 0;
  private streak = 0;
  private gaveUp = false;
  private stopped = false;
  private notifyTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly opts: RadarLoaderOptions<T>) {
    this.o = { ...RADAR_DEFAULTS, ...stripUndefined(opts) } as typeof this.o;
    this.queue = [...(opts.order ?? Array.from({ length: opts.total }, (_, i) => i))];
    this.state = Array.from({ length: opts.total }, () => "pending" as const);
  }

  start(): void {
    this.notify(true);
    this.pump();
  }

  stop(): void {
    this.stopped = true;
    this.controller.abort();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    clearTimeout(this.notifyTimer);
  }

  progress(): RadarProgress {
    let ready = 0;
    let missing = 0;
    for (const s of this.state) {
      if (s === "ready") ready += 1;
      else if (s === "missing") missing += 1;
    }
    let buffered = 0;
    while (buffered < this.state.length && this.state[buffered] !== "pending") buffered += 1;
    const total = this.opts.total;
    const done = ready + missing >= total;
    return { total, ready, missing, buffered, playable: done || buffered >= Math.min(this.o.minPlayable, total), done, gaveUp: this.gaveUp };
  }

  private pump(): void {
    while (!this.stopped && this.active < this.o.concurrency && this.queue.length > 0) {
      const index = this.queue.shift() as number;
      this.active += 1;
      void this.load(index).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  private async load(index: number): Promise<void> {
    for (let attempt = 1; attempt <= this.o.maxAttempts; attempt += 1) {
      if (this.stopped) return;
      const image = await this.attempt(index);
      if (this.stopped) return;
      if (image !== null) {
        this.streak = 0;
        this.settle(index, image);
        return;
      }
      if (attempt < this.o.maxAttempts) await this.sleep(this.o.retryDelayMs);
    }
    this.failures += 1;
    this.streak += 1;
    this.settle(index, null);
    if (this.streak >= this.o.maxConsecutiveFailures || this.failures >= this.o.maxFailures) this.giveUp();
  }

  private async attempt(index: number): Promise<T | null> {
    const own = new AbortController();
    const onAbort = () => own.abort();
    this.controller.signal.addEventListener("abort", onAbort, { once: true });
    const cap = setTimeout(() => own.abort(), this.o.attemptMaxMs);
    let stall = setTimeout(() => own.abort(), this.o.stallTimeoutMs);
    const progress = () => {
      clearTimeout(stall);
      stall = setTimeout(() => own.abort(), this.o.stallTimeoutMs);
    };
    try {
      return await this.opts.fetchFrame(index, own.signal, progress);
    } catch {
      return null;
    } finally {
      clearTimeout(cap);
      clearTimeout(stall);
      this.controller.signal.removeEventListener("abort", onAbort);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, ms);
      this.timers.add(timer);
    });
  }

  private giveUp(): void {
    if (this.gaveUp) return;
    this.gaveUp = true;
    // Whatever is still waiting is dropped, and requests in flight are left to finish or time out on their own.
    for (const index of this.queue.splice(0)) this.settle(index, null);
  }

  private settle(index: number, image: T | null): void {
    if (this.state[index] !== "pending") return;
    this.state[index] = image === null ? "missing" : "ready";
    this.opts.onFrame(index, image);
    this.notify(false);
  }

  /** Progress updates are batched so a burst of frames does not re-render the page for each one. */
  private notify(now: boolean): void {
    if (this.stopped) return;
    if (now || this.progress().done) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = undefined;
      this.opts.onProgress(this.progress());
      return;
    }
    this.notifyTimer ??= setTimeout(() => {
      this.notifyTimer = undefined;
      if (!this.stopped) this.opts.onProgress(this.progress());
    }, 120);
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
