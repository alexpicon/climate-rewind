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

/**
 * The 72-hour tab starts its two reads (official outlooks, the AI brief) the moment the address is matched, while the records are still
 * loading, and hands them over when the tab opens. A read is used once and only within a minute; a retry always asks again.
 */
const PREFETCH_MS = 60_000;
const prefetched = new Map<string, { at: number; promise: Promise<unknown> }>();

function takePrefetched<T>(key: string): Promise<T> | null {
  const hit = prefetched.get(key);
  prefetched.delete(key);
  return hit && Date.now() - hit.at < PREFETCH_MS ? (hit.promise as Promise<T>) : null;
}

export function prefetchAhead(address: string, lat: number, lon: number): void {
  const key = (kind: string, id: string) => `${kind}|${id}`;
  prefetched.set(key("outlook", `${lat},${lon}`), { at: Date.now(), promise: requestOutlook(lat, lon, defaultFetch, OUTLOOK_TIMEOUT_MS, true) });
  prefetched.set(key("brief", address.toLowerCase()), { at: Date.now(), promise: requestBrief(address, defaultFetch, AI_TIMEOUT_MS, "prefetch") });
}

export async function requestOutlook(lat: number, lon: number, fetchFn: FetchLike = defaultFetch, timeoutMs = OUTLOOK_TIMEOUT_MS, fresh = false): Promise<OutlookResult> {
  const early = !fresh && fetchFn === defaultFetch ? takePrefetched<OutlookResult>(`outlook|${lat},${lon}`) : null;
  if (early) return early;
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

async function postAi(path: "/api/brief" | "/api/ask", payload: Record<string, string | boolean>, fetchFn: FetchLike, timeoutMs: number): Promise<AiResult> {
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

/**
 * "normal": the tab asks (taking the early read if there is one). "prefetch": the early read itself. "live": skip the brief made ahead of time
 * for a sample address and write a fresh one (the page asks for this right after it shows the early one).
 */
export function requestBrief(address: string, fetchFn: FetchLike = defaultFetch, timeoutMs = AI_TIMEOUT_MS, mode: "normal" | "prefetch" | "live" = "normal"): Promise<AiResult> {
  const early = mode === "normal" && fetchFn === defaultFetch ? takePrefetched<AiResult>(`brief|${address.toLowerCase()}`) : null;
  return early ?? postAi("/api/brief", mode === "live" ? { address, fresh: true } : { address }, fetchFn, timeoutMs);
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
