import { beforeEach, describe, expect, it } from "vitest";
import { applyPart, emptyPayload, lookupAddress, lookupGeocode, lookupPart, type LookupDeps } from "@/lib/lookup";
import { addressFromQuery, addressToQuery, isLookupPart } from "@/lib/lookup-query";
import { clearHeatCache } from "@/lib/sources";
import { LOOKUP_PARTS, type LookupPart, type LookupPayload, type StateIndex } from "@/lib/types";
import { requestStagedLookup } from "@/lib/ui/lookup-client";
import { CENSUS_NASHVILLE, FEMA_ZONE_X, NO_ALERTS, fakeFetch, flood, heatYear, httpError, ok, openMeteoReply, tornado } from "./helpers";

const index: StateIndex = {
  state: "TN",
  built: "2026-10-07T00:00:00Z",
  sources: [],
  floods: [flood({ id: "f1", filed: [36.17, -86.78], coordPrecision: "placeholder" }), flood({ id: "f2", filed: [36.171, -86.779], coordPrecision: "precise", start: "2021-03-27T23:10:00-05:00" })],
  tornadoes: [tornado({ id: "t1", begin: [36.17, -86.9], end: [36.17, -86.7] })],
};

const routes = {
  census: () => ok(CENSUS_NASHVILLE),
  fema: () => ok(FEMA_ZONE_X),
  nws: () => ok(NO_ALERTS),
  meteo: () => ok(openMeteoReply(heatYear(2024, { "2024-07-10": 108 }))),
};
const deps = (over: Partial<Parameters<typeof fakeFetch>[0]> = {}): LookupDeps => ({
  fetch: fakeFetch({ ...routes, ...over }),
  loadIndex: async () => index,
  loadHeatGrid: async () => null,
  now: () => new Date("2026-10-07T20:00:00Z"),
});

const INPUT = "100 James Robertson Pkwy, Nashville, TN";

describe("the lookup in pieces", () => {
  beforeEach(() => clearHeatCache());

  it("the pieces put together equal the whole lookup (so the quick first view never shows different facts)", async () => {
    const d = deps();
    const whole = await lookupAddress(INPUT, d);
    const address = await lookupGeocode(INPUT, d);
    let payload = emptyPayload(address, [...LOOKUP_PARTS]);
    for (const part of LOOKUP_PARTS) payload = applyPart(payload, part, await lookupPart(part, address, d));
    expect(payload.pending).toEqual([]);
    const rest: Record<string, unknown> = { ...payload };
    delete rest.pending;
    for (const key of Object.keys(whole) as Array<keyof LookupPayload>) expect(rest[key], key).toEqual(whole[key]);
  });

  it("a part that fails is a notice, not an error, and the other parts are unaffected", async () => {
    const d = deps({ fema: () => httpError(500) });
    const address = await lookupGeocode(INPUT, d);
    const fema = await lookupPart("fema", address, d);
    expect(fema.fema).toBeNull();
    expect(fema.notices?.fema).toMatch(/FEMA/);
    expect((await lookupPart("records", address, d)).floods?.reports).toHaveLength(2);
  });

  it("applyPart folds a piece in, merges notices and takes the part off the pending list", () => {
    const address = { input: "x", matched: "X", lat: 36.1, lon: -86.7, state: "TN", county: null, city: null };
    let p = emptyPayload(address, ["live", "fema"]);
    p = applyPart(p, "live", { live: { checkedAt: "t", alerts: [] }, notices: { live: "slow" } });
    p = applyPart(p, "fema", { notices: { fema: "none" } });
    expect(p.pending).toEqual([]);
    expect(p.live?.alerts).toEqual([]);
    expect(p.notices).toEqual({ live: "slow", fema: "none" });
  });

  it("the address travels in the query and is checked on the way back", () => {
    const address = { input: "100 James Robertson Pkwy, Nashville, TN", matched: "100 JAMES ROBERTSON PKWY, NASHVILLE, TN, 37201", lat: 36.168175, lon: -86.777516, state: "TN", county: "Davidson", city: "NASHVILLE", countyFips: "037" };
    expect(addressFromQuery(addressToQuery(address))).toEqual(address);
    const bad = (patch: Record<string, string>) => {
      const q = addressToQuery(address);
      for (const [k, v] of Object.entries(patch)) q.set(k, v);
      return addressFromQuery(q);
    };
    expect(bad({ lat: "99" })).toBeNull();
    expect(bad({ lon: "10" })).toBeNull();
    expect(bad({ state: "Tennessee" })).toBeNull();
    expect(bad({ lat: "nope" })).toBeNull();
    expect(bad({ matched: "" })).toBeNull();
    expect(bad({ fips: "12" })?.countyFips).toBeNull();
    expect(isLookupPart("heat")).toBe(true);
    expect(isLookupPart("geocode")).toBe(false);
    expect(isLookupPart("../etc")).toBe(false);
  });
});

