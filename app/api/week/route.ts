import { weekRoute } from "@/lib/week/week-route";

/** Reading the forecast and records, then one model call: allow for a cold start. */
export const maxDuration = 60;

/**
 * GET /api/week?lat=36.1682&lon=-86.7775&state=TN : one card per day for today and the next six: the official forecast in plain words,
 * what that kind of day meant at this address before, and (unless actions=0) what to do, chosen by the AI from official guidance.
 */
export async function GET(request: Request): Promise<Response> {
  return weekRoute(request);
}
