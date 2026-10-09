import { beforeEach, describe, expect, it } from "vitest";
import { AnswerCache, RateLimiter, TokenBudget } from "@/lib/ai/guard";
import type { AiDeps } from "@/lib/ai/service";
import type { AiAnswer } from "@/lib/ai/types";
import { clearReadyCache, readyRoute, type ReadyDeps } from "@/lib/ready/ready-route";
import type { ReadyPayload } from "@/lib/ready/types";
import { fakeClient, modelReply } from "./ai-fixtures";
import { EVENTS, HEAT, stateIndex } from "./ready-fixtures";

const NOW = Date.parse("2026-10-08T19:00:00Z");

const GOOD_ITEMS = {
  items: [
    { action: "After the Flash Flood report of Mar 27, 2021 near you, never drive through flood waters: Turn Around, Don’t Drown!", local: ["SE-1265274"], guidance: ["flood-turn-around"] },
    { action: "The EF3 tornado of Mar 3, 2020 tracked near you; know your safe shelter. Identify and practice going to a safe shelter.", local: ["SE-882999"], guidance: ["tornado-shelter"] },
    { action: "Your heat record has 11 days at 100°F or more; plan where to go to get cool. Identify places in your community where you can go to get cool.", local: ["local-heat"], guidance: ["heat-cool-places"] },
    { action: "This one cites nothing local and must be dropped from the plan.", local: [], guidance: ["heat-fan"] },
    { action: "This one cites nothing official and must be dropped from the plan.", local: ["local-heat"], guidance: [] },
  ],
};

function aiDeps(reply: unknown = GOOD_ITEMS, client: boolean = true) {
  const c = fakeClient(() => modelReply(reply));
  const deps = {
    client: client ? c : null,
    budget: new TokenBudget(1_000_000),
    limiter: new RateLimiter(10, 60_000),
    cache: new AnswerCache<AiAnswer>(),
    lookup: async () => {
      throw new Error("not used");
    },
    outlook: async () => {
      throw new Error("not used");
    },
    damage: async () => [],
    now: () => NOW,
  } as unknown as AiDeps;
  return { deps, calls: c.calls };
}

function readyDeps(ai: AiDeps, overrides: Partial<ReadyDeps> = {}): ReadyDeps {
  return {
    fetch: async () => {
      throw new Error("no network in tests");
    },
    now: () => new Date(NOW),
    loadIndex: async () => stateIndex(),
    areaEvents: async () => EVENTS,
    areaIds: async () => ({ zone: "TNZ096", county: "TNC037" }),
    snapshots: async () => [],
    heat: async () => HEAT,
    ai: () => ai,
    ...overrides,
  };
}

const get = (query: string, headers: Record<string, string> = {}) => new Request(`https://memoria.test/api/ready?${query}`, { headers: { host: "memoria.test", ...headers } });
const NASH = "lat=36.168175&lon=-86.777516&state=TN";

beforeEach(() => clearReadyCache());

