import { describe, expect, it } from "vitest";
import { numbersIn, quotesIn, verifySentence, verifySentences } from "@/lib/ai/verify";
import type { AiSource } from "@/lib/ai/types";

const source = (id: string, text: string, extra: Partial<AiSource> = {}): AiSource => ({
  id,
  kind: "outlook",
  chip: id,
  title: `Title of ${id}`,
  origin: "test",
  text,
  ...extra,
});

const SOURCES = new Map<string, AiSource>([
  ["flood-outlook", source("flood-outlook", "Day 1 (Thu Oct 8): no risk area at this address. Day 2 (Fri Oct 9): Marginal risk. Day 3 (Sat Oct 10): Slight risk.")],
  ["flood-record", source("flood-record", "Days rated Slight: a flood was reported within 10 km on 10 of 118 days (8.5%). Days rated Marginal: 10 of 375 days (2.7%).", { kind: "record" })],
  ["report-1", source("report-1", "Flash Flood report, March 27, 2021, 10:55 pm local time, Nashville. It is 0.4 km from this address.", { kind: "report", quote: "ROSA PARKS BLVD UNDERWATER NEAR THE FARMERS MARKET WITH CARS STALLED" })],
  ["tornado-1", source("tornado-1", "EF3 tornado on Mar 3, 2020. Recorded width up to 1,600 yards and length 21.49 miles.", { kind: "tornado" })],
]);

const sentence = (text: string, cites: string[]) => ({ text, cites });

describe("numbersIn", () => {
  it("reads digits, thousands separators, decimals, percents and dates", () => {
    expect(numbersIn("1,600 yards, 21.49 miles, 8.5%")).toEqual([1600, 21.49, 8.5]);
    expect(numbersIn("March 27, 2021, 10:55 pm")).toEqual([27, 2021, 10, 55]);
    expect(numbersIn("2021-03-27")).toEqual([2021, 3, 27]);
  });

  it("reads number words, and compounds as one number", () => {
    expect(numbersIn("two reports and twenty-five days").sort((a, b) => a - b)).toEqual([2, 25]);
    expect(numbersIn("a dozen, three hundred").sort((a, b) => a - b)).toEqual([3, 12, 100]);
  });

  it("leaves the bare word one alone", () => {
    expect(numbersIn("one of the reports")).toEqual([]);
  });
});

describe("quotesIn", () => {
  it("finds quoted passages, drops a trailing ellipsis, ignores very short quotes", () => {
    expect(quotesIn('The report said "CARS STALLED ON ROSA PARKS..." and "ok".')).toEqual(["CARS STALLED ON ROSA PARKS"]);
    expect(quotesIn("He said “WATER ON THE ROAD” today.")).toEqual(["WATER ON THE ROAD"]);
    // The sentence's own period or comma sits inside the quotation marks in American style; it is not part of the quoted words.
    expect(quotesIn('It reads "WATER ON THE ROAD," and "CARS STALLED."')).toEqual(["WATER ON THE ROAD", "CARS STALLED"]);
  });
});

