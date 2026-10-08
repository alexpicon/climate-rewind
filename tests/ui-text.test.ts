import { describe, expect, it } from "vitest";
import { excerpt, formatAtOffset, highlightSegments, isShouty, niceDate, offsetLabel, offsetMinutes, placeName, prettyPlace, readableCase, shortDay } from "@/lib/ui/text";

describe("readableCase (display only)", () => {
  it("turns SHOUTING text into sentence case and keeps the names the report supplies", () => {
    const out = readableCase("ROSA PARKS BLVD UNDERWATER NEAR THE FARMERS MARKET WITH CARS STALLED", ["Rosa Parks Blvd", "Farmers Market"]);
    expect(out).toBe("Rosa Parks Blvd underwater near the Farmers Market with cars stalled");
  });

  it("capitalises road names and acronyms generically", () => {
    expect(readableCase("1ST FLOOR OF HOTEL FLOODED AT 95 WALLACE ROAD NEAR I-24 AT HARDING PLACE")).toBe(
      "1st floor of hotel flooded at 95 Wallace Road near I-24 at Harding Place",
    );
    expect(readableCase("TRAINED SPOTTER IN SPRING HILL, TN", ["Spring Hill"])).toContain("Spring Hill, TN");
  });

  it("leaves normally cased text alone", () => {
    const text = "Two feet of flood water was reported covering the intersection of 3rd Street at Crutcher Road.";
    expect(isShouty(text)).toBe(false);
    expect(readableCase(text)).toBe(text);
  });
});

describe("highlightSegments", () => {
  it("marks place words, supporting landmarks and vague regions, ignoring case", () => {
    const segments = highlightSegments("Rosa Parks Blvd underwater near the Farmers Market", { place: ["rosa parks blvd"], support: ["Farmers Market"] });
    expect(segments).toEqual([
      { text: "Rosa Parks Blvd", mark: "place" },
      { text: " underwater near the ", mark: null },
      { text: "Farmers Market", mark: "support" },
    ]);
  });

  it("returns the whole text unmarked when nothing matches", () => {
    expect(highlightSegments("Water on the road", { place: ["Elm St"] })).toEqual([{ text: "Water on the road", mark: null }]);
  });

  it("drops overlapping matches instead of duplicating text", () => {
    const segments = highlightSegments("Oak Hill area", { place: ["Oak Hill"], support: ["Hill area"] });
    expect(segments.map((s) => s.text).join("")).toBe("Oak Hill area");
  });

  it("returns plain data, never markup", () => {
    const [segment] = highlightSegments("<b>x</b>", { place: ["<b>x</b>"] });
    expect(segment.text).toBe("<b>x</b>");
  });
});

describe("excerpt", () => {
  it("keeps short text whole", () => {
    expect(excerpt("Trees down.")).toEqual({ text: "Trees down.", truncated: false });
  });

  it("cuts long text at a sentence boundary", () => {
    const text = "First sentence is here. Second sentence is also here. " + "Third sentence goes on. ".repeat(30);
    const out = excerpt(text, 80);
    expect(out.truncated).toBe(true);
    expect(out.text.endsWith(".")).toBe(true);
    expect(out.text.length).toBeLessThan(160);
  });
});

describe("time helpers", () => {
  it("reads the offset from a local timestamp and formats the clock at that offset", () => {
    expect(offsetMinutes("2021-03-27T22:55:00-05:00")).toBe(-300);
    expect(offsetMinutes("2021-03-27T22:55:00+05:30")).toBe(330);
    expect(offsetLabel(-300)).toBe("UTC-5");
    const ms = Date.parse("2021-03-28T03:55:00Z");
    expect(formatAtOffset(ms, -300, { hour: "numeric", minute: "2-digit" })).toBe("10:55 PM");
  });

  it("formats dates as written, without timezone shifting", () => {
    expect(niceDate("2020-03-03T00:32:00-06:00")).toBe("Mar 3, 2020");
    expect(shortDay("2012-06-29")).toBe("Jun 29");
  });

  it("shows an LSR place without its distance prefix", () => {
    expect(placeName("1 ENE MOUNT JULIET")).toBe("Mount Juliet");
    expect(placeName("NASHVILLE")).toBe("Nashville");
    expect(placeName("3 SSE MURFREESBORO")).toBe("Murfreesboro");
  });

  it("title-cases the first part of a Census match", () => {
    expect(prettyPlace("ROSA L PARKS BLVD, NASHVILLE, TN 37201")).toBe("Rosa L Parks Blvd");
  });

  it("keeps compass directions in capitals (Bellevue's 136th Pl NE & NE 20th St)", () => {
    expect(prettyPlace("136TH PL NE & NE 20TH ST, BELLEVUE, WA, 98008")).toBe("136th Pl NE & NE 20th St");
    expect(prettyPlace("SW MILITARY DR & S ZARZAMORA ST, SAN ANTONIO, TX")).toBe("SW Military Dr & S Zarzamora St");
  });
});
