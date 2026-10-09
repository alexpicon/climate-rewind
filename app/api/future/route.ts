import { futureRoute } from "@/lib/climate/future-route";

/** The numbers come from two Open-Meteo services and, with explain=1, one model call: allow for a cold start. */
export const maxDuration = 60;

/** GET /api/future?lat=47.6142&lon=-122.1935[&explain=1] : what has changed here, and what climate models project. */
export async function GET(request: Request): Promise<Response> {
  return futureRoute(request);
}
