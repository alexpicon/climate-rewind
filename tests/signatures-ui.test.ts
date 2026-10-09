/** The radar's flags on the storm replay (lib/ui/signatures.ts): what is on the map at a moment, the totals, the hail wording. */
import { describe, expect, it } from "vitest";
import type { RadarSignatures } from "@/lib/radar-signatures";
import { hailSize, SIGNATURE_FADE_MS, signatureCounts, signaturesAt } from "@/lib/ui/signatures";

const T0 = Date.parse("2021-03-28T03:05:00Z");
const min = (m: number) => T0 + m * 60_000;
const hail = (m: number, maxIn: number) => ({ t: min(m), lat: 36, lon: -86, maxIn, prob: 100, severeProb: 50, radar: "KHTX" });
const tvs = (m: number) => ({ t: min(m), lat: 36, lon: -87, kind: "TVS", shear: 52, deltaV: 98, radar: "KBNA" });
const night: RadarSignatures = { hail: [hail(0, 1), hail(10, 1.75), hail(40, 0.5)], vortex: [tvs(5), tvs(30)] };

describe("signaturesAt", () => {
  it("shows a flag from its scan, fading over SIGNATURE_FADE_MS, and nothing from the future", () => {
    const at = signaturesAt(night, min(10));
    expect(at.hail.map((h) => [h.item.maxIn, Number(h.fresh.toFixed(3))])).toEqual([[1, Number((1 - 10 / 15).toFixed(3))], [1.75, 1]]);
    expect(at.vortex.map((v) => v.item.t)).toEqual([min(5)]);
    expect(SIGNATURE_FADE_MS).toBe(15 * 60_000);
  });

  it("drops a flag once it has faded", () => {
    expect(signaturesAt(night, min(26)).hail.map((h) => h.item.maxIn)).toEqual([]);
  });
});

describe("signatureCounts and hailSize", () => {
  it("counts what has been flagged so far, with the largest hail estimate", () => {
    expect(signatureCounts(night, min(-1))).toEqual({ hail: 0, largestIn: 0, vortex: 0 });
    expect(signatureCounts(night, min(30))).toEqual({ hail: 2, largestIn: 1.75, vortex: 2 });
  });

  it("words the estimate plainly", () => {
    expect(hailSize(1.75)).toBe("1.75 in");
    expect(hailSize(0.5)).toBe("0.5 in (small)");
    expect(hailSize(0)).toBe("small");
  });
});
