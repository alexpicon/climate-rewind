import { aiRoute } from "@/lib/ai/route";

export const maxDuration = 60;

/** POST /api/ask  { "address": "...", "question": "..." } (question at most 300 characters) : a verified answer from this address's records. */
export async function POST(request: Request): Promise<Response> {
  return aiRoute(request, "ask");
}
