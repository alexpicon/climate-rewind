/** The browser side of /api/lookup: one call, a time limit, and a plain message for every way it can fail. */
import type { LookupErrorBody, LookupPayload, StormReplay } from "../types";

/**
 * The server gives each outside service 8 seconds and asks them in parallel after the address match, so a slow
 * lookup should still finish inside about 20 seconds. Past this we stop waiting and say so.
 */
export const CLIENT_LOOKUP_TIMEOUT_MS = 25_000;

export type LookupResult = { ok: true; data: LookupPayload } | { ok: false; message: string };

export const TIMEOUT_MESSAGE = "This is taking longer than it should. The weather and map services may be slow right now. Please try again in a minute.";
export const NETWORK_MESSAGE = "We could not reach the server. Check your connection and try again.";
export const GENERIC_MESSAGE = "Something went wrong. Please try again.";

export async function requestLookup(
  address: string,
  fetchFn: (url: string, init?: { signal?: AbortSignal }) => Promise<Response> = (url, init) => fetch(url, init),
  timeoutMs: number = CLIENT_LOOKUP_TIMEOUT_MS,
  night: string | null = null,
): Promise<LookupResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const nightParam = night ? `&night=${encodeURIComponent(night)}` : "";
    const response = await fetchFn(`/api/lookup?address=${encodeURIComponent(address)}${nightParam}`, { signal: controller.signal });
    const body = (await response.json()) as LookupPayload | LookupErrorBody;
    if (!response.ok || "error" in body) return { ok: false, message: "error" in body && body.error ? body.error : GENERIC_MESSAGE };
    return { ok: true, data: body };
  } catch {
    return { ok: false, message: timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE };
  } finally {
    clearTimeout(timer);
  }
}

export type ReplayResult = { ok: true; stormReplay: StormReplay } | { ok: false; message: string };

/** Another storm night for an address already looked up (the "Storm nights" picker). Index only, so it is quick. */
export async function requestReplay(
  where: { state: string; lat: number; lon: number },
  night: string,
  fetchFn: (url: string, init?: { signal?: AbortSignal }) => Promise<Response> = (url, init) => fetch(url, init),
  timeoutMs: number = 15_000,
): Promise<ReplayResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const query = new URLSearchParams({ state: where.state, lat: String(where.lat), lon: String(where.lon), night });
  try {
    const response = await fetchFn(`/api/replay?${query.toString()}`, { signal: controller.signal });
    const body = (await response.json()) as { stormReplay?: StormReplay } | LookupErrorBody;
    if (!response.ok || !("stormReplay" in body) || !body.stormReplay) return { ok: false, message: "error" in body && body.error ? body.error : GENERIC_MESSAGE };
    return { ok: true, stormReplay: body.stormReplay };
  } catch {
    return { ok: false, message: timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE };
  } finally {
    clearTimeout(timer);
  }
}
