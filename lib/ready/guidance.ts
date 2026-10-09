/**
 * The curated guidance corpus: short lines copied word for word from official pages (ready.gov, weather.gov, airnow.gov), each with its URL.
 * data/guidance/guidance.json. The plan may only point to these; nothing here is written by a model.
 */
import file from "../../data/guidance/guidance.json";
import type { GuidanceLine } from "./types";

interface GuidanceFile {
  retrieved: string;
  lines: GuidanceLine[];
}

export const GUIDANCE_RETRIEVED: string = (file as GuidanceFile).retrieved;
export const GUIDANCE: readonly GuidanceLine[] = (file as GuidanceFile).lines;

const byId = new Map(GUIDANCE.map((line) => [line.id, line]));

export const guidanceById = (id: string): GuidanceLine | undefined => byId.get(id);
