/**
 * Shared plumbing for the two AI features here (the "what's changing" explanation and the "get ready" plan): the guardrails from
 * lib/ai/guard (same-origin check, per-IP rate limit, daily token budget) and one structured model call. Server only.
 * The model's text is never shown as written: each feature checks it with lib/ai/verify before anything goes out.
 */
import { sameOrigin } from "../ai/route";
import { clientIp, estimateTokens, getAiDeps, type AiDeps, type ModelClient, type ModelReply } from "../ai/service";
import { AI_MODEL } from "../ai/prompt";
import type { AiErrorBody } from "../ai/types";

export { AI_MODEL, getAiDeps };

export type AiFailure = { status: number; body: AiErrorBody; headers?: Record<string, string> };

const fail = (status: number, state: AiErrorBody["state"], message: string, extra: Partial<AiErrorBody> = {}, headers?: Record<string, string>): AiFailure => ({ status, body: { state, message, ...extra }, ...(headers ? { headers } : {}) });

export const RESTING_MESSAGE = "Today's allowance for AI answers is used up. It starts again at midnight UTC. The numbers on this page are unaffected.";
export const UNAVAILABLE_MESSAGE = "The AI is not switched on for this site right now. The numbers on this page are unaffected.";

/** Same-origin, rate limit, key present and budget left: null if the request may go on to a model call, else the answer to send. */
export function guardAiRequest(request: Request, deps: AiDeps): AiFailure | null {
  if (!sameOrigin(request)) return fail(403, "bad_request", "That request did not come from this site.");
  const limit = deps.limiter.check(clientIp(request.headers), deps.now());
  if (!limit.ok) return fail(429, "rate_limited", `Too many requests. Please wait ${limit.retryAfter} seconds.`, { retryAfter: limit.retryAfter }, { "Retry-After": String(limit.retryAfter) });
  if (!deps.client) return fail(503, "unavailable", UNAVAILABLE_MESSAGE);
  if (deps.budget.remaining(deps.now()) <= 0) return fail(503, "resting", RESTING_MESSAGE);
  return null;
}

export interface ModelJob {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}

/** One structured-output call, with the budget held before and settled after. Returns the reply text, or the failure to send. */
export async function runModel(deps: AiDeps, job: ModelJob): Promise<{ ok: true; text: string } | { ok: false; failure: AiFailure }> {
  const client = deps.client as ModelClient | null;
  if (!client) return { ok: false, failure: fail(503, "unavailable", UNAVAILABLE_MESSAGE) };
  const estimate = estimateTokens(job.system.length + job.user.length) + job.maxTokens;
  if (!deps.budget.reserve(estimate, deps.now())) return { ok: false, failure: fail(503, "resting", RESTING_MESSAGE) };

  let reply: ModelReply;
  try {
    reply = await client.messages.create({
      model: AI_MODEL,
      max_tokens: job.maxTokens,
      // Copying checked facts into short sentences needs no reasoning (on this model "between_tools" is how thinking is turned off).
      thinking: { type: "between_tools" },
      system: job.system,
      messages: [{ role: "user", content: job.user }],
      output_config: { format: { type: "json_schema", schema: job.schema } },
    });
  } catch (error) {
    deps.budget.settle(estimate, 0, deps.now());
    const status = (error as { status?: number } | null)?.status;
    console.error("ai call failed", (error as Error | null)?.name, status);
    if (status === 401 || status === 403) return { ok: false, failure: fail(503, "unavailable", UNAVAILABLE_MESSAGE) };
    return { ok: false, failure: fail(502, "error", "The AI did not answer. Please try again in a moment.") };
  }
  deps.budget.settle(estimate, (reply.usage?.input_tokens ?? 0) + (reply.usage?.output_tokens ?? 0) || estimate, deps.now());
  const text = reply.content.find((block) => block.type === "text")?.text;
  if (!text) return { ok: false, failure: fail(502, "error", "The AI sent an answer we could not read. Please try again.") };
  return { ok: true, text };
}

export const serverError = (): AiFailure => fail(500, "error", "Something went wrong on our side. Please try again.");
