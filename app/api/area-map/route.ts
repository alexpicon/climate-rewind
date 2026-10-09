import { buildAreaMap, parseAreaMapQuery } from "@/lib/area-map";
import type { LookupErrorBody } from "@/lib/types";

/**
 * GET /api/area-map?state=WA&zones=WAZ556,WAZ558&ids=SE-123,LSR-SEW-201912201657-0
 * Zone outlines and the map points of the records that have one (flood reports, tornado tracks). Past records: it never changes within a day.
 */
export async function GET(request: Request): Promise<Response> {
  const query = parseAreaMapQuery(new URL(request.url).searchParams);
  if (!query) return Response.json({ error: "Give a two-letter state." } satisfies LookupErrorBody, { status: 400 });
  try {
    return Response.json(await buildAreaMap(query), { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (error) {
    console.error("area map failed", error);
    return Response.json({ error: "Something went wrong on our side. Please try again." } satisfies LookupErrorBody, { status: 500 });
  }
}
