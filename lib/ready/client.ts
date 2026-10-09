/**
 * The browser side of /api/ready: one call, a time limit, and a plain state for every way it can end. Safe to import from client code.
 */
import { GENERIC_MESSAGE, NETWORK_MESSAGE, TIMEOUT_MESSAGE } from "../climate/client";
import type { ReadyPayload } from "./types";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/** The server reads the record and makes one model call; allow for a cold start. */
export const READY_TIMEOUT_MS = 70_000;

export type ReadyResult = { ok: true; payload: ReadyPayload } | { ok: false; message: string };

export const readyUrl = (lat: number, lon: number, state: string): string => `/api/ready?lat=${lat}&lon=${lon}&state=${encodeURIComponent(state)}`;

export async function requestReady(lat: number, lon: number, state: string, fetchFn: FetchLike = defaultFetch, timeoutMs = READY_TIMEOUT_MS): Promise<ReadyResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchFn(readyUrl(lat, lon, state), { signal: controller.signal });
    const body = (await response.json()) as ReadyPayload | { message?: string; error?: string };
    if (!response.ok || !("items" in body)) return { ok: false, message: ("message" in body && body.message) || ("error" in body && body.error) || GENERIC_MESSAGE };
    return { ok: true, payload: body };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, message: GENERIC_MESSAGE };
    return { ok: false, message: timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE };
  } finally {
    clearTimeout(timer);
  }
}
