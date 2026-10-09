import { clientIp, RateLimiter } from "@/lib/ai/guard";
import { fetchRadarSignatures, parseSignatureQuery } from "@/lib/radar-signatures";
import type { LookupErrorBody } from "@/lib/types";

const globalForSignatures = globalThis as unknown as { __memoriaSignatureLimiter?: RateLimiter };
const limiter = () => (globalForSignatures.__memoriaSignatureLimiter ??= new RateLimiter(30, 60_000));

/**
 * GET /api/signatures?bbox=w,s,e,n&start=ISO&end=ISO : what the NWS radars flagged during a replay night (hail detections and
 * tornado vortex signatures), from NOAA NCEI. A part that fails comes back empty with a plain notice.
 */
export async function GET(request: Request): Promise<Response> {
  const query = parseSignatureQuery(new URL(request.url).searchParams);
  if (!query) return Response.json({ error: "Give a US bbox (west,south,east,north) and a start and end time no more than a day apart." } satisfies LookupErrorBody, { status: 400 });
  const limit = limiter().check(clientIp(request.headers), Date.now());
  if (!limit.ok) {
    return Response.json({ error: `Too many requests. Please wait ${limit.retryAfter} seconds.` } satisfies LookupErrorBody, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const signatures = await fetchRadarSignatures(query);
  // Past radar detections do not change: a browser may keep a complete answer for a day.
  return Response.json(signatures, { headers: { "Cache-Control": signatures.notice ? "no-store" : "public, max-age=86400" } });
}
