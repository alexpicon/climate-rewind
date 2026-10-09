/**
 * The AI briefing and "Ask your street": one function, `handleAi`, behind /api/brief and /api/ask. Server only.
 *
 * Flow: validate -> per-IP rate limit -> cache -> key and budget check -> build the sources from the address's real data ->
 * one model call that must return structured JSON -> code verifies every sentence -> only the verified sentences go out.
 * The model never sees the key, the visitor never sees the model's raw output, and the key never leaves this process.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { lookupAddress } from "../lookup";
import { LruCache } from "../lru";
import { buildOutlook } from "../outlooks";
import { lookupAreaEvents, selectAreaEvents } from "../area-events";
import { fetchActiveAlerts, geocodeAddress, LookupError } from "../sources";
import type { AreaEventsSummary, LiveAlerts, LookupPayload } from "../types";
import type { OutlookPayload } from "../outlook-types";
import { readEnv } from "../env";
import { loadDamageRows, type DamageRow } from "./damage";
import { AnswerCache, BRIEF_CACHE_MS, RateLimiter, readDailyBudget, TokenBudget } from "./guard";
import {
  AI_MODEL,
  ANSWER_SCHEMA,
  asksAboutTheFuture,
  buildUserMessage,
  MAX_OUTPUT_TOKENS,
  NO_FORECAST_LINE,
  NOT_IN_RECORDS_MESSAGE,
  NOTHING_VERIFIED_MESSAGE,
  OFF_TOPIC_MESSAGE,
  SYSTEM_PROMPT,
} from "./prompt";
import { buildSources, renderContext } from "./sources";
import { MAX_QUESTION_CHARS, type StoryAnswer, type AiAnswer, type AiErrorBody, type AiScope, type AiSource, type DroppedSentence, type VerifiedSentence } from "./types";
import { verifySentences } from "./verify";

/** The slice of the Anthropic SDK we use, so tests can hand in a fake. */
export interface ModelClient {
  messages: {
    create(params: Record<string, unknown>): Promise<ModelReply>;
  };
}

export interface ModelReply {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string | null;
}

export interface AiDeps {
  /** Null when there is no API key: the page then shows an honest "not available" state. */
  client: ModelClient | null;
  budget: TokenBudget;
  limiter: RateLimiter;
  /** Answers to questions ("Ask your street"), kept for 10 minutes by address and question. */
  cache: AnswerCache<AiAnswer>;
  /** The 72-hour brief, kept for 60 minutes by address and a hash of the active alerts (new alerts: a new brief). Absent: briefs use `cache`. */
  briefCache?: AnswerCache<AiAnswer>;
  /**
   * A cheap digest of the alerts active at an address (no model, no full lookup), used to find a cached brief fast. Null when it
   * cannot be had; the brief then falls back to the full lookup. Absent: always the full lookup.
   */
  alertsDigest?: (address: string) => Promise<string | null>;
  lookup: (address: string) => Promise<LookupPayload>;
  /** What has happened in the address's county, its NWS forecast zone and zones within 15 km (no full lookup). Absent: no area story. */
  areaEvents?: (address: string) => Promise<AreaEventsSummary | null>;
  /** The area story, kept a day by county and zone set. Absent: no area story. */
  storyCache?: AnswerCache<StoryAnswer>;
  outlook: (lat: number, lon: number) => Promise<OutlookPayload>;
  damage: (state: string) => Promise<DamageRow[]>;
  now: () => number;
  /** Called once per model answer with what was written and what the checks did with it (the 20-question test uses it). Never needed in production. */
  audit?: (event: AuditEvent) => void;
}

export interface AuditEvent {
  address: string;
  question: string | null;
  scope: AiScope;
  kept: VerifiedSentence[];
  dropped: DroppedSentence[];
  tokens: { input: number; output: number };
}

export interface AiRequest {
  address: string;
  /** Null for the 72-hour brief. */
  question: string | null;
  ip: string;
}

export type AiResult = { status: 200; body: AiAnswer } | { status: number; body: AiErrorBody; headers?: Record<string, string> };

