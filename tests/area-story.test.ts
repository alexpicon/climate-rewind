import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { clearEventsCache, countyCodeOf, lookupAreaEvents, normalizeEvent, rankBySeverity, selectAreaEvents, severityScore, sinceYear, summarizeAreaEvents, topDistinctEpisodes } from "@/lib/area-events";
import { clearZoneCache, areaIdFromUrl } from "@/lib/nws-zones";
import { clearExtremesCache } from "@/lib/extremes";
import { findNearestFlood, lookupAddress } from "@/lib/lookup";
import { placeInQuiet, type QuietFile } from "@/lib/quiet";
import { assembleStory, buildImpactLines, handleStory, totalsLine, verifyImpacts } from "@/lib/ai/story";
import { countsSource, eventSource, storyEvents } from "@/lib/ai/event-sources";
import { AnswerCache, RateLimiter, TokenBudget } from "@/lib/ai/guard";
import { buildUserMessage } from "@/lib/ai/prompt";
import { buildSources } from "@/lib/ai/sources";
import type { AiDeps } from "@/lib/ai/service";
import type { StoryAnswer } from "@/lib/ai/types";
import { axisTicks, extremeItems, familyOf, nearestFloodLine, quietLine, timelineDots } from "@/lib/ui/story-model";
import { VISIBLE_TABS } from "@/lib/ui/tabs";
import type { AreaEvent, FloodRow } from "@/lib/types";
import { fakeClient, lookupFixture, modelReply, outlookFixture } from "./ai-fixtures";
import { CENSUS_NASHVILLE, FEMA_ZONE_X, NASHVILLE, NO_ALERTS, fakeFetch, flood, heatYear, ok, openMeteoReply } from "./helpers";

// ---------------------------------------------------------------- a fixture in the data/events layout

const WINDSTORM = "Strong winds knocked down trees and power lines across the area. More than 300,000 customers lost power. Several roads were closed by fallen trees.";
const row = (id: string, over: Record<string, unknown> = {}, code = "WAZ508", kind: "Z" | "C" = "Z") => ({
  id,
  episodeId: `E-${id}`,
  type: "High Wind",
  start: "2006-12-14T16:00:00-08:00",
  end: "2006-12-15T04:00:00-08:00",
  area: { kind, code, name: code === "WAC033" ? "KING" : "SEATTLE AND VICINITY" },
  deaths: 0,
  injuries: 0,
  damageUsd: 0,
  magnitude: null,
  magnitudeType: null,
  narrative: "",
  ...over,
});

/** A square zone centred on (lat, lon), `half` degrees to a side, as zones.json stores it. */
export const zone = (name: string, lat: number, lon: number, half: number, extra: Record<string, unknown> = {}) => ({
  name,
  validFrom: "2006-11-27",
  validTo: "2025-02-25",
  bbox: [lon - half, lat - half, lon + half, lat + half],
  polygon: { type: "MultiPolygon", coordinates: [[[[lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half]]]] },
  ...extra,
});

function fixtureDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "events-"));
  mkdirSync(path.join(dir, "WA"));
  const write = (name: string, body: unknown) => writeFileSync(path.join(dir, "WA", name), name.endsWith(".gz") ? gzipSync(JSON.stringify(body)) : JSON.stringify(body));
  // WAZ556 has an outline over the point but no file (a zone with no rows): it must not break anything. WAZ568 is a mountain zone far
  // away whose file holds a climber event: it must never be read for this address. (zones.json replaces county-areas.json.)
  write("zones.json", {
    WAZ508: zone("Seattle/Bremerton Area", 47.6, -122.2, 0.3),
    WAZ556: zone("Bellevue and Vicinity", 47.6, -122.2, 0.1),
    WAZ568: zone("Cascades of Pierce and Eastern King Counties", 46.9, -121.7, 0.3),
  });
  write("WAZ568.json.gz", { events: [row("SE-RAINIER", { type: "Heavy Snow", deaths: 3, start: "2014-06-21T10:00:00-07:00", narrative: "Climbers died on Mount Rainier." }, "WAZ568")] });
  write("WAC033.json.gz", {
    events: [row("SE-2", { type: "Flash Flood", start: "2009-01-07T08:00:00-08:00", damageUsd: 14_000_000, narrative: "The cities flooded." }, "WAC033", "C"), row("SE-OLD", { start: "1999-12-31T23:00:00-08:00", narrative: "before 2000" }, "WAC033", "C")],
  });
  write("WAZ508.json.gz", {
    events: [
      row("SE-1", { episodeId: "E-1", deaths: 2, injuries: 3, damageUsd: 80_000_000, magnitude: 69, narrative: WINDSTORM }),
      // the same storm, filed again under another id in the same episode
      row("SE-1b", { episodeId: "E-1", narrative: WINDSTORM }),
      // no narrative of its own: the episode's comes from the shared map
      row("SE-3", { episodeId: "E-3", type: "Heavy Snow", start: "2012-01-18T10:00:00-08:00" }),
      { not: "an event" },
    ],
    episodes: { "E-3": "A winter storm brought heavy snow." },
  });
  return dir;
}

