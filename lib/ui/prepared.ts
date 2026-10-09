/**
 * The addresses the app prepares ahead of time: the four landing samples and the landing page's moments. For each, the build scripts
 * save the slow outside data (scripts/snapshot-samples.ts), the climate projections (scripts/projections-samples.ts) and the AI's
 * answers (scripts/precompute-ai.ts), so a click on them is instant and does not spend the free allowances. Any address within 200 m of
 * a saved one reads its files (lib/samples.ts, lib/ai/precomputed.ts).
 */
import { LANDING_MOMENTS } from "./landing-moments";
import { SAMPLE_ADDRESSES } from "./tabs";

export interface PreparedAddress {
  address: string;
  /** "Nashville, TN" or "Mayfield, Kentucky": a fallback name when the geocoder gives no city. */
  label: string;
}

export const PREPARED_ADDRESSES: readonly PreparedAddress[] = [
  ...SAMPLE_ADDRESSES.map((s) => ({ address: s.address, label: s.label })),
  ...LANDING_MOMENTS.map((m) => ({ address: m.address, label: m.kicker.split(" · ")[1] ?? m.id })),
];
