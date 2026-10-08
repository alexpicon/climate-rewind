import { describe, expect, it } from "vitest";
import { AnswerCache, DEFAULT_DAILY_TOKEN_BUDGET, RateLimiter, readDailyBudget, TokenBudget } from "@/lib/ai/guard";

describe("RateLimiter", () => {
  it("allows 10 requests a minute per key, then says how long to wait", () => {
    const limiter = new RateLimiter(10, 60_000);
    for (let i = 0; i < 10; i += 1) expect(limiter.check("1.2.3.4", 1000 + i * 100).ok).toBe(true);
    const blocked = limiter.check("1.2.3.4", 5000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfter).toBe(56);
  });

  it("is per key, and the window slides", () => {
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.check("a", 0).ok).toBe(true);
    expect(limiter.check("a", 1000).ok).toBe(true);
    expect(limiter.check("a", 2000).ok).toBe(false);
    expect(limiter.check("b", 2000).ok).toBe(true);
    // The first hit leaves the window after 60 s.
    expect(limiter.check("a", 60_001).ok).toBe(true);
    expect(limiter.check("a", 60_002).ok).toBe(false);
  });

  it("does not count a refused request against the visitor", () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.check("a", 0).ok).toBe(true);
    for (let t = 1; t < 50; t += 1) expect(limiter.check("a", t * 1000).ok).toBe(false);
    expect(limiter.check("a", 60_001).ok).toBe(true);
  });

  it("forgets the least recently seen keys beyond its cap", () => {
    const limiter = new RateLimiter(1, 60_000, 3);
    for (const key of ["a", "b", "c", "d"]) limiter.check(key, 0);
    // "a" was forgotten, so it is allowed again at once.
    expect(limiter.check("a", 1).ok).toBe(true);
  });
});

describe("readDailyBudget", () => {
  it("reads AI_DAILY_TOKEN_BUDGET, and falls back to the default for anything else", () => {
    expect(readDailyBudget({ AI_DAILY_TOKEN_BUDGET: "150000" })).toBe(150_000);
    expect(readDailyBudget({ AI_DAILY_TOKEN_BUDGET: " 0 " })).toBe(0);
    expect(readDailyBudget({})).toBe(DEFAULT_DAILY_TOKEN_BUDGET);
    expect(DEFAULT_DAILY_TOKEN_BUDGET).toBe(3_000_000);
    expect(readDailyBudget({ AI_DAILY_TOKEN_BUDGET: "lots" })).toBe(DEFAULT_DAILY_TOKEN_BUDGET);
    expect(readDailyBudget({ AI_DAILY_TOKEN_BUDGET: "-5" })).toBe(DEFAULT_DAILY_TOKEN_BUDGET);
    expect(readDailyBudget({ AI_DAILY_TOKEN_BUDGET: "1e6" })).toBe(DEFAULT_DAILY_TOKEN_BUDGET);
  });
});

describe("TokenBudget", () => {
  const noon = Date.parse("2026-10-08T12:00:00Z");

  it("holds an estimate, then swaps it for the real usage", () => {
    const budget = new TokenBudget(10_000);
    expect(budget.reserve(4000, noon)).toBe(true);
    expect(budget.remaining(noon)).toBe(6000);
    budget.settle(4000, 2500, noon);
    expect(budget.tokensUsed).toBe(2500);
    expect(budget.remaining(noon)).toBe(7500);
  });

  it("refuses once the day's budget would be passed (exhaustion)", () => {
    const budget = new TokenBudget(5000);
    expect(budget.reserve(3000, noon)).toBe(true);
    expect(budget.reserve(3000, noon)).toBe(false);
    expect(budget.reserve(2000, noon)).toBe(true);
    expect(budget.remaining(noon)).toBe(0);
    expect(budget.reserve(1, noon)).toBe(false);
  });

  it("releases a held estimate when the call never happened", () => {
    const budget = new TokenBudget(5000);
    budget.reserve(4000, noon);
    budget.settle(4000, 0, noon);
    expect(budget.remaining(noon)).toBe(5000);
  });

  it("starts a fresh day at 00:00 UTC", () => {
    const budget = new TokenBudget(5000);
    budget.reserve(5000, Date.parse("2026-10-08T23:59:00Z"));
    expect(budget.remaining(Date.parse("2026-10-08T23:59:30Z"))).toBe(0);
    expect(budget.remaining(Date.parse("2026-10-09T00:00:01Z"))).toBe(5000);
  });

  it("a budget of 0 switches the AI off", () => {
    const budget = new TokenBudget(0);
    expect(budget.reserve(1, noon)).toBe(false);
    expect(budget.remaining(noon)).toBe(0);
  });
});

describe("AnswerCache", () => {
  it("keys by address and question, ignoring case and spacing", () => {
    expect(AnswerCache.key("100 James  Robertson Pkwy", " Will it Flood? ")).toBe(AnswerCache.key("100 james robertson pkwy", "will it flood?"));
    expect(AnswerCache.key("a", "")).not.toBe(AnswerCache.key("a", "b"));
  });

  it("remembers an answer for ten minutes", () => {
    const cache = new AnswerCache<string>();
    cache.set("k", "v", 0);
    expect(cache.get("k", 9 * 60_000)).toBe("v");
    expect(cache.get("k", 10 * 60_000 + 1)).toBeUndefined();
  });

  it("runs identical requests that overlap as one", async () => {
    const cache = new AnswerCache<number>();
    let calls = 0;
    const make = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 7;
    };
    const [a, b] = await Promise.all([cache.once("k", make), cache.once("k", make)]);
    expect([a, b, calls]).toEqual([7, 7, 1]);
    // After it finishes the next request runs again.
    await cache.once("k", make);
    expect(calls).toBe(2);
  });

  it("lets a failure through to every waiter and then clears it", async () => {
    const cache = new AnswerCache<number>();
    const boom = async () => {
      throw new Error("boom");
    };
    await expect(cache.once("k", boom)).rejects.toThrow("boom");
    await expect(cache.once("k", async () => 1)).resolves.toBe(1);
  });
});
