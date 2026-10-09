import { fetchOutlookAreas } from "@/lib/outlook-areas";

/** GET /api/outlook-areas : the WPC rainfall and SPC convective outlook polygons for Days 1 to 3 (nationwide, a few KB), for the 72-hour map. */
export async function GET(): Promise<Response> {
  try {
    const areas = await fetchOutlookAreas((url, init) => fetch(url, init));
    return Response.json(areas, { headers: { "Cache-Control": "public, max-age=120, s-maxage=300" } });
  } catch (error) {
    console.error("outlook areas failed", error);
    return Response.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
  }
}
