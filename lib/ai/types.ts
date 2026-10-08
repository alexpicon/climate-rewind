/**
 * Shapes shared by the AI briefing / "Ask your street" code and its UI. Safe to import from client code.
 *
 * The idea in one line: the model may only write sentences that cite sources we built from real data, and code (not the model)
 * checks every citation and every number before anything is shown. See lib/ai/verify.ts.
 */

export type AiSourceKind = "outlook" | "record" | "report" | "history" | "tornado" | "damage" | "heat" | "trigger" | "alert" | "fema";

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
  /** ISO time this answer was made. */
  generatedAt: string;
  model: string;
  /** True if it came from the in-memory cache (no model call). */
  cached: boolean;
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