beforeEach(() => {
  clearEventsCache();
  clearZoneCache();
  clearExtremesCache();
});

describe("area events: selecting by the address's county and zone outlines", () => {
  it("reads the county and the zones around the point, and tolerates a zone that has no file", async () => {
    const found = await selectAreaEvents(47.6, -122.2, "WA", "WAC033", fixtureDir());
    expect(found?.areaCodes).toEqual(["WAC033", "WAZ508", "WAZ556"]); // both are "your zone" (ties by code); the mountain zone is not here
    expect(found?.events.map((e) => e.id).sort()).toEqual(["SE-1", "SE-1b", "SE-2", "SE-3", "SE-OLD"]);
    // the episode narrative comes from the episodes map, rows without an id/start/area are skipped
    expect(found?.events.find((e) => e.id === "SE-3")?.episodeNarrative).toBe("A winter storm brought heavy snow.");
  });

  it("returns null for a state with no events data, and ignores a county that is not in the map", async () => {
    const dir = fixtureDir();
    expect(await selectAreaEvents(47.6, -122.2, "OR", "ORC051", dir)).toBeNull();
    expect((await selectAreaEvents(47.6, -122.2, "WA", "WAC999", dir))?.events.map((e) => e.id).sort()).toEqual(["SE-1", "SE-1b", "SE-3"]); // a county with no file: the zones still answer
    expect(await selectAreaEvents(47.6, -122.2, "../x", "WAC033", dir)).toBeNull(); // odd input never reaches a path
  });

  it("builds the county code from the Census FIPS, with /points as the fallback and a plain notice when neither answers", async () => {
    expect(countyCodeOf({ state: "WA", countyFips: "033" })).toBe("WAC033");
    expect(countyCodeOf({ state: "WA", countyFips: null })).toBeNull();
    const dir = fixtureDir();
    const deps = { fetch: fakeFetch({ nws: () => ok({ properties: { forecastZone: "https://api.weather.gov/zones/forecast/WAZ558", county: "https://api.weather.gov/zones/county/WAC033" } }) }), loadEvents: (la: number, lo: number, s: string, c: string) => selectAreaEvents(la, lo, s, c, dir) };
    const viaCensus = await lookupAreaEvents({ lat: 47.6, lon: -122.2, state: "WA", countyFips: "033" }, deps);
    const viaPoints = await lookupAreaEvents({ lat: 47.6, lon: -122.2, state: "WA", countyFips: null }, deps);
    expect(viaPoints.value?.county).toBe("WAC033");
    expect(viaCensus.value).toEqual(viaPoints.value);
    const nothing = await lookupAreaEvents({ lat: 1, lon: 2, state: "WA", countyFips: null }, { ...deps, fetch: fakeFetch({ nws: () => ok({ properties: {} }) }) });
    expect(nothing.value).toBeNull();
    expect(nothing.notice).toMatch(/which county/);
    const noState = await lookupAreaEvents({ lat: 1, lon: 2, state: "OR", countyFips: "051" }, deps);
    expect(noState.notice).toMatch(/do not have area events for OR/);
  });

  it("counts since 2000 by type and by year, and ranks the most severe first", async () => {
    const dir = fixtureDir();
    const { value } = await lookupAreaEvents({ lat: 47.6, lon: -122.2, state: "WA", countyFips: "033" }, { fetch: fakeFetch({}), loadEvents: (la: number, lo: number, s: string, c: string) => selectAreaEvents(la, lo, s, c, dir) });
    expect(value?.total).toBe(4); // the 1999 row is out
    expect(value?.counts).toEqual({ "High Wind": 2, "Flash Flood": 1, "Heavy Snow": 1 });
    expect(value?.byYear).toEqual({ "2006": 2, "2009": 1, "2012": 1 });
    expect(value?.countyName).toBe("KING");
    expect(value?.top.map((e) => e.id)).toEqual(["SE-1", "SE-2", "SE-3", "SE-1b"]);
  });

  it("area ids come out of NWS urls", () => {
    expect(areaIdFromUrl("https://api.weather.gov/zones/forecast/WAZ558")).toBe("WAZ558");
    expect(areaIdFromUrl("https://api.weather.gov/zones/county/WAC033/")).toBe("WAC033");
    expect(areaIdFromUrl("nope")).toBeNull();
  });
});

