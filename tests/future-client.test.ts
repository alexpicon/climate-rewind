import { describe, expect, it } from "vitest";
import { GENERIC_MESSAGE, NETWORK_MESSAGE, requestExplanation, requestFuture, TIMEOUT_MESSAGE } from "@/lib/climate/client";
import { requestReady, readyUrl } from "@/lib/ready/client";

const json = (body: unknown, status = 200) => async () => Response.json(body, { status });
/** A request that never answers, and rejects when it is aborted (as a real fetch does). */
const never = (_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("abort"))));

describe("the browser calls for the future numbers", () => {
  it("returns the payload, and a plain message for a server error, a network failure and a timeout", async () => {
    const payload = { slug: null, lat: 1, lon: 2, built: "x", observed: null, projected: null, notices: {} };
    expect(await requestFuture(1, 2, json(payload))).toEqual({ ok: true, payload });
    expect(await requestFuture(1, 2, json({ error: "Bad point." }, 400))).toEqual({ ok: false, message: "Bad point." });
    expect(await requestFuture(1, 2, json({}, 500))).toEqual({ ok: false, message: GENERIC_MESSAGE });
    expect(await requestFuture(1, 2, async () => Promise.reject(new Error("offline")))).toEqual({ ok: false, message: NETWORK_MESSAGE });
    expect(await requestFuture(1, 2, never, 20)).toEqual({ ok: false, message: TIMEOUT_MESSAGE });
  });

  it("the explanation call hands back the answer, or the AI's own honest state (resting, unavailable, rate limited)", async () => {
    const answer = { state: "ok", sentences: [], sources: {}, dropped: 0, message: null, generatedAt: "x", model: "m", cached: false };
    expect(await requestExplanation(1, 2, json({ slug: null, lat: 1, lon: 2, built: "x", observed: null, projected: null, notices: {}, explanation: answer }))).toEqual({ ok: true, answer });
    expect(await requestExplanation(1, 2, json({ state: "resting", message: "Used up." }, 503))).toEqual({ ok: false, state: "resting", message: "Used up." });
    expect(await requestExplanation(1, 2, json({ state: "rate_limited", message: "Wait.", retryAfter: 9 }, 429))).toEqual({ ok: false, state: "rate_limited", message: "Wait.", retryAfter: 9 });
    expect(await requestExplanation(1, 2, never, 10)).toMatchObject({ ok: false, state: "error", message: TIMEOUT_MESSAGE });
  });

  it("asks for the explanation only when told to", async () => {
    const urls: string[] = [];
    const spy = async (url: string) => {
      urls.push(url);
      return Response.json({});
    };
    await requestFuture(47.6, -122.2, spy);
    await requestExplanation(47.6, -122.2, spy);
    expect(urls).toEqual(["/api/future?lat=47.6&lon=-122.2", "/api/future?lat=47.6&lon=-122.2&explain=1"]);
  });
});

describe("the browser call for the plan", () => {
  it("passes the point and state, and maps failures to plain messages", async () => {
    expect(readyUrl(36.1, -86.7, "TN")).toBe("/api/ready?lat=36.1&lon=-86.7&state=TN");
    const payload = { state: "ok", items: [], hazards: [], dropped: 0, notices: [], generatedAt: "x", model: "m", cached: false };
    expect(await requestReady(36.1, -86.7, "TN", json(payload))).toEqual({ ok: true, payload });
    expect(await requestReady(36.1, -86.7, "TN", json({ state: "rate_limited", message: "Too many." }, 429))).toEqual({ ok: false, message: "Too many." });
    expect(await requestReady(36.1, -86.7, "TN", async () => Promise.reject(new Error("offline")))).toEqual({ ok: false, message: NETWORK_MESSAGE });
    expect(await requestReady(36.1, -86.7, "TN", never, 10)).toEqual({ ok: false, message: TIMEOUT_MESSAGE });
  });
});
