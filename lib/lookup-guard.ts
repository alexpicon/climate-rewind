/**
 * The rate limit on address lookups. A new address costs real calls to outside services (the Census geocoder, and a 26-year
 * Open-Meteo history with a small free daily allowance), so one visitor may start only so many. Only the step that starts a
 * lookup counts (the geocode, or the whole lookup in one call); the parts that follow it are free. Server only.
 */
import { clientIp, RateLimiter } from "./ai/guard";
import type { LookupErrorBody } from "./types";

export const LOOKUPS_PER_MINUTE = 12;
export const LOOKUPS_PER_HOUR = 120;

const globalForLookups = globalThis as unknown as { __memoriaLookupLimiter?: RateLimiter };

/** One limiter per server process (it survives dev reloads), like the AI's. */
export function lookupLimiter(): RateLimiter {
  globalForLookups.__memoriaLookupLimiter ??= new RateLimiter(LOOKUPS_PER_MINUTE, 60_000, 5000, new RateLimiter(LOOKUPS_PER_HOUR, 60 * 60_000));
  return globalForLookups.__memoriaLookupLimiter;
}

/**
 * Null when the request may go ahead, else the 429 to send, with Retry-After. `MEMORIA_LOOKUP_LIMIT=off` turns the default limiter
 * off (the test suite sets it, since its route tests make many lookups from one client); a limiter passed in always applies.
 */
export function limitLookup(request: Request, limiter?: RateLimiter, nowMs: number = Date.now()): Response | null {
  if (!limiter && process.env.MEMORIA_LOOKUP_LIMIT === "off") return null;
  const result = (limiter ?? lookupLimiter()).check(clientIp(request.headers), nowMs);
  if (result.ok) return null;
  return Response.json({ error: `Too many lookups from here. Please wait ${result.retryAfter} seconds.` } satisfies LookupErrorBody, {
    status: 429,
    headers: { "Retry-After": String(result.retryAfter), "Cache-Control": "no-store" },
  });
}