describe("severity ranking", () => {
  const e = (id: string, over: Partial<AreaEvent>): AreaEvent => normalizeEvent(row(id, over as Record<string, unknown>), {}) as AreaEvent;

  it("a death outweighs an injury, an injury a damage tier, and a narrative breaks a tie", () => {
    const events = [
      e("damage", { damageUsd: 10_000_000, narrative: "x" }),
      e("injury", { injuries: 4 }),
      e("death", { deaths: 1 }),
      e("quiet-with-words", { narrative: "Wind." }),
      e("quiet", {}),
    ];
    expect(rankBySeverity(events).map((x) => x.id)).toEqual(["death", "injury", "damage", "quiet-with-words", "quiet"]);
    expect(severityScore(e("m", { magnitude: 99 }))).toBeGreaterThan(severityScore(e("n", {})));
  });

  it("ties go to the newer event and the order never changes between runs", () => {
    const a = e("a", { start: "2001-01-01T00:00:00-08:00" });
    const b = e("b", { start: "2020-01-01T00:00:00-08:00" });
    expect(rankBySeverity([a, b]).map((x) => x.id)).toEqual(["b", "a"]);
    expect(rankBySeverity([b, a]).map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("the story takes one event per episode, oldest first", async () => {
    const dir = fixtureDir();
    const found = await selectAreaEvents(47.6, -122.2, "WA", "WAC033", dir);
    const summary = summarizeAreaEvents(sinceYear(found!.events), "WAC033", found!.areaCodes, "x");
    expect(storyEvents(summary).map((x) => x.id)).toEqual(["SE-1", "SE-2", "SE-3"]);
    expect(topDistinctEpisodes(summary.top, 2).map((x) => x.id)).toEqual(["SE-1", "SE-2"]);
  });
});

// ---------------------------------------------------------------- the widening flood search and the percentile

describe("the nearest flood report (nothing within 5 km)", () => {
  const at = (id: string, lat: number, over: Partial<FloodRow> = {}) => flood({ id, filed: [lat, -86.777516], start: "2019-05-04T03:10:00-05:00", ...over });
  const origin: [number, number] = [36.168175, -86.777516];
  // 0.1 degree of latitude is about 11.1 km

  it("finds the closest placeable report out to 50 km and says how far", () => {
    const near = findNearestFlood([at("far", 36.168175 + 0.4), at("mid", 36.168175 + 0.12), at("none-close", 36.168175 + 0.3)], origin);
    expect(near?.id).toBe("mid");
    expect(near?.distanceKm).toBeGreaterThan(12);
    expect(near?.distanceKm).toBeLessThan(14);
    expect(nearestFloodLine(near)).toBe("None on your street. The closest was 13 km away, in 2019.");
  });

  it("never offers a city-placeholder report, a duplicate or anything past 50 km", () => {
    expect(findNearestFlood([at("city", 36.2, { coordPrecision: "placeholder" })], origin)).toBeNull();
    expect(findNearestFlood([at("dup", 36.2, { dupOf: "x" })], origin)).toBeNull();
    expect(findNearestFlood([at("away", 36.168175 + 0.6)], origin)).toBeNull();
    expect(nearestFloodLine(null)).toBeNull();
  });
});

describe("the quiet percentile", () => {
  const file: QuietFile = {
    built: "x",
    method: "m",
    radiusKm: 5,
    states: { AA: { points: 100, hist: { "0": 60, "1": 20, "3": 15, "10": 5 } }, BB: { points: 100, hist: { "0": 80, "2": 20 } } },
  };

  it("pools the states and never overstates: strictly-more is rounded down, ties are separate", () => {
    expect(placeInQuiet(file, "AA", 0)).toMatchObject({ quieterThanPct: 30, samePct: 70, nonePct: 70, sample: 200, states: 2 });
    expect(placeInQuiet(file, "AA", 2)).toMatchObject({ quieterThanPct: 10, samePct: 10 });
    expect(placeInQuiet(file, "AA", 50)).toMatchObject({ quieterThanPct: 0, samePct: 0 });
  });

  it("says nothing without a real sample", () => {
    expect(placeInQuiet(null, "AA", 0)).toBeNull();
    expect(placeInQuiet({ ...file, states: { AA: { points: 10, hist: { "0": 10 } } } }, "AA", 0)).toBeNull();
  });

  it("is phrased positively only when it is true", () => {
    const base = { state: "WA", states: 7, sample: 3500, nonePct: 64, samePct: 0 };
    expect(quietLine({ ...base, count: 0, quieterThanPct: 36, samePct: 64 })).toBe("No flood report within 5 km, like 64% of the 3,500 places we sampled across 7 states.");
    expect(quietLine({ ...base, count: 1, quieterThanPct: 72, samePct: 10 })).toBe("Quieter than 72% of the 3,500 places we sampled across 7 states.");
    // 2 reports where most sampled places have none: honest, not "quiet"
    expect(quietLine({ ...base, count: 2, quieterThanPct: 15, samePct: 6 })).toMatch(/^64% of the 3,500 places .* have no flood report within 5 km, so reports are sparse/);
    expect(quietLine(null)).toBeNull();
  });
});

// ---------------------------------------------------------------- the AI story and its verifier

const E1: AreaEvent = normalizeEvent(row("SE-1", { deaths: 2, injuries: 3, damageUsd: 80_000_000, magnitude: 69, narrative: WINDSTORM }), {}) as AreaEvent;
const E2: AreaEvent = normalizeEvent(row("SE-2", { type: "Flash Flood", start: "2009-01-07T08:00:00-08:00", damageUsd: 14_000_000, narrative: "The cities flooded and some residents had to be rescued." }, "WAC033", "C"), {}) as AreaEvent;
const events = [E1, E2];
const summary = summarizeAreaEvents(events, "WAC033", ["WAC033", "WAZ508"], "NCEI");
const sources = new Map([countsSource(summary), ...events.map(eventSource)].map((s) => [s.id, s]));

describe("story sentences: the existing verifier on event ids", () => {
  const story = (sentences: unknown[], impacts: unknown[] = []) => assembleStory(summary, events, sources, { sentences, impacts }, { now: () => 0 });

  it("keeps a cited sentence whose numbers and quote are in the event, and drops a made-up event id", () => {
    const result = story([
      { text: "The National Weather Service recorded 2 deaths in the high wind event of December 2006.", cites: ["SE-1"] },
      { text: "A storm in March 2010 was the worst on record here.", cites: ["SE-99999"] },
    ]);
    expect(result.state).toBe("ok");
    expect(result.sentences.map((s) => s.cites)).toEqual([["SE-1"]]);
    expect(result.dropped).toBe(1);
    expect(Object.keys(result.sources)).toEqual(["SE-1"]);
  });

  it("drops a sentence with a number no cited event holds, an altered quote, a prediction and a missing citation", () => {
    const result = story([
      { text: "The National Weather Service recorded 9 deaths in the 2006 high wind event.", cites: ["SE-1"] },
      { text: 'The record says "a tornado destroyed downtown" in 2006.', cites: ["SE-1"] },
      { text: "It will flood again here, so plan for the 2009 event.", cites: ["SE-2"] },
      { text: "The 2009 flood was bad.", cites: [] },
      { text: 'The record says "More than 300,000 customers lost power" in 2006.', cites: ["SE-1"] },
    ]);
    expect(result.sentences).toHaveLength(1);
    expect(result.sentences[0].text).toContain("300,000 customers");
    expect(result.dropped).toBe(4);
  });

  it("with nothing verified there is no story, only an honest message", () => {
    const result = story([{ text: "A very bad storm hit in 2006.", cites: ["nope"] }]);
    expect(result.state).toBe("no_answer");
    expect(result.sentences).toEqual([]);
    expect(result.message).toMatch(/could not back a story/);
  });
});

describe("impact tags: only when the event's own narrative supports them", () => {
  it("keeps a tag whose evidence is in the narrative and is about that impact", () => {
    const { kept, dropped } = verifyImpacts(
      [
        { eventId: "SE-1", tag: "power_outage", evidence: "More than 300,000 customers lost power" },
        { eventId: "SE-1", tag: "trees_down", evidence: "knocked down trees" },
        { eventId: "SE-1", tag: "roads_blocked", evidence: "Several roads were closed by fallen trees" },
        { eventId: "SE-1", tag: "power_outage", evidence: "customers lost power" }, // same event and tag again
      ],
      events,
    );
    expect(kept.map((i) => i.tag)).toEqual(["power_outage", "trees_down", "roads_blocked"]);
    expect(dropped).toEqual([]);
  });

  it("drops an impact the narrative does not state, evidence that is not in the narrative, words about something else, a fake event and a fake tag", () => {
    const { kept, dropped } = verifyImpacts(
      [
        { eventId: "SE-2", tag: "power_outage", evidence: "The cities flooded" }, // a flood event is not an outage unless it says so
        { eventId: "SE-1", tag: "flooding", evidence: "Strong winds flooded the streets" }, // not in the text
        { eventId: "SE-1", tag: "structure_damage", evidence: "Strong winds knocked down" }, // in the text, not about buildings
        { eventId: "SE-404", tag: "flooding", evidence: "The cities flooded" },
        { eventId: "SE-2", tag: "tsunami", evidence: "The cities flooded" },
        { eventId: "SE-2", tag: "flooding", evidence: "flood" }, // too short to show anything
      ],
      events,
    );
    expect(kept).toEqual([]);
    expect(dropped.map((d) => d.reason)).toEqual(["words_do_not_show_it", "not_in_narrative", "words_do_not_show_it", "unknown_event", "unknown_tag", "bad_evidence"]);
  });

  it("the summary is written by code from the kept tags, most events first", () => {
    const more = normalizeEvent(row("SE-7", { start: "2015-11-17T04:00:00-08:00", narrative: "Wind brought down power lines and left 200,000 without power." }), {}) as AreaEvent;
    const all = [E1, E2, more];
    const { kept } = verifyImpacts(
      [
        { eventId: "SE-1", tag: "power_outage", evidence: "More than 300,000 customers lost power" },
        { eventId: "SE-7", tag: "power_outage", evidence: "left 200,000 without power" },
        { eventId: "SE-2", tag: "flooding", evidence: "The cities flooded" },
      ],
      all,
    );
    const lines = buildImpactLines(kept, all);
    expect(lines.map((l) => l.text)).toEqual([
      "2 high wind events: the National Weather Service narrative describes power outages.",
      "1 flash flood event: the National Weather Service narrative describes flooding.",
    ]);
    expect(lines[0].eventIds).toEqual(["SE-1", "SE-7"]);
  });

  it("deaths, injuries and damage are added up from the records, and left out when zero", () => {
    expect(totalsLine(events)).toBe("Across these 2 events the National Weather Service recorded 2 deaths, 3 injuries and $94 million in recorded damage.");
    expect(totalsLine([normalizeEvent(row("z"), {}) as AreaEvent])).toBeNull();
  });
});

describe("handleStory: caching per county, budget, and no key", () => {
  const NOW = Date.parse("2026-10-08T19:00:00Z");
  const good = { sentences: [{ text: "The National Weather Service recorded 2 deaths in the high wind event of December 2006.", cites: ["SE-1"] }], impacts: [{ eventId: "SE-1", tag: "power_outage", evidence: "More than 300,000 customers lost power" }] };
  const make = (client = fakeClient(() => modelReply(good)), over: Partial<AiDeps> = {}) =>
    ({
      client,
      budget: new TokenBudget(1_000_000),
      limiter: new RateLimiter(10, 60_000),
      cache: new AnswerCache(),
      storyCache: new AnswerCache<StoryAnswer>(),
      areaEvents: async () => summary,
      lookup: async () => lookupFixture(),
      outlook: async () => outlookFixture(),
      damage: async () => [],
      now: () => NOW,
      ...over,
    }) as AiDeps & { client: ReturnType<typeof fakeClient> };

  it("verifies, answers once per county, and the second address in the county costs no model call", async () => {
    const d = make();
    const first = await handleStory({ address: "450 110th Ave NE, Bellevue, WA", ip: "1.1.1.1" }, d);
    expect(first.status).toBe(200);
    const body = first.body as StoryAnswer;
    expect(body.state).toBe("ok");
    expect(body.impactLines[0].text).toContain("power outages");
    expect(body.cached).toBe(false);
    const second = await handleStory({ address: "another address in King County", ip: "1.1.1.1" }, d);
    expect((second.body as StoryAnswer).cached).toBe(true);
    expect(d.client.calls).toHaveLength(1);
    // the model sees the events as data, with the event id as the source id
    expect((d.client.calls[0].messages as Array<{ content: string }>)[0].content).toContain('<source id="SE-1"');
  });

  it("a story where nothing verifies is not cached; no key and no budget are honest states", async () => {
    const bad = make(fakeClient(() => modelReply({ sentences: [{ text: "Big storms hit.", cites: ["SE-1000"] }], impacts: [] })));
    expect(((await handleStory({ address: "a b c", ip: "1" }, bad)).body as StoryAnswer).state).toBe("no_answer");
    await handleStory({ address: "a b c", ip: "1" }, bad);
    expect(bad.client.calls).toHaveLength(2);

    const none = await handleStory({ address: "a b c", ip: "1" }, make(undefined, { client: null }));
    expect(none).toMatchObject({ status: 503, body: { state: "unavailable" } });
    const resting = await handleStory({ address: "a b c", ip: "1" }, make(undefined, { budget: new TokenBudget(0) }));
    expect(resting).toMatchObject({ status: 503, body: { state: "resting" } });
  });

  it("an area with no events gets a 200 and a plain message, with no model call", async () => {
    const d = make(undefined, { areaEvents: async () => null });
    const result = await handleStory({ address: "a b c", ip: "1" }, d);
    expect(result.status).toBe(200);
    expect((result.body as StoryAnswer).message).toMatch(/no event records/);
    expect(d.client.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- the brief for a quiet address, the tabs, the timeline

describe("the brief's context for a quiet address", () => {
  it("adds why it is quiet and what has happened in the area; a busy address gets neither", () => {
    const quietLookup = lookupFixture({
      floods: { reports: [], tierCounts: { mentioned: 0, about1km: 0, citywide: 0 } },
      nearestFlood: { ...flood({ id: "LSR-1", quote: "WATER OVER THE ROAD" }), distanceKm: 12.4, tier: "about1km" },
      quiet: { state: "TN", count: 0, quieterThanPct: 36, samePct: 64, nonePct: 64, sample: 3500, states: 7 },
      areaEvents: summary,
    });
    const ids = buildSources({ lookup: quietLookup, outlook: outlookFixture(), damage: [] }).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["quiet", "area-counts", "SE-1", "SE-2"]));
    const text = buildSources({ lookup: quietLookup, outlook: outlookFixture(), damage: [] }).find((s) => s.id === "quiet")!.text;
    expect(text).toContain("12.4 km");
    expect(text).toContain("does not mean nothing happened");
    expect(buildUserMessage('<source id="quiet" title="x">', null)).toContain("why this address");
    expect(buildUserMessage("<source id=\"alerts\">", null)).not.toContain("why this address");
    const busy = buildSources({ lookup: lookupFixture({ areaEvents: summary }), outlook: outlookFixture(), damage: [] }).map((s) => s.id);
    expect(busy).not.toContain("quiet");
    expect(busy).toContain("area-counts");
  });
});

describe("tabs and the timeline model", () => {
  it("'future' and 'ready' are hidden until their view files exist; the story tab follows the 72 hours", () => {
    expect(VISIBLE_TABS[0]).toBe("ahead");
    expect(VISIBLE_TABS[1]).toBe("story");
    expect(VISIBLE_TABS).toContain("how");
  });

  it("sorts event types into families and puts dots on a 2000-to-now axis, one lane per family in use", () => {
    expect(familyOf("Thunderstorm Wind")).toBe("storm");
    expect(familyOf("Flash Flood")).toBe("water");
    expect(familyOf("Winter Storm")).toBe("winter");
    expect(familyOf("Excessive Heat")).toBe("heat");
    expect(familyOf("High Wind")).toBe("wind");
    expect(familyOf("Something New")).toBe("other");
    const now = new Date("2026-01-01T00:00:00Z");
    const { dots, lanes } = timelineDots([E1, E2], severityScore, now);
    expect(lanes).toEqual(["wind", "water"]);
    expect(dots[0].x).toBeGreaterThan(20);
    expect(dots[0].x).toBeLessThan(30);
    expect(dots[0].r).toBeGreaterThan(dots[1].r);
    expect(axisTicks(now).map((t) => t.year)).toEqual([2000, 2005, 2010, 2015, 2020, 2025]);
  });

  it("the extremes card lists what it has and leaves out what it does not", () => {
    expect(extremeItems(null)).toEqual([]);
    const items = extremeItems({ wettest: { date: "2015-11-17", inches: 4.1 }, windiest: null, hottest: { date: "2021-06-28", feelsF: 114.7 }, source: "open-meteo" });
    expect(items.map((i) => [i.key, i.value])).toEqual([["wettest", "4.1 in of rain"], ["hottest", "114.7°F feels-like"]]);
  });
});

describe("lookupAddress with area events", () => {
  it("adds areaEvents, the nearest flood, the wettest and windiest days and the percentile for a quiet address, with no network", async () => {
    const dir = fixtureDir();
    const census = { result: { addressMatches: [{ ...CENSUS_NASHVILLE.result.addressMatches[0], coordinates: { x: -122.2, y: 47.6 }, addressComponents: { state: "WA", city: "BELLEVUE" }, geographies: { Counties: [{ NAME: "King County", COUNTY: "033", GEOID: "53033" }] } }] } };
    const archive = {
      daily: {
        time: ["2010-01-01", "2012-02-03", "2014-03-04"],
        apparent_temperature_max: [90, 95, 91],
        precipitation_sum: [0.2, 3.7, 1.1],
        wind_gusts_10m_max: [20, 41.6, 35],
      },
    };
    const payload = await lookupAddress("450 110th Ave NE, Bellevue, WA", {
      fetch: fakeFetch({ census: () => ok(census), fema: () => ok(FEMA_ZONE_X), nws: () => ok(NO_ALERTS), meteo: () => ok(archive) }),
      loadIndex: async () => ({ state: "WA", built: "x", sources: [], floods: [flood({ id: "far", filed: [47.6 + 0.15, -122.2], start: "2018-01-01T00:00:00-08:00" })], tornadoes: [] }),
      loadHeatGrid: async () => null,
      loadEvents: (la, lo, s, c) => selectAreaEvents(la, lo, s, c, dir),
      loadQuiet: async () => ({ built: "x", method: "m", radiusKm: 5, states: { WA: { points: 100, hist: { "0": 80, "2": 20 } } } }),
      now: () => new Date("2026-10-08T20:00:00Z"),
    });
    expect(payload.floods.reports).toEqual([]);
    expect(payload.nearestFlood).toMatchObject({ id: "far" });
    expect(payload.nearestFlood?.distanceKm).toBeGreaterThan(16);
    expect(payload.areaEvents).toMatchObject({ county: "WAC033", total: 4 });
    expect(payload.quiet).toMatchObject({ count: 0, quieterThanPct: 20, samePct: 80 });
    expect(payload.extremes).toMatchObject({ wettest: { date: "2012-02-03", inches: 3.7 }, windiest: { date: "2012-02-03", mph: 42, measure: "gust" }, hottest: { feelsF: 95 }, source: "open-meteo" });
    expect(payload.notices.areaEvents).toBeUndefined();
  });

  it("falls back to NASA POWER for the wettest and windiest days when Open-Meteo fails", async () => {
    const power = { properties: { parameter: { PRECTOTCORR: { "20110101": 5, "20130304": 50.8 }, WS10M_MAX: { "20110101": 8, "20130304": 20 }, T2M_MAX: { "20110101": 20 }, QV2M: { "20110101": 5 }, PS: { "20110101": 100 } } } };
    const payload = await lookupAddress("100 James Robertson Pkwy, Nashville, TN", {
      fetch: fakeFetch({ census: () => ok(CENSUS_NASHVILLE), fema: () => ok(FEMA_ZONE_X), nws: () => ok(NO_ALERTS), meteo: () => new Response("no", { status: 429 }), power: () => ok(power) }),
      loadIndex: async () => null,
      loadHeatGrid: async () => null,
      now: () => new Date("2026-10-08T20:00:00Z"),
    });
    expect(payload.extremes).toMatchObject({ wettest: { date: "2013-03-04", inches: 2 }, windiest: { date: "2013-03-04", mph: 45, measure: "wind" }, source: "nasa-power" });
    expect(payload.areaEvents).toBeNull();
    expect(payload.quiet).toBeNull();
  });
});
void heatYear;
void openMeteoReply;
