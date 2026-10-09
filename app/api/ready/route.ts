import { readyRoute } from "@/lib/ready/ready-route";

/** Reading the record, then one model call: allow for a cold start. */
export const maxDuration = 60;

/** GET /api/ready?lat=36.1682&lon=-86.7775&state=TN : a short preparedness plan built from this address's real history. */
export async function GET(request: Request): Promise<Response> {
  return readyRoute(request);
}
