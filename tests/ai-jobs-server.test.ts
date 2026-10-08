import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { countDamagePlaces, loadAiJobs, loadBriefEval } from "@/lib/ai-jobs-server";

const tmp = () => mkdtempSync(path.join(tmpdir(), "aijobs-"));

describe("reading the files behind the AI jobs list", () => {
  it("says pending for the briefing and the damage mapper when there are no files", async () => {
    const dir = tmp();
    const jobs = await loadAiJobs(false, dir);
    expect(jobs.find((j) => j.id === "briefing")).toMatchObject({ status: "pending", number: null });
    expect(jobs.find((j) => j.id === "damage")).toMatchObject({ status: "pending", number: null });
    expect(await loadBriefEval(dir)).toBeNull();
    expect(await countDamagePlaces(dir)).toBe(0);
  });

  it("reads the 20-question test result and the damage map's count", async () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "ai-eval"));
    mkdirSync(path.join(dir, "damage"));
    writeFileSync(path.join(dir, "ai-eval", "brief.json"), JSON.stringify({ ranAt: "2026-10-08T20:00:00Z", model: "claude-sonnet-5-5", questions: 20, addresses: 4, sentencesWritten: 50, sentencesVerified: 45, passPercent: 90, dropped: { unsupported_number: 5 } }));
    writeFileSync(path.join(dir, "damage", "TN.json"), JSON.stringify([{}, {}, {}]));
    writeFileSync(path.join(dir, "damage", "NC.json"), "not json");
    const jobs = await loadAiJobs(true, dir);
    expect(jobs.find((j) => j.id === "briefing")?.number).toContain("90% of the sentences");
    expect(jobs.find((j) => j.id === "damage")?.detail).toContain("3 damage places");
  });

  it("ignores a result file that is not in the expected shape", async () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "ai-eval"));
    writeFileSync(path.join(dir, "ai-eval", "brief.json"), JSON.stringify({ passPercent: "high" }));
    expect(await loadBriefEval(dir)).toBeNull();
  });
});
