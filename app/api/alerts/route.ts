import { lookupAlerts } from "@/lib/lookup";
import type { LookupErrorBody } from "@/lib/types";

/** GET /api/alerts?lat=36.1682&lon=-86.7775 : just the live NWS alerts, for refreshes. */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));

  const valid = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  if (!valid || params.get("lat") === null || params.get("lon") === null) {
    return Response.json({ error: "lat and lon are required." } satisfies LookupErrorBody, { status: 400 });
  }

  const { value, notice } = await lookupAlerts(lat, lon);
  return Response.json({ live: value, notice: notice ?? null }, { headers: { "Cache-Control": "no-store" } });
}
