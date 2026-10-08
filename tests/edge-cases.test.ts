/**
 * Edge cases through the real /api/lookup route and the real shipped data files. Only the outside services
 * (Census, FEMA, NWS, Open-Meteo) are faked, by URL, so nothing touches the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/lookup/route";
import { clearDataCaches } from "@/lib/index-store";
import { clearHeatCache } from "@/lib/sources";
import type { LookupErrorBody, LookupPayload } from "@/lib/types";
import { FEMA_ZONE_X, NO_ALERTS, heatYear, openMeteoReply } from "./helpers";

interface Place {
  matched: string;
  lat: number;
  lon: number;
  state: string;
  city: string;
  county: string;
}

const NASHVILLE: Place = { matched: "100 JAMES ROBERTSON PKWY, NASHVILLE, TN, 37201", lat: 36.168175, lon: -86.777516, state: "TN", city: "NASHVILLE", county: "Davidson County" };
const WHITE_HOUSE: Place = { matched: "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500", lat: 38.8977, lon: -77.0365, state: "DC", city: "WASHINGTON", county: "District of Columbia" };
const DENVER: Place = { matched: "200 E COLFAX AVE, DENVER, CO, 80203", lat: 39.7403, lon: -104.9858, state: "CO", city: "DENVER", county: "Denver County" };
const SPRINGERVILLE: Place = { matched: "101 W MAIN ST, SPRINGERVILLE, AZ, 85938", lat: 34.1342, lon: -109.2869, state: "AZ", city: "SPRINGERVILLE", county: "Apache County" };

const census = (place: Place | null) => ({
  result: {
    addressMatches: place
      ? [
          {
            matchedAddress: place.matched,
            coordinates: { x: place.lon, y: place.lat },
            addressComponents: { state: place.state, city: place.city },
            geographies: { Counties: [{ NAME: place.county }] },
          },
        ]
      : [],
  },
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const hang = () => new Promise<Response>(() => undefined);

type Handler = (url: string) => Response | Promise<Response>;
function stubServices(handlers: { census: Handler; fema?: Handler; nws?: Handler; meteo?: Handler }) {
  const fema = handlers.fema ?? (() => json(FEMA_ZONE_X));
  const nws = handlers.nws ?? (() => json(NO_ALERTS));
  const meteo = handlers.meteo ?? (() => json(openMeteoReply(heatYear(2024, { "2024-07-10": 108 }))));
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    if (url.includes("geocoding.geo.census.gov")) return handlers.census(url);
    if (url.includes("hazards.fema.gov")) return fema(url);
    if (url.includes("api.weather.gov")) return nws(url);
    if (url.includes("archive-api.open-meteo.com")) return meteo(url);
    throw new Error(`unrouted URL in test: ${url}`);
  });
}

/**
 * Runs the fake clock until a lookup is done. The flood trigger starts only after the state index is read from disk (real I/O),
 * so its 8 s timers are created after the first jump; keep jumping, with a real pause in between, until the lookup settles.
 */
async function runClockUntilDone(pending: Promise<unknown>): Promise<void> {
  let done = false;
  void pending.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 400 && !done; i += 1) {
    await vi.advanceTimersByTimeAsync(8_100);
    await new Promise<void>((resolve) => realSetTimeout(resolve, 5)); // a real pause, so the disk read can finish
  }
}
const realSetTimeout = setTimeout; // captured before any test installs fake timers

const lookup = async (address: string) => GET(new Request(`http://localhost/api/lookup?address=${encodeURIComponent(address)}`));

