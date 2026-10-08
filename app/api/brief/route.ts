import { aiRoute } from "@/lib/ai/route";

/** The model call plus the address lookup can take a while on a cold start. */
export const maxDuration = 60;

/** POST /api/brief  { "address": "100 James Robertson Pkwy, Nashville, TN" } : the verified "Next 72 hours on your street" brief. */
export async function POST(request: Request): Promise<Response> {
  return aiRoute(request, "brief");
}
