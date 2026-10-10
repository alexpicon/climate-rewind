import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AnswerCache, RateLimiter, TokenBudget } from "@/lib/ai/guard";
import type { AiDeps } from "@/lib/ai/service";
import type { AiAnswer } from "@/lib/ai/types";
import { futureSources } from "@/lib/climate/explain";
import { clearExplanationCache, futureRoute } from "@/lib/climate/future-route";
import { clearFutureCache } from "@/lib/climate/live";
import { clearFutureSampleCache } from "@/lib/climate/samples";
import type { FuturePayload } from "@/lib/climate/types";
import { fakeClient, modelReply } from "./ai-fixtures";
import { archiveReply, climateReply, MODELS_HOT_BASE, MODELS_HOT_FUTURE } from "./future-fixtures";

const NOW = Date.parse("2026-10-08T19:00:00Z");

function netFake(overrides: { climate?: () => Response } = {}) {
  const urls: string[] = [];
  const fetchFn = async (url: string): Promise<Response> => {
    urls.push(url);
    if (url.startsWith("https://archive-api.open-meteo.com/")) return Response.json(archiveReply());
    if (url.startsWith("https://climate-api.open-meteo.com/")) {
      if (overrides.climate) return overrides.climate();
      return Response.json(url.includes("start_date=2041") ? climateReply([2041, 2050], MODELS_HOT_FUTURE) : climateReply([2001, 2020], MODELS_HOT_BASE));
    }
    return new Response("nope", { status: 404 });
  };
  return { fetchFn, urls };
}

function aiDeps(reply: unknown, client = true) {
  const c = fakeClient(() => modelReply(reply));
  const deps = {
    client: client ? c : null,
    budget: new TokenBudget(1_000_000),
    limiter: new RateLimiter(10, 60_000),
    cache: new AnswerCache<AiAnswer>(),
    lookup: async () => {
      throw new Error("unused");
    },
    outlook: async () => {
      throw new Error("unused");
    },
    damage: async () => [],
    now: () => NOW,
  } as unknown as AiDeps;
  return { deps, calls: c.calls };
}

const req = (query: string, headers: Record<string, string> = {}) => new Request(`https://memoria.test/api/future?${query}`, { headers: { host: "memoria.test", ...headers } });
const BELLEVUE = "lat=47.614&lon=-122.1935";

beforeEach(() => {
  clearFutureCache();
  clearExplanationCache();
  clearFutureSampleCache();
  process.env.MEMORIA_PROJECTIONS_DIR = path.join(tmpdir(), "no-such-projections-dir");
});