beforeEach(() => {
  clearDataCaches();
  clearHeatCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("an address in a state we have not indexed", () => {
  it.each([
    ["1600 Pennsylvania Ave NW, Washington, DC", WHITE_HOUSE],
    ["200 E Colfax Ave, Denver, CO", DENVER],
  ])("%s: 200, honest 'not yet indexed', nothing invented, live sources still work", async (address, place) => {
    stubServices({ census: () => json(census(place)) });
    const response = await lookup(address);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as LookupPayload;

    expect(payload.coverage).toBe("not yet indexed");
    expect(payload.floods).toEqual({ reports: [], tierCounts: { mentioned: 0, about1km: 0, citywide: 0 } });
    expect(payload.stormReplay).toBeNull();
    expect(payload.tornadoes).toEqual([]);
    expect(payload.notices.index).toContain(`We have not indexed ${place.state} yet`);
    expect(payload.fema).toMatchObject({ zone: "X" }); // still real
    expect(payload.live?.alerts).toEqual([]);
    expect(payload.heat?.hottest.feelsF).toBe(108);
    expect(payload.heat?.regionalSlug).toBeNull(); // no grid for these cities
  });
});

describe("a nonsense address", () => {
  it("404 with the Census's plain message, and no payload", async () => {
    stubServices({ census: () => json(census(null)) });
    const response = await lookup("asdf qwer 12345 zzzz");
    expect(response.status).toBe(404);
    const body = (await response.json()) as LookupErrorBody;
    expect(body.error).toMatch(/could not match that to a street address/);
    expect(body.error).toMatch(/house number, street, city and state/);
  });

  it("400 for an empty or very long address, before any service is called", async () => {
    stubServices({ census: () => { throw new Error("must not be called"); } });
    expect((await lookup("")).status).toBe(400);
    expect((await lookup("x".repeat(500))).status).toBe(400);
  });

  it("does not echo markup back as HTML", async () => {
    stubServices({ census: () => json(census(null)) });
    const response = await lookup("<script>alert(1)</script>");
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(JSON.stringify(await response.json())).not.toContain("<script>");
  });
});

describe("an indexed address with no floods within 5 km (101 W Main St, Springerville, AZ)", () => {
  it("returns an indexed payload with zero nearby reports; the one report within 15 km still defines the night", async () => {
    stubServices({ census: () => json(census(SPRINGERVILLE)) });
    const payload = (await (await lookup("101 W Main St, Springerville, AZ")).json()) as LookupPayload;

    expect(payload.coverage).toBe("indexed");
    expect(payload.notices.index).toBeUndefined();
    expect(payload.floods.reports).toEqual([]);
    expect(payload.floods.tierCounts).toEqual({ mentioned: 0, about1km: 0, citywide: 0 });
    expect(payload.stormReplay?.reportIds).toHaveLength(1);
    expect(payload.stormReplay?.reports.length).toBeGreaterThanOrEqual(1);
  });
});

describe("an API timeout", () => {
  beforeEach(() => vi.useFakeTimers());

  it("the address service hangs: 502 after 8 seconds with a message we can show", async () => {
    stubServices({ census: hang });
    const pending = lookup("100 James Robertson Pkwy, Nashville, TN");
    await vi.advanceTimersByTimeAsync(8_100);
    const response = await pending;
    expect(response.status).toBe(502);
    expect(((await response.json()) as LookupErrorBody).error).toMatch(/did not answer within 8 seconds/);
  });

  it("FEMA, NWS and Open-Meteo all hang: still a 200 with the real flood and tornado data, and a notice for each", async () => {
    stubServices({ census: () => json(census(NASHVILLE)), fema: hang, nws: hang, meteo: hang });
    const pending = lookup("100 James Robertson Pkwy, Nashville, TN");
    await runClockUntilDone(pending);
    const response = await pending;
    expect(response.status).toBe(200);
    const payload = (await response.json()) as LookupPayload;

    expect(payload.fema).toBeNull();
    expect(payload.live).toBeNull();
    expect(payload.heat).toBeNull();
    expect(payload.notices.fema).toMatch(/8 seconds/);
    expect(payload.notices.live).toMatch(/8 seconds/);
    expect(payload.notices.heat).toMatch(/8 seconds/);
    expect(payload.coverage).toBe("indexed");
    // 42 within 5 km now that the detective has re-filed two city-point reports out of the circle (44 before it ran).
    expect(payload.floods.reports).toHaveLength(42);
    expect(payload.stormReplay?.date).toBe("2021-03-27");
    expect(payload.tornadoes.length).toBeGreaterThan(0);
  });

  it("only Open-Meteo hangs: the heat tab says so, the rest is untouched", async () => {
    stubServices({ census: () => json(census(NASHVILLE)), meteo: hang });
    const pending = lookup("100 James Robertson Pkwy, Nashville, TN");
    await runClockUntilDone(pending);
    const payload = (await (await pending).json()) as LookupPayload;
    expect(payload.heat).toBeNull();
    expect(payload.notices.heat).toMatch(/Open-Meteo/);
    expect(payload.fema).not.toBeNull();
    expect(payload.notices.fema).toBeUndefined();
  });
});

describe("regional heat for the shipped cities (real grids, a faked Open-Meteo)", () => {
  it("links the Nashville grid only when the address's worst week is the grid's week", async () => {
    // 2012-06-29 is the hottest day, so the week centred on it is Jun 26 to Jul 2, the grid's week.
    stubServices({ census: () => json(census(NASHVILLE)), meteo: () => json(openMeteoReply(heatYear(2012, { "2012-06-29": 113 }))) });
    const hit = (await (await lookup("100 James Robertson Pkwy, Nashville, TN")).json()) as LookupPayload;
    expect(hit.heat?.worstWeek).toMatchObject({ start: "2012-06-26", end: "2012-07-02" });
    expect(hit.heat?.regionalSlug).toBe("nashville");

    clearHeatCache();
    stubServices({ census: () => json(census(NASHVILLE)), meteo: () => json(openMeteoReply(heatYear(2024, { "2024-07-10": 108 }))) });
    const miss = (await (await lookup("100 James Robertson Pkwy, Nashville, TN")).json()) as LookupPayload;
    expect(miss.heat?.regionalSlug).toBeNull();
  });
});

describe("the list of indexed states shown to people", () => {
  it("names exactly the states that have a file in data/index", async () => {
    const { readdirSync } = await import("node:fs");
    const { INDEXED_STATE_NAMES } = await import("@/lib/constants");
    const files = readdirSync("data/index").filter((f) => f.endsWith(".json.gz"));
    expect(files).toHaveLength(INDEXED_STATE_NAMES.length);
    expect(files.map((f) => f.slice(0, 2)).sort()).toEqual(["AZ", "GA", "MO", "NC", "TN", "TX", "WA"]);
    expect([...INDEXED_STATE_NAMES].sort()).toEqual(["Arizona", "Georgia", "Missouri", "North Carolina", "Tennessee", "Texas", "Washington"]);
  });
});

describe("failure notices read as sentences", () => {
  it("does not capitalise 'The' in the middle of a sentence", async () => {
    stubServices({ census: () => Promise.reject(new TypeError("offline")) });
    const response = await lookup("100 James Robertson Pkwy, Nashville, TN");
    expect(response.status).toBe(502);
    expect(((await response.json()) as LookupErrorBody).error).toBe("We could not reach the US Census address service. Please try again in a moment.");
  });
});
