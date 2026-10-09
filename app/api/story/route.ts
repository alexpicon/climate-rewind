import { storyRoute } from "@/lib/ai/route";

/** The address match, the area's events and one model call can take a while on a cold start. */
export const maxDuration = 60;

/** POST /api/story  { "address": "450 110th Ave NE, Bellevue, WA" } : the verified "Your area's story". */
export async function POST(request: Request): Promise<Response> {
  return storyRoute(request);
}
