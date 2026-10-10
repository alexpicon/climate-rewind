import { APP_USER_AGENT } from "./brand";

/** Every external call gives up after this long (AGENTS.md: 8 s at most). */
export const REQUEST_TIMEOUT_MS = 8000;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type FetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "timeout" | "network" | "http" | "parse"; status?: number };

/** NWS asks API clients to identify themselves. */
export const USER_AGENT = APP_USER_AGENT;

/**
 * GET a URL and parse JSON, never throwing. Gives up after `timeoutMs`, even if
 * the underlying fetch ignores its abort signal.
 */
export async function fetchJson<T>(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<FetchResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([fetchFn(url, { ...init, signal: controller.signal }), timeout]);
    if (response === "timeout") return { ok: false, reason: "timeout" };
    if (!response.ok) return { ok: false, reason: "http", status: response.status };
    try {
      return { ok: true, data: (await response.json()) as T };
    } catch {
      return { ok: false, reason: "parse" };
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, reason: aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

/** What the page says when a data service answers 429: no status code, no host name in the main text. */
export const BUSY_NOTICE = "The climate data service is busy right now. Try again in a minute.";

/** Plain-language reason for a failed call, for the "notices" in the payload. */
export function describeFailure(label: string, result: Extract<FetchResult<unknown>, { ok: false }>): string {
  switch (result.reason) {
    case "timeout":
      return `${label} did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`;
    case "http":
      if (result.status === 429) return BUSY_NOTICE;
      return `${label} returned an error (HTTP ${result.status}).`;
    case "parse":
      return `${label} sent a reply we could not read.`;
    default:
      return `We could not reach ${label.replace(/^The /, "the ")}.`;
  }
}
