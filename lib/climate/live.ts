/**
 * "What's changing here" for any point: the observed record (Open-Meteo archive) and the climate-model projection (Open-Meteo Climate API),
 * fetched live, kept in memory by 0.05 degree cell, and degraded honestly: each half can fail on its own and says why. The four sample
 * addresses are served from files made ahead of time (see scripts/projections-samples.ts). Server only.
 */
import { describeFailure, fetchJson, type FetchLike } from "../http";
import { haversineKm } from "../geo";
import { gridKey, LruCache } from "../lru";
import { buildObserved } from "./observed";
import { archiveUrl, buildProjection, climateUrl, observationsFromArchive, BASELINE_PERIOD, FUTURE_PERIOD, type ArchiveReply, type ClimateReply } from "./projection";
import type { FuturePayload } from "./types";
import { loadFutureSamples } from "./samples";

/** First year of the observed record. */
export const OBSERVED_FIRST_YEAR = 2000;
/** A lookup within this distance of a sample address reads that sample's file. */
export const SAMPLE_RADIUS_M = 200;

const DAY_MS = 24 * 60 * 60 * 1000;
const complete = new LruCache<FuturePayload>(200, DAY_MS);
/** A half-failed answer (one source down) is kept briefly so a busy page does not hammer a source that just said no. */
const partial = new LruCache<FuturePayload>(200, 5 * 60_000);
const running = new Map<string, Promise<FuturePayload>>();

export function clearFutureCache(): void {
  complete.clear();
  partial.clear();
  running.clear();
}

export interface FutureDeps {
  fetch: FetchLike;
  now: () => Date;
}

const defaultDeps: FutureDeps = { fetch: (url, init) => fetch(url, init), now: () => new Date() };

/** Fetches and assembles both halves for a cell centre. Never throws. */
export async function computeFuture(lat: number, lon: number, deps: FutureDeps = defaultDeps): Promise<FuturePayload> {
  const lastYear = deps.now().getUTCFullYear() - 1;
  const [archive, base, future] = await Promise.all([
    fetchJson<ArchiveReply>(deps.fetch, archiveUrl(lat, lon, OBSERVED_FIRST_YEAR, lastYear)),
    fetchJson<ClimateReply>(deps.fetch, climateUrl(lat, lon, BASELINE_PERIOD[0], BASELINE_PERIOD[1])),
    fetchJson<ClimateReply>(deps.fetch, climateUrl(lat, lon, FUTURE_PERIOD[0], FUTURE_PERIOD[1])),
  ]);

  const notices: FuturePayload["notices"] = {};
  let observed = null;
  if (archive.ok) {
    observed = buildObserved(observationsFromArchive(archive.data), `Open-Meteo historical weather archive (ERA5 reanalysis), daily, ${OBSERVED_FIRST_YEAR} to ${lastYear}`);
    if (!observed) notices.observed = "The weather archive had no usable daily data for this address.";
  } else {
    notices.observed = describeFailure("The Open-Meteo weather archive", archive);
  }

  let projected = null;
  if (base.ok && future.ok) {
    projected = buildProjection(base.data, future.data);
    if (!projected) notices.projected = "The climate models had no usable data for this address.";
  } else {
    const failed = !base.ok ? base : (future as Extract<typeof future, { ok: false }>);
    notices.projected = describeFailure("The Open-Meteo climate model service", failed as Extract<typeof base, { ok: false }>);
  }

  return { slug: null, lat, lon, built: deps.now().toISOString(), observed, projected, notices };
}

/** True when the numbers for this point need no outside call (a sample address, or a cell already read), so a request for them costs us nothing. */
export async function hasFuture(lat: number, lon: number, deps: FutureDeps = defaultDeps): Promise<boolean> {
  for (const sample of await loadFutureSamples()) {
    if (haversineKm([lat, lon], [sample.lat, sample.lon]) * 1000 <= SAMPLE_RADIUS_M) return true;
  }
  const key = gridKey(lat, lon).key;
  const now = deps.now().getTime();
  return Boolean(complete.get(key, now) ?? partial.get(key, now) ?? running.get(key));
}

/** The numbers for a point: a sample file if it is one of the four sample addresses, else the cache, else live. */
export async function getFuture(lat: number, lon: number, deps: FutureDeps = defaultDeps): Promise<FuturePayload> {
  for (const sample of await loadFutureSamples()) {
    if (haversineKm([lat, lon], [sample.lat, sample.lon]) * 1000 <= SAMPLE_RADIUS_M) return sample;
  }
  const cell = gridKey(lat, lon);
  const now = deps.now().getTime();
  const hit = complete.get(cell.key, now) ?? partial.get(cell.key, now);
  if (hit) return hit;
  const pending = running.get(cell.key);
  if (pending) return pending;

  const job = computeFuture(cell.lat, cell.lon, deps)
    .then((payload) => {
      (payload.observed && payload.projected ? complete : partial).set(cell.key, payload, deps.now().getTime());
      return payload;
    })
    .finally(() => running.delete(cell.key));
  running.set(cell.key, job);
  return job;
}

/** The cell key an explanation is cached under, so the same cell gets one model call. */
export const futureKey = (lat: number, lon: number): string => gridKey(lat, lon).key;
