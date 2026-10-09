/**
 * Shapes for "Get ready": a short preparedness plan built from the area's real history. Safe to import from client code.
 */
import type { AiErrorBody } from "../ai/types";

export type HazardId = "flood" | "tornado" | "heat" | "wind" | "winter" | "smoke";

/** One verbatim line from an official page, with the page it came from. */
export interface GuidanceLine {
  /** Stable id the model cites, like "flood-turn-around". */
  id: string;
  hazard: string;
  /** "Ready.gov, Floods" */
  source: string;
  url: string;
  /** Word for word from the page. */
  text: string;
}

/** A local fact the plan cites: a real event (with its NCEI/NWS id) or a number computed from the address's own record. */
export interface LocalFact {
  id: string;
  /** "Flash Flood report, Mar 27, 2021": the "why" line on a plan item. */
  label: string;
  hazard: HazardId;
  /** A page where the record can be checked, if there is one. */
  href?: string;
}

export interface ReadyItem {
  /** What to do, as the AI wrote it and the checks passed it. */
  action: string;
  /** The local facts it cites (at least one). */
  why: LocalFact[];
  /** The official lines it cites (at least one). */
  guidance: GuidanceLine[];
}

/** What the record holds for this address, counted by code (no model). */
export interface HazardSummary {
  id: HazardId;
  label: string;
  /** One plain line with the numbers, like "7 NWS flood reports within 5 km, latest Mar 27, 2021". */
  evidence: string;
}

export type ReadyDropReason = "missing_local_citation" | "missing_guidance_citation" | "unknown_citation" | "unsupported_number" | "unsupported_quote" | "overclaim" | "bad_format";

export interface ReadyDropped {
  action: string;
  reason: ReadyDropReason;
  detail?: string;
}

export interface ReadyPayload {
  /** ok: a plan. empty: nothing in the record to build a personal plan from. problem: the AI is not answering (see `problem`). */
  state: "ok" | "empty" | "problem";
  items: ReadyItem[];
  hazards: HazardSummary[];
  /** Plan items the AI wrote that the checks removed. */
  dropped: number;
  /** A plain line for the empty state, and for gaps in the record (a state not indexed, no area events file). */
  notices: string[];
  problem?: AiErrorBody;
  generatedAt: string;
  model: string;
  cached: boolean;
  /** Set when this is a real plan made ahead of time for a sample address (data/samples/ai). `at` is when. */
  precomputed?: { at: string };
}