describe("verifySentence", () => {
  it("keeps a sentence whose citation exists and whose numbers are in the cited source", () => {
    const result = verifySentence(sentence("On 10 of 118 past days rated Slight, a flood was reported within 10 km.", ["flood-record"]), SOURCES);
    expect(result.ok).toBe(true);
  });

  it("drops a sentence that cites a source id that does not exist (a fake id)", () => {
    const result = verifySentence(sentence("The Weather Prediction Center rates Day 3 as Slight.", ["flood-outlook", "made-up-source"]), SOURCES);
    expect(result).toMatchObject({ ok: false, dropped: { reason: "unknown_source", detail: "made-up-source" } });
  });

  it("drops a sentence with a number that is not in a cited source (an unsupported number)", () => {
    const result = verifySentence(sentence("On 12 of 118 past days rated Slight, a flood was reported within 10 km.", ["flood-record"]), SOURCES);
    expect(result).toMatchObject({ ok: false, dropped: { reason: "unsupported_number", detail: "12" } });
  });

  it("drops a sentence whose number appears only in a source it did not cite", () => {
    // 375 is in flood-record, but this sentence cites flood-outlook.
    const result = verifySentence(sentence("There were 375 days rated Marginal.", ["flood-outlook"]), SOURCES);
    expect(result).toMatchObject({ ok: false, dropped: { reason: "unsupported_number", detail: "375" } });
  });

  it("drops a sentence with no citation (an uncited sentence)", () => {
    expect(verifySentence(sentence("Flooding is common in this part of town.", []), SOURCES)).toMatchObject({ ok: false, dropped: { reason: "no_citation" } });
    expect(verifySentence({ text: "Flooding is common in this part of town." }, SOURCES)).toMatchObject({ ok: false, dropped: { reason: "no_citation" } });
  });

  it("counts number words the same as digits", () => {
    expect(verifySentence(sentence("A flood was reported on ten of 118 past days rated Slight.", ["flood-record"]), SOURCES).ok).toBe(true);
    expect(verifySentence(sentence("A flood was reported on eleven of 118 past days rated Slight.", ["flood-record"]), SOURCES)).toMatchObject({ ok: false, dropped: { reason: "unsupported_number", detail: "11" } });
  });

  it("does not let a number in a source's id or link vouch for a sentence", () => {
    const withLink = new Map(SOURCES).set("report-2", source("report-2", "A report.", { href: "https://example.org/event?id=987654" }));
    expect(verifySentence(sentence("Event 987654 was reported nearby.", ["report-2"]), withLink)).toMatchObject({ ok: false, dropped: { reason: "unsupported_number" } });
  });

  it("accepts a quotation that is in the cited source, and drops one that is changed", () => {
    const exact = verifySentence(sentence('A report said "rosa parks blvd underwater near the farmers market".', ["report-1"]), SOURCES);
    expect(exact.ok).toBe(true);
    const changed = verifySentence(sentence('A report said "ROSA PARKS BLVD COMPLETELY SUBMERGED".', ["report-1"]), SOURCES);
    expect(changed).toMatchObject({ ok: false, dropped: { reason: "unsupported_quote" } });
  });

  it("lets a period or comma inside the closing quotation mark pass, but still checks every word", () => {
    expect(verifySentence(sentence('A report said "rosa parks blvd underwater near the farmers market with cars stalled."', ["report-1"]), SOURCES).ok).toBe(true);
    expect(verifySentence(sentence('A report said "rosa parks blvd underwater near the farmers market with cars stalled," and more.', ["report-1"]), SOURCES).ok).toBe(true);
    expect(verifySentence(sentence('A report said "rosa parks blvd underwater near the farmers market with boats stalled."', ["report-1"]), SOURCES)).toMatchObject({ ok: false, dropped: { reason: "unsupported_quote" } });
  });

  it("checks dates against the date the source gives", () => {
    expect(verifySentence(sentence("A flash flood was reported on March 27, 2021.", ["report-1"]), SOURCES).ok).toBe(true);
    expect(verifySentence(sentence("A flash flood was reported on March 28, 2021.", ["report-1"]), SOURCES)).toMatchObject({ ok: false, dropped: { detail: "28" } });
  });

  it("drops overclaims even when they are cited", () => {
    for (const text of ["It will flood on Saturday according to the Slight outlook.", "We predict flooding on Day 3.", "You are safe on Day 1 per the outlook.", "There is no chance of flooding on Day 1."]) {
      expect(verifySentence(sentence(text, ["flood-outlook"]), SOURCES)).toMatchObject({ ok: false, dropped: { reason: "overclaim" } });
    }
  });

  it("drops links, markup and absurd lengths", () => {
    expect(verifySentence(sentence("See https://evil.example for Day 2.", ["flood-outlook"]), SOURCES)).toMatchObject({ ok: false, dropped: { reason: "bad_format" } });
    expect(verifySentence(sentence("<b>Day 2</b> is Marginal.", ["flood-outlook"]), SOURCES)).toMatchObject({ ok: false, dropped: { reason: "bad_format" } });
    expect(verifySentence(sentence("Hi", ["flood-outlook"]), SOURCES)).toMatchObject({ ok: false, dropped: { reason: "bad_format" } });
    expect(verifySentence(sentence(`Day 2 ${"is Marginal ".repeat(60)}`, ["flood-outlook"]), SOURCES)).toMatchObject({ ok: false, dropped: { reason: "bad_format" } });
  });

  it("collapses line breaks and repeated citations", () => {
    const result = verifySentence(sentence("Day 2 is\n  rated Marginal.", ["flood-outlook", "flood-outlook"]), SOURCES);
    expect(result).toMatchObject({ ok: true, sentence: { text: "Day 2 is rated Marginal.", cites: ["flood-outlook"] } });
  });
});