describe("/api/future numbers", () => {
  it("computes the observed decades and trends, and the projected range across the 7 models", async () => {
    const net = netFake();
    const response = await futureRoute(req(BELLEVUE), { future: { fetch: net.fetchFn, now: () => new Date(NOW) } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as FuturePayload;
    const hot = body.observed!.measures.find((m) => m.id === "feels90")!;
    expect(hot.trend?.verdict).toBe("increasing");
    expect(body.observed!.measures.find((m) => m.id === "rain1")!.trend?.verdict).toBe("none");
    expect(body.projected!.baseline).toEqual({ min: 6, median: 10, max: 14 });
    expect(body.projected!.future).toEqual({ min: 16, median: 24, max: 40 });
    expect(body.projected!.models).toHaveLength(7);
    expect(body.notices).toEqual({});
    expect(net.urls.filter((u) => u.includes("climate-api"))).toHaveLength(2);
  });

  it("keeps the answer for the 0.05 degree cell: a nearby second request makes no outside call", async () => {
    const net = netFake();
    const deps = { future: { fetch: net.fetchFn, now: () => new Date(NOW) } };
    await futureRoute(req(BELLEVUE), deps);
    const calls = net.urls.length;
    await futureRoute(req("lat=47.6150&lon=-122.1950"), deps);
    expect(net.urls.length).toBe(calls);
  });

  it("an honest fallback: if the climate service says no, the record still shows and the page is told why", async () => {
    const net = netFake({ climate: () => new Response("{}", { status: 429 }) });
    const body = (await (await futureRoute(req(BELLEVUE), { future: { fetch: net.fetchFn, now: () => new Date(NOW) } })).json()) as FuturePayload;
    expect(body.observed).not.toBeNull();
    expect(body.projected).toBeNull();
    expect(body.notices.projected).toBe("The climate data service is busy right now. Try again in a minute.");
  });

  it("serves a sample address from its file with no outside call", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "proj-"));
    const sample: FuturePayload = { slug: "bellevue", lat: 47.614205, lon: -122.193517, built: "2026-10-08T00:00:00Z", observed: null, projected: null, notices: { observed: "from file" } };
    writeFileSync(path.join(dir, "bellevue.json"), JSON.stringify(sample));
    process.env.MEMORIA_PROJECTIONS_DIR = dir;
    const net = netFake();
    const body = (await (await futureRoute(req(BELLEVUE), { future: { fetch: net.fetchFn, now: () => new Date(NOW) } })).json()) as FuturePayload;
    expect(body.slug).toBe("bellevue");
    expect(net.urls).toEqual([]);
  });

  it("limits how many places one visitor can start reading live, but cached places and samples cost nothing", async () => {
    const net = netFake();
    const deps = { future: { fetch: net.fetchFn, now: () => new Date(NOW) } };
    let last = 200;
    for (let i = 0; i < 21; i += 1) last = (await futureRoute(req(`lat=${30 + i * 0.5}&lon=-100`), deps)).status;
    expect(last).toBe(429);
    // a place already read is still served
    expect((await futureRoute(req("lat=30&lon=-100"), deps)).status).toBe(200);
  });

  it("refuses a point outside the United States", async () => {
    expect((await futureRoute(req("lat=51.5&lon=-0.12"))).status).toBe(400);
    expect((await futureRoute(req("lat=abc&lon=-86"))).status).toBe(400);
    expect((await futureRoute(req("lat=36"))).status).toBe(400);
  });
});

