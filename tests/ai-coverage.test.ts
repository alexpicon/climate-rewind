/**
 * Outside the states we have indexed (Denver, CO; Washington, DC) we did not look, so "no floods" or "no tornadoes" would be a
 * false all-clear. The sources say "we have not indexed X yet, so we cannot say", and the verifier lets nothing else about the past through.
 */
import { describe, expect, it } from "vitest";
import { AnswerCache, RateLimiter, TokenBudget } from "@/lib/ai/guard";
import { cleanQuestion, handleAi, type AiDeps } from "@/lib/ai/service";
import { buildSources, COVERAGE_SOURCE_ID } from "@/lib/ai/sources";
import type { AiAnswer, AiSource } from "@/lib/ai/types";
import { coverageViolation, COVERAGE_ID, verifySentence } from "@/lib/ai/verify";
import { fakeClient, lookupFixture, modelReply, outlookFixture } from "./ai-fixtures";

const NOW = Date.parse("2026-10-08T19:00:00Z");

const place = (state: string, city: string, lat: number, lon: number) => ({ input: `somewhere, ${city}`, matched: `SOMEWHERE, ${city}, ${state}`, lat, lon, state, county: null, city });

/** An address in a state we have not indexed: no flood reports, no tornadoes, no storm nights, and a coverage of "not yet indexed". */
const outside = (state: string, city: string, lat: number, lon: number) =>
  lookupFixture({
    address: place(state, city, lat, lon),
    floods: { reports: [], tierCounts: { mentioned: 0, about1km: 0, citywide: 0 } },
    tornadoes: [],
    stormNights: [],
    stormReplay: null,
    heat: null,
    coverage: "not yet indexed",
    notices: { index: `We have not indexed ${state} yet, so flood reports and tornado paths are not shown.` },
  });

const noRecords = () => outlookFixture({ recordSlug: null, flood: { days: outlookFixture().flood.days, record: null }, tornado: { days: outlookFixture().tornado.days, record: null } });

const DENVER = outside("CO", "DENVER", 39.7392, -104.9903);
const DC = outside("DC", "WASHINGTON", 38.8977, -77.0365);

const FALSE_ALL_CLEARS = [
  "No floods have been reported near this address.",
  "There are no tornadoes on record here.",
  "No flood reports within 5 km of this address are in our records.",
  "Our records hold no tornado track near this address.",
  "Floods have never been reported at this address.",
  "Nothing has been reported here, so this street looks clear of floods.",
  "Flooding has not been reported near this address.",
  "This address is all clear for floods and tornadoes.",
  "Neither floods nor tornadoes were reported here.",
  "This address has been spared from tornadoes.",
  "Zero flood reports are in our records for this address.",
  "Flood reports near this address: none.",
];

const PAST_EVENTS = ["A flood was reported near this address in 2019.", "A tornado track passed near this address in the records.", "Floods happened here in the past."];

describe("the sources for an address in a state we have not indexed", () => {
  it("says what we cover instead of 'no floods', for Denver and for DC", () => {
    const denver = new Map(buildSources({ lookup: DENVER, outlook: noRecords(), damage: [] }).map((s) => [s.id, s]));
    expect(denver.get(COVERAGE_SOURCE_ID)!.text).toBe("We have not indexed Colorado yet, so we cannot say whether floods or tornadoes were reported here.");
    const dc = new Map(buildSources({ lookup: DC, outlook: noRecords(), damage: [] }).map((s) => [s.id, s]));
    expect(dc.get(COVERAGE_SOURCE_ID)!.text).toBe("We have not indexed the District of Columbia yet, so we cannot say whether floods or tornadoes were reported here.");
    for (const map of [denver, dc]) {
      for (const id of ["flood-history", "tornado-history", "report-1", "tornado-1", "damage-1"]) expect(map.has(id), id).toBe(false);
      // The official outlooks may say "no risk area" (that is the agency's word); nothing OURS may say there were none.
      const all = [...map.values()].filter((s) => s.kind !== "outlook" && s.kind !== "heat").map((s) => `${s.title} ${s.text}`).join("\n");
      expect(all).not.toMatch(/\bno (flood|tornado)/i);
      expect(all).not.toMatch(/\bnone? (is|are) in our records/i);
    }
  });

  it("keeps the official outlooks, which are the agencies' own and do not depend on our index", () => {
    const ids = buildSources({ lookup: DENVER, outlook: noRecords(), damage: [] }).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["alerts", "flood-outlook", "tornado-outlook", "heatrisk"]));
  });

  it("does not hand over flood reports or tornadoes even if the payload somehow carried them", () => {
    const leaky = { ...DENVER, floods: lookupFixture().floods, tornadoes: lookupFixture().tornadoes };
    const ids = buildSources({ lookup: leaky, outlook: noRecords(), damage: [] }).map((s) => s.id);
    expect(ids.filter((id) => /^(report|tornado|damage)-\d/.test(id))).toEqual([]);
  });

  it("an indexed state is unchanged: a quiet record still reads as a record, with the caveat", () => {
    const quiet = lookupFixture({ floods: { reports: [], tierCounts: { mentioned: 0, about1km: 0, citywide: 0 } }, tornadoes: [] });
    const map = new Map(buildSources({ lookup: quiet, outlook: noRecords(), damage: [] }).map((s) => [s.id, s]));
    expect(map.has(COVERAGE_SOURCE_ID)).toBe(false);
    expect(map.get("flood-history")!.text).toContain("not every flood is reported");
  });
});

