/**
 * Guardrails around the model calls: a per-IP rate limit, a hard per-day token budget, and an in-memory answer cache.
 * All three live in server memory. On a serverless host each warm instance has its own copy, so the limits are per instance
 * (the budget is therefore a per-instance ceiling, not a global bill cap; set the provider-side spend limit as well).
 */
import { LruCache } from "../lru";

// ---------------------------------------------------------------- rate limit

export const RATE_LIMIT_PER_MINUTE = 10;

/** A sliding one-minute window per key (an IP address). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number = RATE_LIMIT_PER_MINUTE,
    private readonly windowMs: number = 60_000,
    private readonly maxKeys: number = 5000,
  ) {}

  /** Records the request and says whether it may go ahead. When it may not, `retryAfter` is the seconds until the oldest hit leaves the window. */
  check(key: string, nowMs: number): { ok: true } | { ok: false; retryAfter: number } {
    const recent = (this.hits.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return { ok: false, retryAfter: Math.max(1, Math.ceil((recent[0] + this.windowMs - nowMs) / 1000)) };
    }
    recent.push(nowMs);
    this.hits.delete(key);
    this.hits.set(key, recent);
    // Keep memory bounded: forget the keys unused the longest.
    while (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value as string);
    return { ok: true };
  }
}

// ---------------------------------------------------------------- daily token budget

/**
 * Used when AI_DAILY_TOKEN_BUDGET is missing or not a whole number: about 750 briefs a day (roughly 4,000 tokens each), enough
 * for a judging window. It is a per-instance ceiling; the Anthropic console spend cap is the real safety net (see the README).
 */
export const DEFAULT_DAILY_TOKEN_BUDGET = 3_000_000;

/** Reads AI_DAILY_TOKEN_BUDGET. A whole number of 0 or more; 0 switches the AI off. Anything else falls back to the default. */
export function readDailyBudget(env: Record<string, string | undefined>): number {
  const raw = env.AI_DAILY_TOKEN_BUDGET?.trim();
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  return DEFAULT_DAILY_TOKEN_BUDGET;
}

const utcDay = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

/**
 * Counts input plus output tokens against a daily limit that resets at 00:00 UTC. `reserve` sets aside an estimate before the
 * call (so parallel calls cannot all slip through), `settle` swaps the estimate for the real usage afterwards.
 */
export class TokenBudget {
  private day = "";
  private used = 0;

  constructor(readonly limit: number) {}

  private roll(nowMs: number) {
    const today = utcDay(nowMs);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
  }

  /** True and the estimate is held, or false: the budget would be passed. */
  reserve(estimate: number, nowMs: number): boolean {
    this.roll(nowMs);
    if (this.limit <= 0 || this.used + estimate > this.limit) return false;
    this.used += estimate;
    return true;
  }

  /** Replace a held estimate by the real token count (or release it all with actual = 0 if the call never happened). */
  settle(estimate: number, actual: number, nowMs: number) {
    this.roll(nowMs);
    this.used = Math.max(0, this.used - estimate + actual);
  }

  get tokensUsed(): number {
    return this.used;
  }

  remaining(nowMs: number): number {
    this.roll(nowMs);
    return Math.max(0, this.limit - this.used);
  }
}

// ---------------------------------------------------------------- answer cache

export const ANSWER_CACHE_MS = 10 * 60_000;
/** The 72-hour brief is kept an hour, by address and active alerts, so a judge clicking back and forth does not pay for it twice. */
export const BRIEF_CACHE_MS = 60 * 60_000;
export const ANSWER_CACHE_MAX = 300;

/** Finished answers by key (ten minutes unless told otherwise), plus the calls still running, so two identical requests make one model call. */
export class AnswerCache<V> {
  private readonly done: LruCache<V>;
  private readonly running = new Map<string, Promise<V>>();

  constructor(ttlMs: number = ANSWER_CACHE_MS) {
    this.done = new LruCache<V>(ANSWER_CACHE_MAX, ttlMs);
  }

  static key(address: string, question: string): string {
    const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
    return `${norm(address)}|${norm(question)}`;
  }

  get(key: string, nowMs: number): V | undefined {
    return this.done.get(key, nowMs);
  }

  set(key: string, value: V, nowMs: number) {
    this.done.set(key, value, nowMs);
  }

  /** Runs `make` once per key at a time; callers that arrive while it runs share its result. */
  async once(key: string, make: () => Promise<V>): Promise<V> {
    const existing = this.running.get(key);
    if (existing) return existing;
    const promise = make().finally(() => this.running.delete(key));
    this.running.set(key, promise);
    return promise;
  }

  clear() {
    this.done.clear();
    this.running.clear();
  }
}
