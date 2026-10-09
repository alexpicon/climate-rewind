/** The browser side of /api/lookup: one call, a time limit, and a plain message for every way it can fail. */
import { applyPart, emptyPayload, type LookupPatch } from "../lookup-parts";
import { addressToQuery } from "../lookup-query";
import type { LookupAddress, LookupErrorBody, LookupPart, LookupPayload, NoticeKey, StormReplay } from "../types";

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

// ---------------------------------------------------------------- the lookup in pieces

/** The parts the first view waits for: both are read from our own files, so they come back in a second or two. The rest fill in. */
export const CORE_PARTS: readonly LookupPart[] = ["records", "area"];
export const ENRICH_PARTS: readonly LookupPart[] = ["live", "fema", "heat", "trigger"];

/** What the page says when one slow source did not answer. The first view is drawn without it. */
const PART_NOTICE: Partial<Record<LookupPart, { key: NoticeKey; text: string }>> = {
  records: { key: "index", text: "We could not read the flood and tornado records just now, so they are not shown. Try again in a moment." },
  area: { key: "areaEvents", text: "We could not read the area’s events just now. Try again in a moment." },
  live: { key: "live", text: "The National Weather Service alert feed did not answer in time." },
  fema: { key: "fema", text: "FEMA’s flood map service did not answer in time." },
  heat: { key: "heat", text: "The heat history did not arrive in time. That does not mean it was never hot here." },
};

export interface StagedHandlers {
  /** The Census matched the address: the first real progress. */
  onAddress?: (address: LookupAddress) => void;
  /** A core part (records or area) came back. */
  onStep?: (part: LookupPart) => void;
  /** Records and area are in: draw the first view. Parts not read yet are in `pending`. */
  onCore: (payload: LookupPayload) => void;
  /** Another part arrived (or failed with a notice). The page merges it into what is on screen with `applyPart`. */
  onPart: (part: LookupPart, patch: LookupPatch) => void;
  /** The address could not be matched (or the whole thing failed): the message to show. */
  onFail: (message: string) => void;
  /** False once the visitor has asked for something else; nothing more is reported. */
  isCurrent?: () => boolean;
}

type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

async function getJson<T>(fetchFn: Fetcher, url: string, timeoutMs: number): Promise<{ ok: true; body: T } | { ok: false; message: string }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchFn(url, { signal: controller.signal });
    const body = (await response.json()) as T | LookupErrorBody;
    if (!response.ok || (body && typeof body === "object" && "error" in body)) return { ok: false, message: (body as LookupErrorBody)?.error || GENERIC_MESSAGE };
    return { ok: true, body: body as T };
  } catch {
    return { ok: false, message: timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The lookup as the page runs it: match the address, ask for every part at once, draw the first view when the two quick parts
 * (records, area) are in, and hand the slow ones (alerts, FEMA, the heat history, the flood trigger) over as they arrive. A slow
 * or failed part becomes a plain notice; only an address that cannot be matched fails the lookup.
 */
export async function requestStagedLookup(
  address: string,
  night: string | null,
  handlers: StagedHandlers,
  fetchFn: Fetcher = (url, init) => fetch(url, init),
  timeoutMs: number = CLIENT_LOOKUP_TIMEOUT_MS,
): Promise<void> {
  const current = () => handlers.isCurrent?.() ?? true;
  const matched = await getJson<{ address: LookupAddress }>(fetchFn, `/api/lookup/geocode?address=${encodeURIComponent(address)}`, timeoutMs);
  if (!current()) return;
  if (!matched.ok) {
    handlers.onFail(matched.message);
    return;
  }
  const where = matched.body.address;
  handlers.onAddress?.(where);

  const query = addressToQuery(where, night).toString();
  const ask = async (part: LookupPart): Promise<LookupPatch> => {
    const got = await getJson<{ patch: LookupPatch }>(fetchFn, `/api/lookup/${part}?${query}`, timeoutMs);
    if (got.ok) return got.body.patch;
    const notice = PART_NOTICE[part];
    return notice ? { notices: { [notice.key]: notice.text } } : part === "trigger" ? { floodTrigger: { status: "unavailable", floodDays: 0, triggerIn: null, history: [], forecast: null, notices: { history: got.message } } } : {};
  };

  // Everything starts now; the core parts decide when the first view is drawn.
  const reads = new Map<LookupPart, Promise<LookupPatch>>(([...CORE_PARTS, ...ENRICH_PARTS] as LookupPart[]).map((part) => [part, ask(part)]));
  let payload = emptyPayload(where, [...CORE_PARTS, ...ENRICH_PARTS]);
  for (const part of CORE_PARTS) {
    // Core parts are applied in the order they finish, but the first view waits for both.
    reads.get(part)!.then((patch) => {
      if (current()) handlers.onStep?.(part);
      return patch;
    });
  }
  const core = await Promise.all(CORE_PARTS.map((part) => reads.get(part)!));
  if (!current()) return;
  CORE_PARTS.forEach((part, i) => {
    payload = applyPart(payload, part, core[i]);
  });
  handlers.onCore(payload);
  await Promise.all(
    ENRICH_PARTS.map(async (part) => {
      const patch = await reads.get(part)!;
      if (current()) handlers.onPart(part, patch);
    }),
  );
}