describe("requestStagedLookup", () => {
  const address = { input: INPUT, matched: "100 JAMES ROBERTSON PKWY, NASHVILLE, TN, 37201", lat: 36.168175, lon: -86.777516, state: "TN", county: "Davidson", city: "NASHVILLE", countyFips: "037" };
  const respond = (url: string, slow: Partial<Record<LookupPart, Promise<unknown>>> = {}, fail: LookupPart[] = []) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.startsWith("/api/lookup/geocode")) return Promise.resolve(json({ address }));
    const part = url.split("?")[0].split("/").pop() as LookupPart;
    if (fail.includes(part)) return Promise.resolve(json({ error: "no" }, 500));
    const patch = part === "records" ? { floods: { reports: [], tierCounts: { mentioned: 0, about1km: 0, citywide: 0 } }, coverage: "indexed" } : part === "area" ? { areaEvents: null } : part === "live" ? { live: { checkedAt: "t", alerts: [] } } : {};
    return (slow[part] ?? Promise.resolve()).then(() => json({ patch }));
  };

  it("draws the first view when the records and the area are in, then hands over the slow parts as they come", async () => {
    const events: string[] = [];
    let releaseHeat!: () => void;
    const heatGate = new Promise<void>((resolve) => (releaseHeat = resolve));
    const done = new Promise<void>((resolve) => {
      void requestStagedLookup(
        INPUT,
        null,
        {
          onAddress: () => events.push("address"),
          onStep: (part) => events.push(`step ${part}`),
          onCore: (payload) => {
            events.push(`core pending=${payload.pending?.join(",")}`);
            releaseHeat();
          },
          onPart: (part) => {
            events.push(`part ${part}`);
            if (part === "heat") resolve();
          },
          onFail: (m) => events.push(`fail ${m}`),
        },
        (url) => respond(url, { heat: heatGate }),
      );
    });
    await done;
    expect(events[0]).toBe("address");
    const core = events.findIndex((e) => e.startsWith("core"));
    expect(events.slice(0, core)).toEqual(expect.arrayContaining(["address", "step records", "step area"]));
    expect(events[core]).toBe("core pending=live,fema,heat,trigger");
    // heat was held until the first view was drawn, and arrives after it
    expect(events.indexOf("part heat")).toBeGreaterThan(core);
    expect(events.filter((e) => e.startsWith("part")).sort()).toEqual(["part fema", "part heat", "part live", "part trigger"]);
  });

  it("a failed slow part becomes a notice and never fails the lookup; a failed address match does", async () => {
    const parts: Array<[LookupPart, unknown]> = [];
    await requestStagedLookup(INPUT, null, { onCore: () => undefined, onPart: (p, patch) => parts.push([p, patch]), onFail: () => parts.push(["records", "FAILED"]) }, (url) => respond(url, {}, ["fema", "trigger"]));
    const fema = parts.find(([p]) => p === "fema")![1] as { notices: { fema: string } };
    expect(fema.notices.fema).toMatch(/FEMA/);
    const trigger = parts.find(([p]) => p === "trigger")![1] as { floodTrigger: { status: string } };
    expect(trigger.floodTrigger.status).toBe("unavailable");
    expect(parts.some(([, v]) => v === "FAILED")).toBe(false);

    const failures: string[] = [];
    await requestStagedLookup("nowhere", null, { onCore: () => failures.push("core"), onPart: () => undefined, onFail: (m) => failures.push(m) }, async () => new Response(JSON.stringify({ error: "The Census could not match that." }), { status: 404 }));
    expect(failures).toEqual(["The Census could not match that."]);
  });

  it("stops reporting once the visitor asked for something else", async () => {
    let current = true;
    const seen: string[] = [];
    await requestStagedLookup(INPUT, null, { isCurrent: () => current, onAddress: () => { seen.push("address"); current = false; }, onCore: () => seen.push("core"), onPart: () => seen.push("part"), onFail: () => seen.push("fail") }, (url) => respond(url));
    expect(seen).toEqual(["address"]);
  });
});
