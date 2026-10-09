/**
 * GET /api/future?lat=47.6142&lon=-122.1935[&explain=1]
 *
 * Without `explain`: the computed numbers (observed decades and trends, projected range), no model call. With `explain=1`: the same plus
 * the AI explanation (checked sentence by sentence; kept per 0.05 degree cell). The four sample addresses read files made ahead of time,
 * explanation included. Server only.
 */
import { AnswerCache, BRIEF_CACHE_MS, RateLimiter } from "../ai/guard";
import type { AiAnswer } from "../ai/types";
import { explainFuture } from "./explain";
import { futureKey, getFuture, hasFuture, type FutureDeps } from "./live";
import { getAiDeps, guardAiRequest, serverError } from "./model";
import { clientIp } from "../ai/service";
import type { AiDeps } from "../ai/service";
import type { FutureErrorBody, FuturePayload } from "./types";

const explanations = new AnswerCache<AiAnswer>(BRIEF_CACHE_MS * 6);
/** Reading a place nobody has read yet costs two outside calls; a visitor may start 20 of those a minute. Cached places and the samples are free. */
let liveReads = new RateLimiter(20, 60_000);

export function clearExplanationCache(): void {
  explanations.clear();
  liveReads = new RateLimiter(20, 60_000);
}

/** The United States, with Alaska, Hawaii and territories, as in /api/outlook. */
export function parsePoint(params: URLSearchParams): { lat: number; lon: number } | null {
  const latText = params.get("lat");
  const lonText = params.get("lon");
  if (latText === null || lonText === null) return null;
  const lat = Number(latText);
  const lon = Number(lonText);
  const valid = Number.isFinite(lat) && Number.isFinite(lon) && lat >= 17 && lat <= 72 && lon >= -180 && lon <= -60;
  return valid ? { lat, lon } : null;
}

export async function futureRoute(request: Request, deps: { future?: FutureDeps; ai?: () => AiDeps } = {}): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const point = parsePoint(params);
  if (!point) return Response.json({ error: "lat and lon are required, and must be in the United States." } satisfies FutureErrorBody, { status: 400 });

  let payload: FuturePayload;
  try {
    if (!(await hasFuture(point.lat, point.lon, deps.future))) {
      const limit = liveReads.check(clientIp(request.headers), (deps.future?.now ?? (() => new Date()))().getTime());
      if (!limit.ok) return Response.json({ error: `Too many requests. Please wait ${limit.retryAfter} seconds.` } satisfies FutureErrorBody, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
    }
    payload = await getFuture(point.lat, point.lon, deps.future);
  } catch (error) {
    console.error("future failed", (error as Error | null)?.name);
    return Response.json({ error: "Something went wrong on our side. Please try again." } satisfies FutureErrorBody, { status: 500 });
  }
  const headers = { "Cache-Control": "no-store" };
  if (params.get("explain") !== "1") return Response.json(payload, { headers });

  // Precomputed (a sample address) or already made for this cell: no model call, no budget, no rate limit.
  if (payload.explanation) return Response.json(payload, { headers });
  const aiDeps = (deps.ai ?? getAiDeps)();
  const key = futureKey(payload.lat, payload.lon);
  const cached = explanations.get(key, aiDeps.now());
  if (cached) return Response.json({ ...payload, explanation: { ...cached, cached: true } }, { headers });

  const blocked = guardAiRequest(request, aiDeps);
  if (blocked) return Response.json(blocked.body, { status: blocked.status, headers: { ...headers, ...(blocked.headers ?? {}) } });

  try {
    const result = await explanations.once(key, async () => {
      const ran = await explainFuture(payload, aiDeps);
      if (!ran.ok) throw new FailureBox(ran.failure);
      return ran.answer;
    });
    // Only an answer with sentences is kept; "could not verify" is tried again next time.
    if (result.state === "ok") explanations.set(key, result, aiDeps.now());
    return Response.json({ ...payload, explanation: result }, { headers });
  } catch (error) {
    if (error instanceof FailureBox) return Response.json(error.failure.body, { status: error.failure.status, headers: { ...headers, ...(error.failure.headers ?? {}) } });
    const failure = serverError();
    return Response.json(failure.body, { status: failure.status, headers });
  }
}

class FailureBox extends Error {
  constructor(readonly failure: ReturnType<typeof serverError>) {
    super("ai failure");
  }
}