describe("the verifier, when the coverage source is present", () => {
  const sources = new Map<string, AiSource>(buildSources({ lookup: DENVER, outlook: noRecords(), damage: [] }).map((s) => [s.id, s]));
  const STATEMENT = "We have not indexed Colorado yet, so we cannot say whether floods or tornadoes were reported here.";

  it("uses the same id as the source builder", () => {
    expect(COVERAGE_ID).toBe(COVERAGE_SOURCE_ID);
  });

  it("drops every way of saying 'no floods' or 'no tornadoes', whatever it cites", () => {
    for (const text of FALSE_ALL_CLEARS) {
      for (const cites of [["coverage"], ["flood-outlook"], ["tornado-outlook", "coverage"]]) {
        expect(verifySentence({ text, cites }, sources).ok, `${text} / ${cites}`).toBe(false);
      }
    }
  });

  it("drops claims about past floods or tornadoes that do not cite the coverage statement", () => {
    for (const text of PAST_EVENTS) expect(verifySentence({ text: text.replace(/ in 2019| in the records/, ""), cites: ["flood-outlook"] }, sources), text).toMatchObject({ ok: false, dropped: { reason: "overclaim" } });
  });

  it("keeps the coverage statement, and only that, as the statement about the past", () => {
    expect(verifySentence({ text: STATEMENT, cites: ["coverage"] }, sources).ok).toBe(true);
    expect(verifySentence({ text: "We have not indexed Colorado yet, so we cannot say whether floods were reported here.", cites: ["coverage"] }, sources).ok).toBe(true);
    // The statement cannot be used to smuggle in a denial.
    expect(verifySentence({ text: `${STATEMENT.replace(/\.$/, "")}, and there are no floods on record.`, cites: ["coverage"] }, sources).ok).toBe(false);
    expect(verifySentence({ text: "We have not indexed Colorado yet, so we cannot say; it is safe from tornadoes.", cites: ["coverage"] }, sources).ok).toBe(false);
    // Without the citation it is not the statement.
    expect(verifySentence({ text: STATEMENT, cites: ["flood-outlook"] }, sources)).toMatchObject({ ok: false, dropped: { reason: "overclaim" } });
  });

  it("still lets the official outlooks say 'no risk area', which is the agency's word and not a history", () => {
    for (const text of ["The Weather Prediction Center shows no risk area at this address for Day 1.", "The Storm Prediction Center shows no tornado risk area at this point on Day 1 (under 2%).", "There is no flood risk area on Day 1 per the outlook."]) {
      expect(verifySentence({ text, cites: ["flood-outlook", "tornado-outlook"].filter((id) => (/tornado/.test(text) ? id === "tornado-outlook" : id === "flood-outlook")) }, sources), text).toMatchObject({ ok: true });
    }
    expect(verifySentence({ text: "The Weather Prediction Center rates Day 2 (Fri Oct 9) as Marginal risk at this address.", cites: ["flood-outlook"] }, sources).ok).toBe(true);
    expect(verifySentence({ text: "The Storm Prediction Center gives 5% for any severe weather on Day 3.", cites: ["tornado-outlook"] }, sources).ok).toBe(true);
  });

  it("does not apply when the state is indexed (the rule is about coverage, not about the word 'no')", () => {
    const indexed = new Map<string, AiSource>(buildSources({ lookup: lookupFixture(), outlook: outlookFixture(), damage: [] }).map((s) => [s.id, s]));
    expect(indexed.has(COVERAGE_ID)).toBe(false);
    expect(verifySentence({ text: "The most recent flood report was in March 2021, 0.4 km away.", cites: ["report-1"] }, indexed).ok).toBe(true);
  });

  it("exposes the check on its own", () => {
    expect(coverageViolation("No floods have been reported here.", ["coverage"])).toMatch(/false all-clear/);
    expect(coverageViolation(STATEMENT, ["coverage"])).toBeNull();
    // The coverage rule itself (not a number or a citation check) is what stops each of these.
    for (const text of FALSE_ALL_CLEARS) expect(coverageViolation(text, ["coverage"]), text).toMatch(/false all-clear/);
    for (const text of PAST_EVENTS) expect(coverageViolation(text, ["flood-outlook"]), text).toMatch(/past events|false all-clear/);
  });
});

