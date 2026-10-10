import { lookupGeocode, lookupPart } from "@/lib/lookup";
import { limitLookup } from "@/lib/lookup-guard";
import { addressFromQuery, isLookupPart } from "@/lib/lookup-query";
import { LookupError } from "@/lib/sources";
import type { LookupErrorBody } from "@/lib/types";

const headers = { "Cache-Control": "no-store" };

/**
 * The lookup in pieces, so the first view can be drawn as soon as the address is matched and the records are read:
 *   GET /api/lookup/geocode?address=...        -> { address }
 *   GET /api/lookup/<part>?address=...&matched=...&lat=...&lon=...&state=...   (part: records, area, live, fema, heat, trigger) -> that part's fields
 * /api/lookup (no part) still answers with the whole payload.
 */
export async function GET(request: Request, context: { params: Promise<{ part: string }> }): Promise<Response> {
  const { part } = await context.params;
  const params = new URL(request.url).searchParams;

  try {
    if (part === "geocode") {
      const limited = limitLookup(request);
      if (limited) return limited;
      const address = await lookupGeocode(params.get("address") ?? "");
      return Response.json({ address }, { headers });
    }
    if (!isLookupPart(part)) return Response.json({ error: "Unknown part of a lookup." } satisfies LookupErrorBody, { status: 404 });
    const address = addressFromQuery(params);
    if (!address) return Response.json({ error: "Give the matched address, its latitude and longitude, and its state." } satisfies LookupErrorBody, { status: 400 });
    const patch = await lookupPart(part, address, undefined, { night: params.get("night") });
    return Response.json({ patch }, { headers });
  } catch (error) {
    if (error instanceof LookupError) return Response.json({ error: error.message, ...(error.choices ? { choices: error.choices } : {}) } satisfies LookupErrorBody, { status: error.status });
    console.error("lookup part failed", part, error);
    return Response.json({ error: "Something went wrong on our side. Please try again." } satisfies LookupErrorBody, { status: 500 });
  }
}
