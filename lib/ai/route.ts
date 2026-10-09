/**
 * The shared body of /api/brief and /api/ask: same-origin check, JSON parsing, then `handleAi`. Server only.
 */
import { clientIp, getAiDeps, handleAi, type AiDeps } from "./service";
import { handleStory } from "./story";
import type { AiErrorBody } from "./types";

const MAX_BODY_BYTES = 4_000;

/** A browser request from another site is refused. (Requests without an Origin header, like curl, are allowed: the rate limit and the budget are the protection.) */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function aiRoute(request: Request, mode: "brief" | "ask", deps: AiDeps = getAiDeps()): Promise<Response> {
  const bad = (status: number, message: string) => Response.json({ state: "bad_request", message } satisfies AiErrorBody, { status });
  if (!sameOrigin(request)) return bad(403, "That request did not come from this site.");

  let body: { address?: unknown; question?: unknown; fresh?: unknown } = {};
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return bad(413, "That request is too large.");
    body = JSON.parse(text) as typeof body;
  } catch {
    return bad(400, "Send a JSON body.");
  }
  if (typeof body.address !== "string") return bad(400, "An address is required.");
  if (mode === "ask" && typeof body.question !== "string") return bad(400, "A question is required.");

  const result = await handleAi(
    { address: body.address, question: mode === "ask" ? (body.question as string) : null, ip: clientIp(request.headers), fresh: body.fresh === true },
    deps,
  );
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store", ...(("headers" in result && result.headers) || {}) } });
}

/** POST /api/story { address }: the verified "Your area's story". */
export async function storyRoute(request: Request, deps: AiDeps = getAiDeps()): Promise<Response> {
  const bad = (status: number, message: string) => Response.json({ state: "bad_request", message } satisfies AiErrorBody, { status });
  if (!sameOrigin(request)) return bad(403, "That request did not come from this site.");
  let body: { address?: unknown } = {};
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return bad(413, "That request is too large.");
    body = JSON.parse(text) as typeof body;
  } catch {
    return bad(400, "Send a JSON body.");
  }
  if (typeof body.address !== "string") return bad(400, "An address is required.");
  const result = await handleStory({ address: body.address, ip: clientIp(request.headers) }, deps);
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store", ...(("headers" in result && result.headers) || {}) } });
}
