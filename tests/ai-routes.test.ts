import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerCache, RateLimiter, TokenBudget } from "@/lib/ai/guard";
import { aiRoute, sameOrigin } from "@/lib/ai/route";
import { clientIp, type AiDeps } from "@/lib/ai/service";
import type { AiAnswer } from "@/lib/ai/types";
import { fakeClient, lookupFixture, modelReply, outlookFixture } from "./ai-fixtures";

const GOOD = { scope: "in_scope", sentences: [{ text: "The Weather Prediction Center rates Day 3 (Sat Oct 10) as Slight risk at this address.", cites: ["flood-outlook"] }] };

function deps(): AiDeps & { client: ReturnType<typeof fakeClient> } {
  return {
    client: fakeClient(() => modelReply(GOOD)),
    budget: new TokenBudget(100_000),
    limiter: new RateLimiter(10, 60_000),
    cache: new AnswerCache<AiAnswer>(),
    lookup: async () => lookupFixture(),
    outlook: async () => outlookFixture(),
    damage: async () => [],
    now: () => Date.parse("2026-10-08T19:00:00Z"),
  } as AiDeps & { client: ReturnType<typeof fakeClient> };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://memoria.test/api/brief", { method: "POST", headers: { "Content-Type": "application/json", host: "memoria.test", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => vi.restoreAllMocks());

describe("/api/brief and /api/ask", () => {
  it("brief: an address in, a verified brief out, no cache headers that would keep it", async () => {
    const d = deps();
    const response = await aiRoute(post({ address: "100 James Robertson Pkwy, Nashville, TN" }), "brief", d);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as AiAnswer;
    expect(body.state).toBe("ok");
    expect(body.sentences[0].cites).toEqual(["flood-outlook"]);
    expect(d.client.calls).toHaveLength(1);
  });

  it("ask: needs a question, and passes it to the model inside the data block", async () => {
    const d = deps();
    expect((await aiRoute(post({ address: "x" }), "ask", d)).status).toBe(400);
    const response = await aiRoute(post({ address: "100 James Robertson Pkwy, Nashville, TN", question: "Is Saturday risky?" }), "ask", d);
    expect(response.status).toBe(200);
    expect((d.client.calls[0] as { messages: Array<{ content: string }> }).messages[0].content).toContain("<question>Is Saturday risky?</question>");
  });

  it("rejects a question over 300 characters with a 400 and no model call", async () => {
    const d = deps();
    const response = await aiRoute(post({ address: "100 James Robertson Pkwy, Nashville, TN", question: "q".repeat(301) }), "ask", d);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ state: "bad_request" });
    expect(d.client.calls).toHaveLength(0);
  });

  it("is not a GET endpoint's job: bodies that are not JSON, not objects, or too large are refused", async () => {
    const d = deps();
    expect((await aiRoute(post("not json"), "brief", d)).status).toBe(400);
    expect((await aiRoute(post({ address: 5 }), "brief", d)).status).toBe(400);
    expect((await aiRoute(post({ address: "a".repeat(5000) }), "brief", d)).status).toBe(413);
  });

  it("answers 429 with Retry-After after 10 requests a minute from one IP", async () => {
    const d = deps();
    const send = () => aiRoute(post({ address: "100 James Robertson Pkwy, Nashville, TN" }, { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), "brief", d);
    for (let i = 0; i < 10; i += 1) expect((await send()).status).toBe(200);
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
  });

  it("answers 503 with the resting state when the budget is spent", async () => {
    const d = deps();
    d.budget = new TokenBudget(0);
    const response = await aiRoute(post({ address: "100 James Robertson Pkwy, Nashville, TN" }), "brief", d);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ state: "resting" });
  });

  it("refuses a browser request from another site", async () => {
    const d = deps();
    const response = await aiRoute(post({ address: "100 James Robertson Pkwy, Nashville, TN" }, { origin: "https://evil.example" }), "brief", d);
    expect(response.status).toBe(403);
    expect(d.client.calls).toHaveLength(0);
  });
});

describe("sameOrigin and clientIp", () => {
  it("allows no Origin (curl) and the site's own origin, and refuses others", () => {
    expect(sameOrigin(post({}))).toBe(true);
    expect(sameOrigin(post({}, { origin: "https://memoria.test" }))).toBe(true);
    expect(sameOrigin(post({}, { origin: "https://memoria.test.evil.example" }))).toBe(false);
    expect(sameOrigin(post({}, { origin: "not a url" }))).toBe(false);
  });

  it("takes the first forwarded address, then x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.7, 70.41.3.18" }))).toBe("198.51.100.7");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.8" }))).toBe("198.51.100.8");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("input that is not an address", () => {
  it.each(["brief", "ask"] as const)("%s: <img…> is a 400 with a friendly message, not a 502, and the model is never called", async (mode) => {
    const { LookupError, NOT_AN_ADDRESS } = await import("@/lib/sources");
    const d = deps();
    // The real lookup would throw this for markup; the route must pass its status through.
    d.lookup = async () => {
      throw new LookupError(400, NOT_AN_ADDRESS);
    };
    const response = await aiRoute(post({ address: "<img src=x onerror=alert(1)>", question: "Will it flood?" }), mode, d);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { state: string; message: string };
    expect(body).toMatchObject({ state: "bad_request", message: "That doesn't look like a street address. Type the house number, street, city and state, like 100 James Robertson Pkwy, Nashville, TN." });
    expect(d.client.calls).toHaveLength(0);
  });
});
