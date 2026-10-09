/**
 * Mann-Kendall trend test and Sen's slope, for a short yearly series (for example days per year with a feels-like high of 90 F or more).
 * Pure functions, no network. A trend is only worth reporting when `p < TREND_P`; otherwise the honest line is "no clear trend yet".
 *
 * Mann-Kendall: S is the number of pairs (earlier, later) where the later value is higher, minus the number where it is lower.
 * With ties the variance is reduced (the standard tie correction). Z has a continuity correction. p is two-sided from the normal curve.
 * Sen's slope: the median of every pairwise slope (later - earlier) / (years apart). It is robust to a few extreme years.
 */

/** A trend is reported only when its two-sided p-value is below this. */
export const TREND_P = 0.05;
/** Fewer years than this and the test has too little to go on. */
export const MIN_TREND_YEARS = 10;

export interface TrendResult {
  /** Number of values used. */
  n: number;
  /** The Mann-Kendall statistic. */
  s: number;
  /** The standard score, with continuity correction. */
  z: number;
  /** Two-sided p-value. */
  p: number;
  /** Sen's slope, in value units per step (per year when the series is yearly). */
  slope: number;
}

/** The normal curve's upper tail beyond |z|, doubled: erfc-based, accurate to about 1e-7 (more than enough for a 0.05 cut). */
export function twoSidedP(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  // Numerical Recipes erfc (Chebyshev fit), fractional error under 1.2e-7.
  const t = 1 / (1 + 0.5 * x);
  const poly = -x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
  const erfc = t * Math.exp(poly);
  return Math.min(1, erfc);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Mann-Kendall plus Sen's slope for values in time order (one per step). Returns null for fewer than 3 values. */
export function mannKendall(values: readonly number[]): TrendResult | null {
  const n = values.length;
  if (n < 3) return null;

  let s = 0;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const diff = values[j] - values[i];
      s += Math.sign(diff);
      slopes.push(diff / (j - i));
    }
  }

  // Tie correction: groups of equal values.
  const groups = new Map<number, number>();
  for (const value of values) groups.set(value, (groups.get(value) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of groups.values()) tieTerm += t * (t - 1) * (2 * t + 5);
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;

  let z = 0;
  if (variance > 0) {
    if (s > 0) z = (s - 1) / Math.sqrt(variance);
    else if (s < 0) z = (s + 1) / Math.sqrt(variance);
  }
  // A series with no variance at all (every value the same) has nothing to test.
  const p = variance > 0 ? twoSidedP(z) : 1;
  return { n, s, z, p, slope: median(slopes) };
}

export type TrendVerdict = "increasing" | "decreasing" | "none";

export interface Trend extends TrendResult {
  verdict: TrendVerdict;
  /** Sen's slope as a change per decade (10 steps). */
  perDecade: number;
}

/** The verdict for a yearly series: a direction only when p is under 0.05 (and there are enough years); otherwise "none". Null if too short to test. */
export function yearlyTrend(values: readonly number[]): Trend | null {
  if (values.length < MIN_TREND_YEARS) return null;
  const result = mannKendall(values);
  if (!result) return null;
  const significant = result.p < TREND_P;
  const verdict: TrendVerdict = !significant ? "none" : result.s > 0 ? "increasing" : result.s < 0 ? "decreasing" : "none";
  return { ...result, verdict, perDecade: result.slope * 10 };
}
