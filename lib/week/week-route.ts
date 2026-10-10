/** GET /api/week handler (see app/api/week/route.ts). Server only. */
import { parsePoint } from "../climate/future-route";
import { guardAiRequest } from "../climate/model";
import { buildWeekBase, defaultWeekDeps, withActions, type WeekDeps } from "./build";

const STATE = /^[A-Za-z]{2}$/;

export async function weekRoute(request: Request, deps: WeekDeps = defaultWeekDeps()): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const point = parsePoint(params);
  const state = (params.get("state") ?? "").toUpperCase();
  if (!point || !STATE.test(state)) return Response.json({ error: "lat, lon and a two-letter state are required, and must be in the United States." }, { status: 400 });
  const headers = { "Cache-Control": "no-store" };
  try {
    const base = await buildWeekBase(point.lat, point.lon, state, deps);
    if (params.get("actions") === "0") return Response.json(base, { headers });
    const done = await withActions(base, deps, `${point.lat.toFixed(3)},${point.lon.toFixed(3)}`, (ai) => guardAiRequest(request, ai));
    if (done.refuse) return Response.json(done.refuse.body, { status: done.refuse.status, headers: { ...headers, ...(done.refuse.headers ?? {}) } });
    return Response.json(done.payload, { headers });
  } catch (error) {
    console.error("week failed", (error as Error | null)?.name);
    return Response.json({ error: "Something went wrong on our side. Please try again." }, { status: 500, headers });
  }
}
