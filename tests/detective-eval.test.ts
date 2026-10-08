import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DETECTIVE_EVAL as E, EVAL_FINE, EVAL_HEADLINE, EVAL_TRADEOFF, PILOT_FOOTNOTE } from "@/lib/detective-eval";

const pct = (x: number) => Math.round(x * 100);
const evalDir = path.join(process.cwd(), "pipeline", "eval");

describe("the detective's pre-registered numbers equal pipeline/eval/score.json", () => {
  it("matches every figure shown on the pages", async () => {
    const score = JSON.parse(await readFile(path.join(evalDir, "score.json"), "utf8"));
    const { baseline, detective } = score;
    expect(baseline.ALL.n).toBe(E.n);
    expect(detective.ALL.n).toBe(E.n);
    expect([pct(baseline.ALL.wrong5), pct(detective.ALL.wrong5)]).toEqual([E.wrong.baseline, E.wrong.detective]);
    expect([pct(baseline.ALL.w1), pct(detective.ALL.w1)]).toEqual([E.within1km.baseline, E.within1km.detective]);
    expect([pct(baseline.ALL.abstain), pct(detective.ALL.abstain)]).toEqual([E.abstain.baseline, E.abstain.detective]);
    expect(score.confidently_wrong).toBe(E.confidentWrong);
    expect(score.discordant).toEqual({ baseline_only_wrong: E.discordant.baselineOnlyWrong, detective_only_wrong: E.discordant.detectiveOnlyWrong });
    expect(score.decision.verdict).toBe("FEWER WRONG PINS, LESS REACH");
    expect(score.decision.complete).toBe(true);
  });

  it("matches the written-up p-value and the pilot in the run log", async () => {
    const log = await readFile(path.join(process.cwd(), "pipeline", "RUN-2026-10-08.md"), "utf8");
    expect(log).toContain("p = 3.0e-8");
    expect(E.mcnemarP).toBe("3e-8");
    expect(log).toContain(`${E.pilot.baseline}% → ${E.pilot.detective}% in the pilot`);
  });
});

describe("the copy", () => {
  it("states the headline and the trade-off in the words Alex asked for", () => {
    expect(EVAL_HEADLINE).toBe("In a pre-registered test on 100 fresh reports, the AI detective cut wrong pins from 28% to 2%.");
    expect(EVAL_TRADEOFF).toBe("It places fewer reports (16% vs 33% within 1 km), because it refuses to guess when a report names only a road.");
    expect(PILOT_FOOTNOTE).toBe("Pilot: 36% → 8%");
  });

  it("reports the fine print honestly: the p-value, the abstain rate, no confident wrong pins, the test's own verdict", () => {
    expect(EVAL_FINE).toContain("McNemar p = 3e-8");
    expect(EVAL_FINE).toContain("79% of reports");
    expect(EVAL_FINE).toContain("No wrong pin was a confident one");
    expect(EVAL_FINE).toContain("fewer wrong pins, less reach");
  });
});