describe("/api/ready", () => {
  it("builds a plan from the record: only items with a local AND an official citation survive, and the why/source come from our data", async () => {
    const { deps, calls } = aiDeps();
    const response = await readyRoute(get(NASH), readyDeps(deps));
    expect(response.status).toBe(200);
    const body = (await response.json()) as ReadyPayload;
    expect(body.state).toBe("ok");
    expect(body.items).toHaveLength(3);
    expect(body.dropped).toBe(2);
    expect(body.items[0].why[0].label).toBe("Flash Flood report, Mar 27, 2021");
    expect(body.items[0].guidance[0].url).toBe("https://www.ready.gov/floods");
    expect(body.hazards.map((h) => h.id)).toContain("flood");
    // the model saw the local sources and the matching official lines, and not the wildfire lines
    const prompt = (calls[0] as { messages: Array<{ content: string }> }).messages[0].content;
    expect(prompt).toContain('<source id="SE-1265274"');
    expect(prompt).toContain('<guidance id="flood-turn-around"');
    expect(prompt).not.toContain('<guidance id="smoke-n95"');
  });

  it("hands the injected area-events source the address, state, county and zone", async () => {
    const { deps } = aiDeps();
    const seen: unknown[] = [];
    await readyRoute(get(NASH), readyDeps(deps, { areaEvents: async (input) => (seen.push(input), EVENTS) }));
    expect(seen).toEqual([{ lat: 36.168175, lon: -86.777516, state: "TN", county: "TNC037", zone: "TNZ096" }]);
  });

  it("keeps one answer per address: the second request makes no model call", async () => {
    const { deps, calls } = aiDeps();
    const d = readyDeps(deps);
    await readyRoute(get(NASH), d);
    const second = (await (await readyRoute(get(NASH), d)).json()) as ReadyPayload;
    expect(second.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("tolerates a missing data/events file: the plan rests on floods, tornadoes and heat, and says so", async () => {
    const { deps } = aiDeps();
    const body = (await (await readyRoute(get(NASH), readyDeps(deps, { areaEvents: async () => null }))).json()) as ReadyPayload;
    expect(body.state).toBe("ok");
    expect(body.notices.join(" ")).toContain("Storm events for the wider area");
    expect(body.hazards.map((h) => h.id)).toEqual(["flood", "tornado", "heat"]);
  });

  it("with nothing in the record there is no plan and no model call (no generic advice), and it is not an all-clear", async () => {
    const { deps, calls } = aiDeps();
    const none = readyDeps(deps, { loadIndex: async () => stateIndex({ floods: [], tornadoes: [] }), heat: async () => null, areaEvents: async () => null });
    const body = (await (await readyRoute(get(NASH), none)).json()) as ReadyPayload;
    expect(body.state).toBe("empty");
    expect(body.items).toEqual([]);
    expect(body.notices.join(" ")).toContain("not the same as no risk");
    expect(calls).toHaveLength(0);
  });

  it("a state we have not indexed says so", async () => {
    const { deps } = aiDeps();
    const body = (await (await readyRoute(get("lat=40&lon=-105&state=CO"), readyDeps(deps, { loadIndex: async () => null, areaEvents: async () => null, heat: async () => null }))).json()) as ReadyPayload;
    expect(body.notices.join(" ")).toContain("We have not indexed CO yet");
  });

  it("when the AI is off, the page still gets the record counted by code, plus an honest problem", async () => {
    const { deps } = aiDeps(GOOD_ITEMS, false);
    const response = await readyRoute(get(NASH), readyDeps(deps));
    expect(response.status).toBe(200);
    const body = (await response.json()) as ReadyPayload;
    expect(body.state).toBe("problem");
    expect(body.problem?.state).toBe("unavailable");
    expect(body.items).toEqual([]);
    expect(body.hazards.length).toBeGreaterThan(0);
  });

  it("an AI answer where nothing can be matched to both is shown as nothing, and is not remembered", async () => {
    const { deps, calls } = aiDeps({ items: [{ action: "Be careful out there when it storms near you.", local: [], guidance: [] }] });
    const d = readyDeps(deps);
    const body = (await (await readyRoute(get(NASH), d)).json()) as ReadyPayload;
    expect(body.state).toBe("empty");
    expect(body.dropped).toBe(1);
    await readyRoute(get(NASH), d);
    expect(calls).toHaveLength(2);
  });

  it("refuses bad input and cross-site browser requests, and rate limits per visitor", async () => {
    const { deps } = aiDeps();
    const d = readyDeps(deps);
    expect((await readyRoute(get("lat=36&lon=-86"), d)).status).toBe(400);
    expect((await readyRoute(get("lat=36&lon=-86&state=Tennessee"), d)).status).toBe(400);
    expect((await readyRoute(get("lat=0&lon=0&state=TN"), d)).status).toBe(400);
    expect((await readyRoute(get(NASH, { origin: "https://evil.test" }), d)).status).toBe(403);

    const limited = aiDeps();
    limited.deps.limiter = new RateLimiter(1, 60_000);
    const l = readyDeps(limited.deps);
    expect((await readyRoute(get("lat=36.1&lon=-86.7&state=TN"), l)).status).toBe(200);
    const again = await readyRoute(get("lat=36.2&lon=-86.7&state=TN"), l);
    expect(again.status).toBe(429);
    expect(again.headers.get("retry-after")).toBeTruthy();
  });

  it("a sample address reads its heat from the snapshot (no live heat call)", async () => {
    const { deps } = aiDeps();
    let live = 0;
    const d = readyDeps(deps, {
      heat: async () => {
        live += 1;
        return null;
      },
      snapshots: async () => [
        { slug: "nashville", address: "x", lat: 36.168175, lon: -86.777516, built: "2026-10-08T00:00:00Z", rain: null, heat: { byYear: HEAT.byYear, hottest: HEAT.hottest, worstWeek: HEAT.worstWeek, source: "test" } },
      ],
    });
    const body = (await (await readyRoute(get(NASH), d)).json()) as ReadyPayload;
    expect(live).toBe(0);
    expect(body.hazards.map((h) => h.id)).toContain("heat");
  });
});