describe("verifySentences", () => {
  it("keeps the good sentences in order and reports each dropped one with its reason", () => {
    const { kept, dropped } = verifySentences(
      [
        sentence("The Weather Prediction Center rates Day 3 as Slight.", ["flood-outlook"]),
        sentence("Flooding here is getting worse every year.", []),
        sentence("A flood was reported on 10 of 118 past days rated Slight.", ["flood-record"]),
        sentence("A flood was reported on 99 of 118 past days rated Slight.", ["flood-record"]),
        sentence("See the report.", ["nope"]),
      ],
      SOURCES,
    );
    expect(kept.map((s) => s.cites[0])).toEqual(["flood-outlook", "flood-record"]);
    expect(dropped.map((d) => d.reason)).toEqual(["no_citation", "unsupported_number", "unknown_source"]);
  });

  it("returns nothing for output that is not a list", () => {
    expect(verifySentences("not a list", SOURCES)).toEqual({ kept: [], dropped: [] });
    expect(verifySentences(null, SOURCES)).toEqual({ kept: [], dropped: [] });
  });
});

describe("overclaims that hold in every state, not only outside our coverage", () => {
  const dropped = (text: string, cites = ["flood-outlook"]) => verifySentence(sentence(text, cites), SOURCES);
  const reason = (text: string, cites?: string[]) => {
    const result = dropped(text, cites);
    return result.ok ? null : result.dropped.reason;
  };

  it.each([
    "This street will never flood.",
    "This address will not flood.",
    "This street will likely flood on Day 3.",
    "This address won’t flood.",
    "This street won't see a flood.",
    "This area is unlikely to flood.",
    "Flooding cannot flood this address.",
    "This street can't flood.",
    "Your home is not at risk of flooding.",
    "This address is not currently at risk.",
    "You'll be safe from flooding here.",
    "This address is protected from floods.",
    "There is nothing to worry about from floods here.",
    "You do not need flood insurance here.",
    "Don't worry about the rain.",
  ])("drops %j", (text) => {
    expect(reason(text)).toBe("overclaim");
  });

  it.each([
    "The Weather Prediction Center shows no risk area at this address for Day 1.",
    "Day 3 (Sat Oct 10) is rated Slight risk by the Weather Prediction Center.",
    "The Flood Watch will remain in effect on Day 2.",
    "On days rated Slight, a flood was reported within 10 km on 10 of 118 days, a count of past days, not a chance for tomorrow.",
  ])("keeps %j", (text) => {
    const cites = text.includes("118") ? ["flood-record"] : ["flood-outlook"];
    expect(dropped(text, cites).ok).toBe(true);
  });
});

describe("numbers that are present but mean something else", () => {
  const check = (text: string, cites: string[]) => verifySentence(sentence(text, cites), SOURCES);

  it("a percentage must be a percentage in the source, not another number that happens to match", () => {
    const result = check("There is a 10% chance of a flood here.", ["flood-record"]);
    expect(result.ok ? null : result.dropped).toEqual(expect.objectContaining({ reason: "unsupported_number", detail: "10%" }));
    expect(check("A flood was reported on 8.5% of the days rated Slight.", ["flood-record"]).ok).toBe(true);
  });

  it("plural number words and billion are numbers", () => {
    expect(numbersIn("hundreds of floods, dozens of tornadoes, $3 billion")).toEqual(expect.arrayContaining([100, 12, 3, 1_000_000_000]));
    expect(check("Hundreds of floods were reported within 10 km.", ["flood-record"]).ok).toBe(false);
  });

  it("a multiplier must be the source's own word", () => {
    const result = check("Flooding here doubled on days rated Slight.", ["flood-record"]);
    expect(result.ok ? null : result.dropped).toEqual(expect.objectContaining({ reason: "unsupported_number", detail: "doubled" }));
  });
});
