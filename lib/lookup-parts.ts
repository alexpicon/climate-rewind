/**
 * The pure side of the lookup in pieces: what a piece carries and how the page folds it into the payload on screen.
 * No server imports, so the browser can use it.
 */
import type { LookupAddress, LookupPart, LookupPayload, NoticeKey } from "./types";

/** The fields one part of a lookup fills in (and its notices). */
export type LookupPatch = Partial<Omit<LookupPayload, "notices" | "pending">> & { notices?: Partial<Record<NoticeKey, string>> };

/** The payload the page starts from: the address, and a neutral value for every part not read yet (they are listed in `pending`). */
export function emptyPayload(address: LookupAddress, pending: LookupPart[]): LookupPayload {
  return {
    address,
    fema: null,
    live: null,
    floods: { reports: [], tierCounts: { mentioned: 0, about1km: 0, citywide: 0 } },
    stormReplay: null,
    stormNights: [],
    tornadoes: [],
    damage: [],
    heat: null,
    floodTrigger: { status: "unavailable", floodDays: 0, triggerIn: null, history: [], forecast: null, notices: {} },
    coverage: "not yet indexed",
    notices: {},
    areaEvents: null,
    nearestFlood: null,
    nearestTornadoes: [],
    extremes: null,
    quiet: null,
    pending,
  };
}

/** Puts a piece into the payload and takes its name off `pending`. Notices are merged, not replaced. */
export function applyPart(payload: LookupPayload, part: LookupPart, patch: LookupPatch): LookupPayload {
  const { notices, ...rest } = patch;
  return { ...payload, ...rest, notices: { ...payload.notices, ...(notices ?? {}) }, pending: (payload.pending ?? []).filter((p) => p !== part) };
}