const MAX_ADDRESS_CHARS = 200;
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Trims, collapses whitespace and removes control characters and angle brackets (they would be read as tags). */
export function cleanQuestion(text: string): string {
  return text.replace(CONTROL, " ").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
}

export const fail = (status: number, state: AiErrorBody["state"], message: string, extra: Partial<AiErrorBody> = {}, headers?: Record<string, string>): AiResult => ({
  status,
  body: { state, message, ...extra },
  ...(headers ? { headers } : {}),
});

/** Rough token count of a prompt, on the high side (about 3 characters a token), used only to hold budget before the call. */
export const estimateTokens = (chars: number) => Math.ceil(chars / 3);

function publicSources(ids: Iterable<string>, byId: ReadonlyMap<string, AiSource>): AiAnswer["sources"] {
  const out: AiAnswer["sources"] = {};
  for (const id of ids) {
    const source = byId.get(id);
    if (source) out[id] = source;
  }
  return out;
}

interface ParsedReply {
  scope: AiScope;
  sentences: unknown[];
}

function parseReply(reply: ModelReply): ParsedReply | null {
  const text = reply.content.find((block) => block.type === "text")?.text;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { scope?: unknown; sentences?: unknown };
    if (parsed.scope !== "in_scope" && parsed.scope !== "off_topic" && parsed.scope !== "not_in_records") return null;
    return { scope: parsed.scope, sentences: Array.isArray(parsed.sentences) ? parsed.sentences : [] };
  } catch {
    return null;
  }
}

/** Runs one briefing or question end to end. Never throws; every outcome is a status and a body the page can show. */
export async function handleAi(request: AiRequest, deps: AiDeps): Promise<AiResult> {
  const address = request.address.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!address) return fail(400, "bad_request", "Type a street address first.");
  if (address.length > MAX_ADDRESS_CHARS) return fail(400, "bad_request", "That address is too long.");

  let question: string | null = null;
  if (request.question !== null) {
    question = cleanQuestion(request.question);
    if (!question) return fail(400, "bad_request", "Type a question first.");
    if (question.length > MAX_QUESTION_CHARS) return fail(400, "bad_request", `Keep the question under ${MAX_QUESTION_CHARS} characters.`);
  }

  const now = deps.now();
  const limit = deps.limiter.check(request.ip, now);
  if (!limit.ok) {
    return fail(429, "rate_limited", `Too many requests. Please wait ${limit.retryAfter} seconds.`, { retryAfter: limit.retryAfter }, { "Retry-After": String(limit.retryAfter) });
  }

  if (!deps.client) return fail(503, "unavailable", "The AI briefing is not switched on for this site right now. The official outlooks on this page are unaffected.");
  const RESTING = "Today's allowance for AI answers is used up. It starts again at midnight UTC. The official outlooks on this page are unaffected.";

  // A question is remembered by address and question. The brief is remembered by address and the alerts active now: the same
  // address with new alerts is a new brief, because the brief starts with the alert.
  let cache = deps.cache;
  let key = AnswerCache.key(address, question ?? "");
  let looked: LookupPayload | undefined;
  if (question === null) {
    cache = deps.briefCache ?? deps.cache;
    if (deps.budget.limit <= 0) return fail(503, "resting", RESTING);
    try {
      const digest = await deps.alertsDigest?.(address).catch(() => null);
      if (digest) {
        key = `${key}|alerts:${digest}`;
      } else {
        looked = await deps.lookup(address);
        key = `${key}|alerts:${alertsDigestOf(looked.live)}`;
      }
    } catch (error) {
      return lookupFailure(error).result;
    }
  }
  const cached = cache.get(key, now);
  if (cached) return { status: 200, body: { ...cached, cached: true } };
  if (deps.budget.remaining(now) <= 0) return fail(503, "resting", RESTING);

  // Two identical requests at the same moment share one model call.
  try {
    const answer = await cache.once(key, () => produce(address, question, deps, cache, key, looked));
    return { status: 200, body: answer };
  } catch (error) {
    if (error instanceof Failure) return error.result;
    console.error("ai request failed", (error as Error | null)?.name);
    return fail(500, "error", "Something went wrong on our side. Please try again.");
  }
}

