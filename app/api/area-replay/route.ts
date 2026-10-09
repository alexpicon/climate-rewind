import { clientIp, RateLimiter } from "@/lib/ai/guard";
import { buildAreaReplay } from "@/lib/area-replay";
import type { LookupErrorBody } from "@/lib/types";

const globalForReplay = globalThis as unknown as { __memoriaAreaReplayLimiter?: RateLimiter };
const limiter = () => (globalForReplay.__memoriaAreaReplayLimiter ??= new RateLimiter(30, 60_000));

/**
 * GET /api/area-replay?lat=36.1682&lon=-86.7775&state=TN&county=TNC037 : every event filed for the address's county and forecast
 * zones since 2000, compact, with the zone outlines they light. From the shipped data/events files; no outside call.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const state = (params.get("state") ?? "").toUpperCase();
  const county = (params.get("county") ?? "").toUpperCase();
  const valid = params.get("lat") !== null && params.get("lon") !== null && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  if (!valid || !/^[A-Z]{2}$/.test(state) || !/^[A-Z]{2}C\d{3}$/.test(county)) {
    return Response.json({ error: "Give lat, lon, a two-letter state and a county code like TNC037." } satisfies LookupErrorBody, { status: 400 });
  }
  const limit = limiter().check(clientIp(request.headers), Date.now());
  if (!limit.ok) return Response.json({ error: `Too many requests. Please wait ${limit.retryAfter} seconds.` } satisfies LookupErrorBody, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  const replay = await buildAreaReplay(lat, lon, state, county);
  if (!replay) return Response.json({ error: "We have no area events for this address." } satisfies LookupErrorBody, { status: 404 });
  return Response.json(replay, { headers: { "Cache-Control": "public, max-age=3600" } });
}
