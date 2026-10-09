/**
 * The browser side of /api/future: one call for the numbers, one for the AI explanation, a time limit on each, and a plain state for every
 * way it can end. Safe to import from client code.
 */
import type { AiAnswer, AiErrorBody, AiErrorState } from "../ai/types";
import type { FuturePayload } from "./types";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export const FUTURE_TIMEOUT_MS = 25_000;
export const EXPLAIN_TIMEOUT_MS = 70_000;

export const NETWORK_MESSAGE = "We could not reach the server. Check your connection and try again.";
export const TIMEOUT_MESSAGE = "That took too long. Please try again.";
export const GENERIC_MESSAGE = "Something went wrong on our side. Please try again.";

async function timedFetch(fetchFn: FetchLike, url: string, timeoutMs: number): Promise<{ response: Response } | { error: string }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return { response: await fetchFn(url, { signal: controller.signal }) };
  } catch {
    return { error: timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE };
  } finally {
    clearTimeout(timer);
  }
}

export const futureUrl = (lat: number, lon: number, explain = false): string => `/api/future?lat=${lat}&lon=${lon}${explain ? "&explain=1" : ""}`;

export type FutureResult = { ok: true; payload: FuturePayload } | { ok: false; message: string };

export async function requestFuture(lat: number, lon: number, fetchFn: FetchLike = defaultFetch, timeoutMs = FUTURE_TIMEOUT_MS): Promise<FutureResult> {
  const got = await timedFetch(fetchFn, futureUrl(lat, lon), timeoutMs);
  if ("error" in got) return { ok: false, message: got.error };
  try {
    const body = (await got.response.json()) as FuturePayload | { error?: string };
    if (!got.response.ok || !("notices" in body)) return { ok: false, message: ("error" in body && body.error) || GENERIC_MESSAGE };
    return { ok: true, payload: body };
  } catch {
    return { ok: false, message: GENERIC_MESSAGE };
  }
}

export type ExplainResult = { ok: true; answer: AiAnswer } | { ok: false; state: AiErrorState; message: string; retryAfter?: number };

export async function requestExplanation(lat: number, lon: number, fetchFn: FetchLike = defaultFetch, timeoutMs = EXPLAIN_TIMEOUT_MS): Promise<ExplainResult> {
  const got = await timedFetch(fetchFn, futureUrl(lat, lon, true), timeoutMs);
  if ("error" in got) return { ok: false, state: "error", message: got.error };
  try {
    const body = (await got.response.json()) as FuturePayload | AiErrorBody;
    if (got.response.ok && "notices" in body && body.explanation) return { ok: true, answer: body.explanation };
    const err = body as Partial<AiErrorBody>;
    return { ok: false, state: err.state ?? "error", message: err.message ?? GENERIC_MESSAGE, ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}) };
  } catch {
    return { ok: false, state: "error", message: GENERIC_MESSAGE };
  }
}
