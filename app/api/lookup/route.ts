import { lookupAddress } from "@/lib/lookup";
import { LookupError } from "@/lib/sources";
import type { LookupErrorBody } from "@/lib/types";

/** GET /api/lookup?address=100+James+Robertson+Pkwy,+Nashville,+TN  (optional: &night=2021-03-28T03:55) */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const address = params.get("address") ?? "";
  // Optional: a storm night id from `stormNights` (a shareable link to a specific night).
  const night = params.get("night");

  try {
    const payload = await lookupAddress(address, undefined, { night });
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof LookupError) {
      return Response.json({ error: error.message } satisfies LookupErrorBody, { status: error.status });
    }
    console.error("lookup failed", error);
    return Response.json(
      { error: "Something went wrong on our side. Please try again." } satisfies LookupErrorBody,
      { status: 500 },
    );
  }
}