// ---------------------------------------------------------------- end to end, with a model that tries to say it

function deps(lookup: ReturnType<typeof outside>, reply: unknown): AiDeps & { client: ReturnType<typeof fakeClient> } {
  return {
    client: fakeClient(() => modelReply(reply)),
    budget: new TokenBudget(1_000_000),
    limiter: new RateLimiter(50, 60_000),
    cache: new AnswerCache<AiAnswer>(),
    lookup: async () => lookup,
    outlook: async () => noRecords(),
    damage: async () => [],
    now: () => NOW,
  } as AiDeps & { client: ReturnType<typeof fakeClient> };
}

const NEVER = /\b(no|zero|never|none|nothing|neither)\b[^.]{0,40}\b(floods?|flooding|tornado(es)?)\b|\ball[\s-]clear\b|\bclear of\b|\bspared\b/i;

describe.each([
  ["Denver, CO", DENVER, "1437 Bannock St, Denver, CO", "Colorado"],
  ["Washington, DC", DC, "1600 Pennsylvania Ave NW, Washington, DC", "the District of Columbia"],
])("a brief and an Ask for %s", (_name, lookup, address, stateWords) => {
  const statement = `We have not indexed ${stateWords} yet, so we cannot say whether floods or tornadoes were reported here.`;
  const attempt = {
    scope: "in_scope",
    sentences: [
      { text: "The Weather Prediction Center shows no risk area at this address for Day 1.", cites: ["flood-outlook"] },
      { text: "No floods or tornadoes have been reported near this address.", cites: ["coverage", "flood-outlook"] },
      { text: "Our records hold no flood report within 5 km of this address.", cites: ["coverage"] },
      { text: "This address has a clean history: nothing has happened here.", cites: ["coverage"] },
      { text: statement, cites: ["coverage"] },
    ],
  };

  it("brief: shows the coverage statement and the outlook, never a claim that nothing happened", async () => {
    const d = deps(lookup, attempt);
    const result = await handleAi({ address, question: null, ip: "9.9.9.9" }, d);
    const body = result.body as AiAnswer;
    expect(body.state).toBe("ok");
    expect(body.sentences.map((s) => s.text)).toEqual(["The Weather Prediction Center shows no risk area at this address for Day 1.", statement]);
    expect(body.dropped).toBe(3);
    for (const s of body.sentences) expect(s.text).not.toMatch(NEVER);
    expect(Object.keys(body.sources)).toContain("coverage");
    // The model was shown the coverage source and the rule, and no flood or tornado history.
    const prompt = JSON.stringify(d.client.calls[0]);
    expect(prompt).toContain(statement);
    expect(prompt).not.toMatch(/Flood reports near this address|Tornado tracks near this address|No flood report within 5 km/);
  });

  it("ask: 'has it ever flooded here?' gets the coverage statement or nothing, never 'no'", async () => {
    for (const question of ["Has it ever flooded here?", "Have there been any tornadoes near me?", "Is my street safe from floods?"]) {
      const d = deps(lookup, { scope: "in_scope", sentences: attempt.sentences.slice(1) });
      const result = await handleAi({ address, question: cleanQuestion(question), ip: "9.9.9.9" }, d);
      const body = result.body as AiAnswer;
      expect(body.sentences.map((s) => s.text)).toEqual([statement]);
      for (const s of body.sentences) expect(s.text).not.toMatch(NEVER);
    }
  });

  it("ask: when the model only writes false all-clears, nothing is shown (the page's own 'could not back an answer' line appears)", async () => {
    const d = deps(lookup, { scope: "in_scope", sentences: attempt.sentences.slice(1, 4) });
    const body = (await handleAi({ address, question: "Any floods here?", ip: "9.9.9.9" }, d)).body as AiAnswer;
    expect(body).toMatchObject({ state: "no_answer", sentences: [] });
    expect(body.message).not.toMatch(NEVER);
  });
});

describe("rarity and quiet are all-clears outside our coverage too", () => {
  it.each([
    ["Denver rarely floods.", []],
    ["Tornadoes are rare in this part of Colorado.", []],
    ["This area has seen no flood risk in decades.", []],
    ["We have not indexed Colorado yet, so we cannot say whether floods were reported here, but the area has been quiet.", ["coverage"]],
    ["We have not indexed Colorado yet, so we cannot say; floods are uncommon here anyway.", ["coverage"]],
  ])("drops %j", (text, extra) => {
    expect(coverageViolation(text, ["coverage", ...extra])).not.toBeNull();
  });
});
