import { buildOutlook } from "@/lib/outlooks";
import type { LookupErrorBody } from "@/lib/types";

/** GET /api/outlook?lat=36.1682&lon=-86.7775 : the official outlooks at a point (flood, tornado, heat) and, for the sample addresses, how they have played out there. */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const latText = params.get("lat");
  const lonText = params.get("lon");
  const lat = Number(latText);
  const lon = Number(lonText);

  // Mainland US, Alaska, Hawaii and territories sit inside this box; anything else is a typo, not a place we can read outlooks for.
  const valid = latText !== null && lonText !== null && Number.isFinite(lat) && Number.isFinite(lon) && lat >= 17 && lat <= 72 && lon >= -180 && lon <= -60;
  if (!valid) {
    return Response.json({ error: "lat and lon are required, and must be in the United States." } satisfies LookupErrorBody, { status: 400 });
  }

  try {
    const outlook = await buildOutlook(lat, lon);
    return Response.json(outlook, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("outlook failed", error);
    return Response.json({ error: "Something went wrong on our side. Please try again." } satisfies LookupErrorBody, { status: 500 });
  }
}
