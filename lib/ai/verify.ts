/**
 * The code verifier. The model's output is never shown as written: each sentence is checked here first, and a sentence that
 * fails any check is dropped.
 *
 *   1. It must cite at least one source (no citation: dropped).
 *   2. Every cited id must exist in the context we built (a made-up id: dropped).
 *   3. Every number in the sentence must appear in a cited source (an unsupported number: dropped). Numbers written as words
 *      (two to twenty, thirty to ninety, hundred, thousand, million, dozen) count too. "one" alone is left alone ("one of the
 *      reports"), but "twenty-one" is read as 21.
 *   4. Anything in quotation marks must appear word for word in a cited source (a changed quote: dropped).
 *   5. No overclaims: "we predict", "will flood", "you are safe", "guaranteed", "no chance of flooding".
 *   6. Plain text only: no links, tags or line breaks, and a sensible length.
 *
 * It checks that the words and numbers are backed by the cited data. It cannot check that a sentence is a fair reading of that
 * data; the prompt, the short sentences and the visible citations are there for that.
 */
import type { AiSource, DroppedSentence, VerifiedSentence, VerifyResult } from "./types";

export const MAX_SENTENCE_CHARS = 360;
export const MIN_SENTENCE_CHARS = 8;
export const MAX_CITES_PER_SENTENCE = 5;

// ---------------------------------------------------------------- numbers

const UNITS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1_000_000, dozen: 12,
};
const TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SMALL = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

const COMPOUND = new RegExp(`\\b(${TENS.join("|")})[-\\s](${SMALL.join("|")})\\b`, "gi");
const WORD = new RegExp(`\\b(${Object.keys(UNITS).join("|")})\\b`, "gi");
const DIGITS = /\d+(?:,\d{3})*(?:\.\d+)?/g;

/** The numeric value of every number in a text, written as digits or as words. "1,234" is 1234; "2021-03-27" is 2021, 3 and 27. */
export function numbersIn(text: string): number[] {
  const values: number[] = [];
  for (const match of text.matchAll(DIGITS)) values.push(Number(match[0].replace(/,/g, "")));
  // Compounds first ("twenty-five" is 25, not 20 and 5), then single words with the compounds blanked out.
  const withoutCompounds = text.replace(COMPOUND, (_all, tens: string, unit: string) => {
    values.push(UNITS[tens.toLowerCase()] + (SMALL.indexOf(unit.toLowerCase()) + 1));
    return " ";
  });
  for (const match of withoutCompounds.matchAll(WORD)) values.push(UNITS[match[1].toLowerCase()]);
  return values;
}

const sameNumber = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// ---------------------------------------------------------------- quotes

const QUOTE = /[“"]([^”"]{6,}?)[”"]/g;

const squash = (text: string) =>
  text
    .toLowerCase()
    .replace(/[“”"]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** The quoted passages of a sentence, minus a trailing ellipsis ("...", "…") that marks a cut. */
export function quotesIn(text: string): string[] {
  const found: string[] = [];
  // A cut is marked with an ellipsis, and American style puts the sentence's period or comma inside the quotation marks: neither is part of the quoted words.
  for (const match of text.matchAll(QUOTE)) found.push(match[1].replace(/(\.{3}|…)\s*$/, "").replace(/^(\.{3}|…)\s*/, "").replace(/[.,;:!?]+\s*$/, ""));
  return found.filter((q) => q.trim().length >= 6);
}

// ---------------------------------------------------------------- overclaims

const OVERCLAIMS: Array<[RegExp, string]> = [
  [/\b(we|i)\s+(predict|forecast|expect|project)\b/i, "we predict"],
  [/\bour\s+(prediction|forecast|projection|model\s+(predicts|forecasts|expects))\b/i, "our forecast"],
  [/\bwill\s+(definitely\s+|certainly\s+|surely\s+)?(flood|be\s+flooded|be\s+hit|hit\s+your|strike|touch\s+down)\b/i, "will flood"],
  [/\b(going\s+to|gonna)\s+(flood|be\s+flooded)\b/i, "going to flood"],
  [/\bguarantee[sd]?\b/i, "guarantee"],
  [/\b(is|are|was|were|will\s+be|remains?|stays?|you're|it's)\s+(totally\s+|completely\s+|perfectly\s+|entirely\s+)?(safe|in\s+no\s+danger)\b/i, "you are safe"],
  [/\b(no|zero)\s+(chance|risk|danger)\s+(of|from)\s+(flooding|a\s+flood|flood|tornadoes|a\s+tornado|heat)\b/i, "no chance of"],
];

// ---------------------------------------------------------------- the checks

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** What a source offers for checking: its facts, its title and its quotation. Ids and links are left out on purpose. */
function checkableText(source: AiSource): string {
  return `${source.title} ${source.text} ${source.quote ?? ""}`;
}

export function verifySentence(raw: unknown, sources: ReadonlyMap<string, AiSource>): { ok: true; sentence: VerifiedSentence } | { ok: false; dropped: DroppedSentence } {
  const candidate = raw as { text?: unknown; cites?: unknown } | null;
  const text = typeof candidate?.text === "string" ? normalizeText(candidate.text) : "";
  const fail = (reason: DroppedSentence["reason"], detail?: string) => ({ ok: false as const, dropped: { text: text.slice(0, MAX_SENTENCE_CHARS), reason, ...(detail ? { detail } : {}) } });

  if (text.length < MIN_SENTENCE_CHARS || text.length > MAX_SENTENCE_CHARS) return fail("bad_format", `${text.length} characters`);
  if (/https?:|www\.|[<>`]|javascript:/i.test(text)) return fail("bad_format", "link or markup");

  const cites = Array.isArray(candidate?.cites) ? [...new Set(candidate.cites.filter((c): c is string => typeof c === "string").map((c) => c.trim()))] : [];
  if (cites.length === 0) return fail("no_citation");
  const unknown = cites.find((id) => !sources.has(id));
  if (unknown !== undefined) return fail("unknown_source", unknown.slice(0, 60));
  if (cites.length > MAX_CITES_PER_SENTENCE) return fail("bad_format", "too many citations");

  const cited = cites.map((id) => sources.get(id) as AiSource);
  const evidence = cited.map(checkableText).join(" \n ");

  const supported = numbersIn(evidence);
  for (const value of numbersIn(text)) {
    if (!supported.some((have) => sameNumber(have, value))) return fail("unsupported_number", String(value));
  }

  const haystack = squash(evidence);
  for (const quote of quotesIn(text)) {
    if (!haystack.includes(squash(quote))) return fail("unsupported_quote", quote.slice(0, 60));
  }

  for (const [pattern, label] of OVERCLAIMS) {
    if (pattern.test(text)) return fail("overclaim", label);
  }

  return { ok: true, sentence: { text, cites } };
}

/** Checks every sentence the model wrote. Order is kept. Input that is not an array yields nothing. */
export function verifySentences(raw: unknown, sources: ReadonlyMap<string, AiSource>): VerifyResult {
  const kept: VerifiedSentence[] = [];
  const dropped: DroppedSentence[] = [];
  if (!Array.isArray(raw)) return { kept, dropped };
  for (const item of raw) {
    const result = verifySentence(item, sources);
    if (result.ok) kept.push(result.sentence);
    else dropped.push(result.dropped);
  }
  return { kept, dropped };
}
