/**
 * The browser side of /api/outlook, /api/brief and /api/ask: one call each, a time limit, and a plain state for every way
 * it can end. The AI states ("resting", "unavailable", "rate limited") are honest answers, not page errors.
 */
import type { AiAnswer, AiErrorBody, AiErrorState, StoryAnswer } from "../ai/types";
import type { OutlookPayload } from "../outlook-types";
import { GENERIC_MESSAGE, NETWORK_MESSAGE, TIMEOUT_MESSAGE } from "./lookup-client";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export const OUTLOOK_TIMEOUT_MS = 20_000;
/** The server does an address lookup and one model call; allow for a cold start. */
export const AI_TIMEOUT_MS = 70_000;

export type OutlookResult = { ok: true; outlook: OutlookPayload } | { ok: false; message: string };

async function timedFetch(fetchFn: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<{ response: Response } | { error: string }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return { response: await fetchFn(url, { ...init, signal: controller.signal }) };
  } catch {
    return { error: timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE };
  } finally {
    clearTimeout(timer);
  }
}

export async function requestOutlook(lat: number, lon: number, fetchFn: FetchLike = defaultFetch, timeoutMs = OUTLOOK_TIMEOUT_MS): Promise<OutlookResult> {
  const got = await timedFetch(fetchFn, `/api/outlook?lat=${lat}&lon=${lon}`, {}, timeoutMs);
  if ("error" in got) return { ok: false, message: got.error };
  try {
    const body = (await got.response.json()) as OutlookPayload | { error?: string };
    if (!got.response.ok || "error" in body) return { ok: false, message: ("error" in body && body.error) || GENERIC_MESSAGE };
    return { ok: true, outlook: body as OutlookPayload };
  } catch {
    return { ok: false, message: GENERIC_MESSAGE };
  }
}

export type AiResult = { ok: true; answer: AiAnswer } | { ok: false; state: AiErrorState; message: string; retryAfter?: number };

async function postAi(path: "/api/brief" | "/api/ask", payload: Record<string, string>, fetchFn: FetchLike, timeoutMs: number): Promise<AiResult> {
  const got = await timedFetch(fetchFn, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, timeoutMs);
  if ("error" in got) return { ok: false, state: "error", message: got.error };
  try {
    const body = (await got.response.json()) as AiAnswer | AiErrorBody;
    if (!got.response.ok || !("sentences" in body)) {
      const err = body as Partial<AiErrorBody>;
      return { ok: false, state: err.state ?? "error", message: err.message ?? GENERIC_MESSAGE, ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}) };
    }
    return { ok: true, answer: body };
  } catch {
    return { ok: false, state: "error", message: GENERIC_MESSAGE };
  }
}

export function requestBrief(address: string, fetchFn: FetchLike = defaultFetch, timeoutMs = AI_TIMEOUT_MS): Promise<AiResult> {
  return postAi("/api/brief", { address }, fetchFn, timeoutMs);
}

export function requestAsk(address: string, question: string, fetchFn: FetchLike = defaultFetch, timeoutMs = AI_TIMEOUT_MS): Promise<AiResult> {
  return postAi("/api/ask", { address, question }, fetchFn, timeoutMs);
}

export type StoryResult = { ok: true; story: StoryAnswer } | { ok: false; state: AiErrorState; message: string; retryAfter?: number };

/** The area's AI story for an address (/api/story). The server caches it by county. */
export async function requestStory(address: string, fetchFn: FetchLike = defaultFetch, timeoutMs = AI_TIMEOUT_MS): Promise<StoryResult> {
  const got = await timedFetch(fetchFn, "/api/story", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }) }, timeoutMs);
  if ("error" in got) return { ok: false, state: "error", message: got.error };
  try {
    const body = (await got.response.json()) as StoryAnswer | AiErrorBody;
    if (!got.response.ok || !("sentences" in body)) {
      const err = body as Partial<AiErrorBody>;
      return { ok: false, state: err.state ?? "error", message: err.message ?? GENERIC_MESSAGE, ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}) };
    }
    return { ok: true, story: body };
  } catch {
    return { ok: false, state: "error", message: GENERIC_MESSAGE };
  }
}
