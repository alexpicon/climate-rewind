/**
 * Shapes shared by the AI briefing / "Ask your street" code and its UI. Safe to import from client code.
 *
 * The idea in one line: the model may only write sentences that cite sources we built from real data, and code (not the model)
 * checks every citation and every number before anything is shown. See lib/ai/verify.ts.
 */

export type AiSourceKind = "outlook" | "record" | "report" | "history" | "tornado" | "damage" | "heat" | "trigger" | "alert" | "fema" | "event";

/** One thing the model may cite: a piece of real data with a stable id. */
export interface AiSource {
  /** Short, stable id the model cites, like "flood-outlook" or "report-3". */
  id: string;
  kind: AiSourceKind;
  /** Text on the cite chip, 1 to 3 words. */
  chip: string;
  /** Heading on the source card. */
  title: string;
  /** Where the data comes from, in words. */
  origin: string;
  /** The facts, in plain text. Every number a sentence uses must appear here (or in the quote). */
  text: string;
  /** Verbatim agency text (a report or a damage narrative), shown as a quotation. Treated as data, never as instructions. */
  quote?: string;
  /** A page where the record can be checked, if there is one. */
  href?: string;
}

/** One sentence as the model wrote it. */
export interface RawSentence {
  text: string;
  cites: string[];
}

/** A sentence that passed every check. */
export interface VerifiedSentence {
  text: string;
  cites: string[];
}

export type DropReason =
  | "no_citation"
  | "unknown_source"
  | "unsupported_number"
  | "unsupported_quote"
  | "overclaim"
  | "bad_format";

export interface DroppedSentence {
  text: string;
  reason: DropReason;
  /** Which id, number or phrase failed. */
  detail?: string;
}

export interface VerifyResult {
  kept: VerifiedSentence[];
  dropped: DroppedSentence[];
}

/** What the model says about the question itself. */
export type AiScope = "in_scope" | "off_topic" | "not_in_records";

/** The source as the page shows it behind a cite chip. */
export type PublicSource = Omit<AiSource, "kind"> & { kind: AiSourceKind };

export type AiState =
  /** At least one sentence passed. */
  | "ok"
  /** The question is not about this address's weather hazards. */
  | "off_topic"
  /** The records do not hold an answer, or nothing the model wrote could be verified. */
  | "no_answer";

export interface AiAnswer {
  state: AiState;
  /** Only verified sentences. */
  sentences: VerifiedSentence[];
  /** The cited sources, by id, with their full text. */
  sources: Record<string, PublicSource>;
  /** How many sentences the model wrote that the checks removed. */
  dropped: number;
  /** Plain-language line the page shows for the off-topic and no-answer states. */
  message: string | null;
  /**
   * A fixed line from us (never from the model) shown above the answer when the question asks what WILL happen:
   * "We don't forecast; here is the official outlook and how it has played out here." Absent for other questions.
   */
  lead?: string;
  /** ISO time this answer was made. */
  generatedAt: string;
  model: string;
  /** True if it came from the in-memory cache (no model call). */
  cached: boolean;
  /** Set when this is a real answer made ahead of time for a sample address (data/samples/ai), not one made for this visit. `at` is when. */
  precomputed?: { at: string };
}

/** The error states a request can end in. `resting` and `unavailable` are honest "AI is not answering" states, not failures of the page. */
export type AiErrorState = "resting" | "unavailable" | "rate_limited" | "bad_request" | "error";

export interface AiErrorBody {
  state: AiErrorState;
  message: string;
  /** Seconds to wait, for rate_limited. */
  retryAfter?: number;
}

export const MAX_QUESTION_CHARS = 300;

// ---------------------------------------------------------------- "Your area's story"

/** What an event's narrative can be tagged with. The model proposes; code keeps a tag only if the event's own words say it. */
export const IMPACT_TAGS = ["power_outage", "trees_down", "roads_blocked", "flooding", "structure_damage", "travel_disruption"] as const;
export type ImpactTag = (typeof IMPACT_TAGS)[number];

/** An impact the narrative supports: the words that show it are copied from the event's own text. */
export interface VerifiedImpact {
  eventId: string;
  tag: ImpactTag;
  /** Words copied from the event's narrative that say it. */
  evidence: string;
}

/** One line of the impact summary, written by code from the verified tags ("4 High Wind events: ... power outages"). */
export interface ImpactLine {
  tag: ImpactTag;
  type: string;
  eventIds: string[];
  text: string;
}

export interface StoryAnswer {
  /** ok: at least one sentence passed. no_answer: nothing to tell, or nothing could be verified. */
  state: "ok" | "no_answer";
  /** The county the story is for (it is cached by it). */
  county: string | null;
  /** Verified sentences; each cites event ids (or "area-counts"). */
  sentences: VerifiedSentence[];
  /** The cited sources by id. Events carry the verbatim narrative as `quote`. */
  sources: Record<string, PublicSource>;
  /** The events the story is about, oldest first. */
  eventIds: string[];
  impacts: VerifiedImpact[];
  impactLines: ImpactLine[];
  /** Deaths, injuries and damage across those events, added up by code from the records. Null when all are zero. */
  totalsLine: string | null;
  dropped: number;
  droppedImpacts: number;
  message: string | null;
  generatedAt: string;
  model: string;
  cached: boolean;
  /** Set when this is a real story made ahead of time for a sample address (data/samples/ai). `at` is when. */
  precomputed?: { at: string };
}
