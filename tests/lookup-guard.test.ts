/** The per-visitor limit on starting an address lookup (lib/lookup-guard.ts), and the routes that apply it. */
import { describe, expect, it } from "vitest";
import { RateLimiter } from "@/lib/ai/guard";
import { limitLookup, LOOKUPS_PER_MINUTE } from "@/lib/lookup-guard";
import { GET as lookupPartGet } from "@/app/api/lookup/[part]/route";

const from = (ip: string) => new Request("http://localhost/api/lookup/geocode?address=x", { headers: { "x-forwarded-for": ip } });

describe("limitLookup", () => {
  it("lets a visitor start a dozen lookups a minute, then answers 429 with Retry-After and a plain message", async () => {
    const limiter = new RateLimiter(LOOKUPS_PER_MINUTE, 60_000);
    for (let i = 0; i < LOOKUPS_PER_MINUTE; i += 1) expect(limitLookup(from("1.1.1.1"), limiter, i * 1000)).toBeNull();
    const refused = limitLookup(from("1.1.1.1"), limiter, 13_000);
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get("Retry-After")).toBe("47");
    expect(((await refused?.json()) as { error: string }).error).toMatch(/Too many lookups from here\. Please wait 47 seconds\./);
    expect(limitLookup(from("2.2.2.2"), limiter, 13_000)).toBeNull();
  });
});

describe("the lookup parts", () => {
  it("count only the geocode step: the parts that follow it are never refused by the limit", async () => {
    const ip = "198.51.100.77";
    // Twice the limit of parts: none is refused by the limiter (they fail validation instead, with a 400).
    for (let i = 0; i < LOOKUPS_PER_MINUTE * 2; i += 1) {
      const response = await lookupPartGet(new Request("http://localhost/api/lookup/records", { headers: { "x-forwarded-for": ip } }), { params: Promise.resolve({ part: "records" }) });
      expect(response.status).toBe(400);
    }
  });
});

describe("the default limiter", () => {
  it("is on unless MEMORIA_LOOKUP_LIMIT is off", async () => {
    const { lookupLimiter } = await import("@/lib/lookup-guard");
    const before = process.env.MEMORIA_LOOKUP_LIMIT;
    try {
      process.env.MEMORIA_LOOKUP_LIMIT = "";
      const ip = `203.0.113.${Math.floor(Math.random() * 200)}`;
      const results = Array.from({ length: LOOKUPS_PER_MINUTE + 1 }, () => limitLookup(from(ip))?.status ?? 200);
      expect(results.at(-1)).toBe(429);
      expect(lookupLimiter()).toBe(lookupLimiter());
    } finally {
      process.env.MEMORIA_LOOKUP_LIMIT = before;
    }
  });
});
