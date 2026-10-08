import { lookupReplay } from "@/lib/lookup";
import type { LookupErrorBody } from "@/lib/types";

/** GET /api/replay?state=TN&lat=36.168&lon=-86.778&night=2021-03-28T03:55 -> { stormReplay }, for the storm night picker. */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const state = (params.get("state") ?? "").toUpperCase();
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const night = params.get("night") ?? "";

  if (!/^[A-Z]{2}$/.test(state) || !params.get("lat") || !params.get("lon") || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return Response.json({ error: "Give a state, a latitude and a longitude." } satisfies LookupErrorBody, { status: 400 });
  }

  try {
    const stormReplay = await lookupReplay(state, lat, lon, night);
    if (!stormReplay) return Response.json({ error: "That storm night is not in the records for this address." } satisfies LookupErrorBody, { status: 404 });
    return Response.json({ stormReplay }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("replay failed", error);
    return Response.json({ error: "Something went wrong on our side. Please try again." } satisfies LookupErrorBody, { status: 500 });
  }
}