describe("/api/future explanation", () => {
  const net = () => netFake();
  const explainUrl = `${BELLEVUE}&explain=1`;

  it("builds sources that carry the computed numbers, the trend verdicts and the caveat", async () => {
    const n = net();
    const payload = (await (await futureRoute(req(BELLEVUE), { future: { fetch: n.fetchFn, now: () => new Date(NOW) } })).json()) as FuturePayload;
    const sources = futureSources(payload);
    expect(sources.map((s) => s.id)).toEqual(["past-air-hot-days", "past-hot-days", "past-very-hot-days", "past-heavy-rain", "future-hot-days", "caveat"]);
    const future = sources.find((s) => s.id === "future-hot-days")!;
    expect(future.text).toContain("Climate models: 10/yr (2001 to 2020, models) to 24/yr (2041 to 2050), about +14.0 days a year.");
    expect(future.text).toMatch(/Across models the change ranges from \+[\d.]+ to \+[\d.]+ days a year\./);
    expect(future.text).toContain("from 16 to 40 in 2041 to 2050");
    expect(sources.find((s) => s.id === "past-heavy-rain")!.text).toContain("Result: no clear trend yet.");
    expect(sources.find((s) => s.id === "caveat")!.text).toContain("physics simulations, not a forecast");
  });

  it("keeps verified sentences (with their sources) and drops one that changes a number", async () => {
    const n = net();
    const reply = {
      scope: "in_scope",
      sentences: [
        { text: "The record shows no clear trend yet in days with 1 inch of rain or more.", cites: ["past-heavy-rain"] },
        { text: "Climate models put the middle count at 24 days a year in 2041 to 2050, with models ranging from 16 to 40.", cites: ["future-hot-days"] },
        { text: "Climate models put the middle count at 31 days a year in 2041 to 2050.", cites: ["future-hot-days"] },
        { text: "This is a projection, not a forecast, and the models disagree.", cites: [] },
      ],
    };
    const ai = aiDeps(reply);
    const body = (await (await futureRoute(req(explainUrl), { future: { fetch: n.fetchFn, now: () => new Date(NOW) }, ai: () => ai.deps })).json()) as FuturePayload;
    expect(body.explanation?.state).toBe("ok");
    expect(body.explanation?.sentences).toHaveLength(2);
    expect(body.explanation?.dropped).toBe(2);
    expect(Object.keys(body.explanation!.sources).sort()).toEqual(["future-hot-days", "past-heavy-rain"]);
    // the model was told the rules and given only our sources
    const prompt = (ai.calls[0] as { messages: Array<{ content: string }>; system: string });
    expect(prompt.system).toContain("never a forecast");
    expect(prompt.messages[0].content).toContain('<source id="caveat"');
  });

  it("one model call per cell: a second request gets the kept explanation", async () => {
    const n = net();
    const reply = { scope: "in_scope", sentences: [{ text: "The record shows no clear trend yet in days with 1 inch of rain or more.", cites: ["past-heavy-rain"] }] };
    const ai = aiDeps(reply);
    const deps = { future: { fetch: n.fetchFn, now: () => new Date(NOW) }, ai: () => ai.deps };
    await futureRoute(req(explainUrl), deps);
    const second = (await (await futureRoute(req(explainUrl), deps)).json()) as FuturePayload;
    expect(second.explanation?.cached).toBe(true);
    expect(ai.calls).toHaveLength(1);
  });

  it("a sample's precomputed explanation is served without a model call, budget or rate limit", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "proj-"));
    const explanation: AiAnswer = { state: "ok", sentences: [{ text: "Stored sentence for this address.", cites: [] }], sources: {}, dropped: 0, message: null, generatedAt: "2026-10-08T00:00:00Z", model: "m", cached: false };
    const sample: FuturePayload = { slug: "bellevue", lat: 47.614205, lon: -122.193517, built: "2026-10-08T00:00:00Z", observed: null, projected: null, notices: {}, explanation };
    writeFileSync(path.join(dir, "bellevue.json"), JSON.stringify(sample));
    process.env.MEMORIA_PROJECTIONS_DIR = dir;
    const ai = aiDeps({ scope: "in_scope", sentences: [] }, false);
    const body = (await (await futureRoute(req(explainUrl), { ai: () => ai.deps })).json()) as FuturePayload;
    expect(body.explanation?.sentences[0].text).toBe("Stored sentence for this address.");
    expect(ai.calls).toHaveLength(0);
  });

  it("when the AI is off the answer is an honest problem, not a made-up explanation", async () => {
    const n = net();
    const ai = aiDeps({}, false);
    const response = await futureRoute(req(explainUrl), { future: { fetch: n.fetchFn, now: () => new Date(NOW) }, ai: () => ai.deps });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ state: "unavailable" });
  });

  it("an explanation where nothing verifies is 'no_answer' and is not kept", async () => {
    const n = net();
    const ai = aiDeps({ scope: "in_scope", sentences: [{ text: "Climate models say 99 days a year are coming.", cites: ["future-hot-days"] }] });
    const deps = { future: { fetch: n.fetchFn, now: () => new Date(NOW) }, ai: () => ai.deps };
    const body = (await (await futureRoute(req(explainUrl), deps)).json()) as FuturePayload;
    expect(body.explanation?.state).toBe("no_answer");
    await futureRoute(req(explainUrl), deps);
    expect(ai.calls).toHaveLength(2);
  });

  it("refuses a cross-site request", async () => {
    const n = net();
    const ai = aiDeps({ scope: "in_scope", sentences: [] });
    const response = await futureRoute(req(explainUrl, { origin: "https://evil.test" }), { future: { fetch: n.fetchFn, now: () => new Date(NOW) }, ai: () => ai.deps });
    expect(response.status).toBe(403);
    expect(ai.calls).toHaveLength(0);
  });
});