/** A short, stable digest of the alerts in force (their ids, events, headlines and end times), so a changed alert list changes the key. */
export function alertsDigestOf(live: LiveAlerts | null): string {
  if (!live) return "unknown";
  const parts = live.alerts.map((a) => `${a.id}|${a.event}|${a.headline}|${a.ends ?? ""}`).sort();
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

export class Failure extends Error {
  constructor(readonly result: AiResult) {
    super("ai failure");
  }
}

export function lookupFailure(error: unknown): Failure {
  if (error instanceof LookupError) return new Failure(fail(error.status, "bad_request", error.message));
  return new Failure(fail(502, "error", "We could not read this address's records just now. Please try again."));
}

async function produce(address: string, question: string | null, deps: AiDeps, cache: AnswerCache<AiAnswer>, cacheKey: string, preloaded?: LookupPayload): Promise<AiAnswer> {
  let lookup: LookupPayload;
  try {
    lookup = preloaded ?? (await deps.lookup(address));
  } catch (error) {
    throw lookupFailure(error);
  }
  const [outlook, damage] = await Promise.all([deps.outlook(lookup.address.lat, lookup.address.lon), deps.damage(lookup.address.state).catch(() => [])]);

  const sources = buildSources({ lookup, outlook, damage });
  const byId = new Map(sources.map((s) => [s.id, s]));
  const userMessage = buildUserMessage(renderContext(sources), question);

  const estimate = estimateTokens(SYSTEM_PROMPT.length + userMessage.length) + MAX_OUTPUT_TOKENS;
  if (!deps.budget.reserve(estimate, deps.now())) {
    throw new Failure(fail(503, "resting", "Today's allowance for AI answers is used up. It starts again at midnight UTC. The official outlooks on this page are unaffected."));
  }

  let reply: ModelReply;
  try {
    reply = await (deps.client as ModelClient).messages.create({
      model: AI_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      // The answer copies checked facts into short sentences; reasoning before it only adds cost and time and can pass the output limit.
      // (On this model "between_tools" is how thinking is turned off; "disabled" is refused.)
      thinking: { type: "between_tools" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      output_config: { format: { type: "json_schema", schema: ANSWER_SCHEMA } },
    });
  } catch (error) {
    deps.budget.settle(estimate, 0, deps.now());
    // The status and name only: an SDK error object can carry request details we do not log.
    const status = (error as { status?: number } | null)?.status;
    console.error("ai call failed", (error as Error | null)?.name, status);
    if (status === 401 || status === 403) throw new Failure(fail(503, "unavailable", "The AI briefing is not available right now. The official outlooks on this page are unaffected."));
    throw new Failure(fail(502, "error", "The AI did not answer. Please try again in a moment."));
  }
  deps.budget.settle(estimate, (reply.usage?.input_tokens ?? 0) + (reply.usage?.output_tokens ?? 0) || estimate, deps.now());

  const parsed = parseReply(reply);
  if (!parsed) {
    console.error("ai reply could not be read", reply.stop_reason);
    throw new Failure(fail(502, "error", "The AI sent an answer we could not read. Please try again."));
  }

  const base = { generatedAt: new Date(deps.now()).toISOString(), model: AI_MODEL, cached: false };
  let answer: AiAnswer;
  if (parsed.scope !== "in_scope") deps.audit?.({ address, question, scope: parsed.scope, kept: [], dropped: [], tokens: { input: reply.usage?.input_tokens ?? 0, output: reply.usage?.output_tokens ?? 0 } });
  if (parsed.scope === "off_topic") {
    answer = { ...base, state: "off_topic", sentences: [], sources: {}, dropped: 0, message: OFF_TOPIC_MESSAGE };
  } else if (parsed.scope === "not_in_records") {
    answer = { ...base, state: "no_answer", sentences: [], sources: {}, dropped: 0, message: NOT_IN_RECORDS_MESSAGE };
  } else {
    const { kept, dropped } = verifySentences(parsed.sentences, byId);
    deps.audit?.({ address, question, scope: parsed.scope, kept, dropped, tokens: { input: reply.usage?.input_tokens ?? 0, output: reply.usage?.output_tokens ?? 0 } });
    const shown = kept.slice(0, 8);
    answer = shown.length
      ? { ...base, state: "ok", sentences: shown, sources: publicSources(new Set(shown.flatMap((s) => s.cites)), byId), dropped: dropped.length + (kept.length - shown.length), message: null }
      : { ...base, state: "no_answer", sentences: [], sources: {}, dropped: dropped.length, message: NOTHING_VERIFIED_MESSAGE };
  }
  // "Will my street flood tomorrow?" is a question we never answer with a forecast: say so first, then the outlook and the record.
  if (question !== null && answer.state !== "off_topic" && asksAboutTheFuture(question)) answer = { ...answer, lead: NO_FORECAST_LINE };
  // An answer where nothing could be verified is not remembered: asking again may do better.
  if (answer.state !== "no_answer" || answer.dropped === 0) cache.set(cacheKey, answer, deps.now());
  return answer;
}

// ---------------------------------------------------------------- production wiring

const LOOKUP_CACHE_MS = 5 * 60_000;
/** A street address does not move: keep its Census match for a day so that finding a cached brief costs one alert check, not a lookup. */
const GEOCODE_CACHE_MS = 24 * 60 * 60_000;

/** Builds the real dependencies from the environment. The API key is read here and goes nowhere else. */
export function createAiDeps(env: Record<string, string | undefined> = process.env): AiDeps {
  const apiKey = readEnv(env, "ANTHROPIC_API_KEY");
  const lookups = new LruCache<LookupPayload>(60, LOOKUP_CACHE_MS);
  const geocodes = new LruCache<Awaited<ReturnType<typeof geocodeAddress>>>(200, GEOCODE_CACHE_MS);
  const fetchLike = (url: string, init?: RequestInit) => fetch(url, init);
  return {
    client: apiKey ? (new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 }) as unknown as ModelClient) : null,
    budget: new TokenBudget(readDailyBudget(env)),
    limiter: new RateLimiter(),
    cache: new AnswerCache<AiAnswer>(),
    briefCache: new AnswerCache<AiAnswer>(BRIEF_CACHE_MS),
    alertsDigest: async (address) => {
      const key = address.toLowerCase();
      let place = geocodes.get(key, Date.now());
      if (!place) {
        place = await geocodeAddress(address, fetchLike);
        geocodes.set(key, place, Date.now());
      }
      const alerts = await fetchActiveAlerts(place.lat, place.lon, fetchLike);
      return alerts.value ? alertsDigestOf(alerts.value) : null;
    },
    lookup: async (address) => {
      const key = address.toLowerCase();
      const hit = lookups.get(key, Date.now());
      if (hit) return hit;
      const payload = await lookupAddress(address);
      lookups.set(key, payload, Date.now());
      return payload;
    },
    areaEvents: async (address) => {
      const key = address.toLowerCase();
      let place = geocodes.get(key, Date.now());
      if (!place) {
        place = await geocodeAddress(address, fetchLike);
        geocodes.set(key, place, Date.now());
      }
      return (await lookupAreaEvents(place, { fetch: fetchLike, loadEvents: selectAreaEvents })).value;
    },
    storyCache: new AnswerCache<StoryAnswer>(24 * 60 * 60_000),
    outlook: (lat, lon) => buildOutlook(lat, lon),
    damage: (state) => loadDamageRows(state),
    now: () => Date.now(),
  };
}

const globalForAi = globalThis as unknown as { __memoriaAi?: AiDeps };

/** One set of dependencies per server process, so the rate limit, cache and budget persist between requests (and survive dev reloads). */
export function getAiDeps(): AiDeps {
  globalForAi.__memoriaAi ??= createAiDeps();
  return globalForAi.__memoriaAi;
}

/** The visitor's IP as the host reports it. Behind Vercel the first x-forwarded-for entry is the client. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
