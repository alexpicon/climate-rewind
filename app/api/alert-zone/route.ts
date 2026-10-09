import { fetchAlertZones } from "@/lib/alert-zone";
import type { LookupErrorBody } from "@/lib/types";

/** GET /api/alert-zone?lat=36.1682&lon=-86.7775 : the NWS zone outline for any live alert at the point that has no polygon of its own (a Flood Watch, say). */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (params.get("lat") === null || params.get("lon") === null || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < 17 || lat > 72 || lon < -180 || lon > -60) {
    return Response.json({ error: "lat and lon are required, and must be in the United States." } satisfies LookupErrorBody, { status: 400 });
  }
  const result = await fetchAlertZones(lat, lon, (url, init) => fetch(url, init));
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
