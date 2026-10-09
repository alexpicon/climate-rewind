import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearSampleAiCache, isSampleAiFile, sampleAiForAddress, sampleAiForPoint, type SampleAiFile } from "@/lib/ai/precomputed";
import { handleAi, type AiDeps } from "@/lib/ai/service";
import { handleStory } from "@/lib/ai/story";
import { PREPARED_ADDRESSES } from "@/lib/ui/prepared";
import { formatPrecomputed } from "@/lib/ui/precomputed-text";

const SHIPPED = path.join(process.cwd(), "data", "samples", "ai");
const answer = (text: string) => ({ state: "ok", sentences: [{ text, cites: ["x"] }], sources: {}, dropped: 0, message: null, generatedAt: "2026-10-09T01:40:00Z", model: "m", cached: false, precomputed: { at: "2026-10-09T01:40:16.964Z" } });

function sampleDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sample-ai-"));
  const file = { slug: "demo", address: "100 James Robertson Pkwy, Nashville, TN", lat: 36.168175, lon: -86.777516, brief: answer("early brief"), story: { ...answer("early story"), county: "TNC037", eventIds: [], impacts: [], impactLines: [], totalsLine: null, droppedImpacts: 0 }, ready: null };
  writeFileSync(path.join(dir, "demo.json"), JSON.stringify(file));
  writeFileSync(path.join(dir, "broken.json"), "{not json");
  process.env.MEMORIA_SAMPLE_AI_DIR = dir;
  clearSampleAiCache();
  return dir;
}

afterEach(() => {
  delete process.env.MEMORIA_SAMPLE_AI;
  process.env.MEMORIA_SAMPLE_AI_DIR = path.resolve(process.cwd(), "tests", "no-samples", "ai");
  clearSampleAiCache();
});

describe("answers made ahead of time for the samples", () => {
  it("finds a sample by its address however it is typed, and by a point within 200 m; an unreadable file is ignored", async () => {
    sampleDir();
    expect((await sampleAiForAddress("100 james robertson pkwy,  Nashville TN"))?.slug).toBe("demo");
    expect(await sampleAiForAddress("200 James Robertson Pkwy, Nashville, TN")).toBeNull();
    expect((await sampleAiForPoint(36.1685, -86.7775))?.slug).toBe("demo");
    expect(await sampleAiForPoint(36.2, -86.8)).toBeNull();
  });

  it("MEMORIA_SAMPLE_AI=off turns it off (the precompute run records live answers)", async () => {
    sampleDir();
    process.env.MEMORIA_SAMPLE_AI = "off";
    expect(await sampleAiForAddress("100 James Robertson Pkwy, Nashville, TN")).toBeNull();
  });

  it("the brief for a sample address comes back at once with no model call, and `fresh` asks for a live one", async () => {
    const dir = sampleDir();
    void dir;
    let modelCalls = 0;
    const deps = {
      client: { messages: { create: async () => (modelCalls += 1, { content: [] }) } },
      limiter: { check: () => ({ ok: true }) },
      budget: { limit: 0, remaining: () => 0 },
      now: () => 0,
      sampleAi: async (address: string) => {
        const file = await sampleAiForAddress(address);
        return file ? { brief: file.brief, story: file.story } : null;
      },
    } as unknown as AiDeps;
    const early = await handleAi({ address: "100 James Robertson Pkwy, Nashville, TN", question: null, ip: "1.1.1.1" }, deps);
    expect(early.status).toBe(200);
    expect((early.body as { precomputed?: unknown }).precomputed).toEqual({ at: "2026-10-09T01:40:16.964Z" });
    expect(modelCalls).toBe(0);
    // a question is never answered from the early brief; `fresh` skips it (here: no budget, so the live path says it is resting)
    const live = await handleAi({ address: "100 James Robertson Pkwy, Nashville, TN", question: null, ip: "1.1.1.1", fresh: true }, deps);
    expect(live.status).toBe(503);
    const story = await handleStory({ address: "100 James Robertson Pkwy, Nashville, TN", ip: "1.1.1.1" }, deps);
    expect(story.status).toBe(200);
    expect((story.body as { sentences: Array<{ text: string }> }).sentences[0].text).toBe("early story");
  });

  it("says when it was made, in UTC", () => {
    expect(formatPrecomputed("2026-10-09T01:40:16.964Z")).toBe("Real answer for this sample address, made Oct 9, 2026, 1:40 AM UTC");
    expect(formatPrecomputed("nonsense")).toBe("For this sample address");
  });
});

describe("the files that ship in data/samples/ai", () => {
  const files = readdirSync(SHIPPED).filter((f) => f.endsWith(".json")).sort();
  const read = (name: string) => JSON.parse(readFileSync(path.join(SHIPPED, name), "utf8")) as SampleAiFile;

  it("are one per prepared address (the samples and the landing page's moments), for the address on the landing page", () => {
    expect(files).toEqual(["asheville.json", "bellevue.json", "flushing.json", "fort-myers.json", "lahaina.json", "mayfield.json", "nashville.json", "rolling-fork.json", "san-antonio.json"]);
    expect(files.map((f) => read(f).address).sort()).toEqual(PREPARED_ADDRESSES.map((s) => s.address).sort());
    for (const f of files) expect(isSampleAiFile(read(f)), f).toBe(true);
  });

  it("hold real, checked answers: every sentence cites a source that is in the file, and each part says when it was made", () => {
    for (const f of files) {
      const file = read(f);
      for (const [name, part] of [["brief", file.brief], ["story", file.story]] as const) {
        expect(part, `${f} ${name}`).not.toBeNull();
        expect(part!.state, `${f} ${name}`).toBe("ok");
        expect(part!.precomputed?.at, `${f} ${name}`).toMatch(/^2026-10-/);
        expect(part!.sentences.length).toBeGreaterThan(0);
        for (const sentence of part!.sentences) {
          expect(sentence.cites.length, `${f} ${name}: ${sentence.text}`).toBeGreaterThan(0);
          for (const id of sentence.cites) expect(Object.keys(part!.sources), `${f} ${name} cites ${id}`).toContain(id);
        }
      }
      expect(file.ready?.state, `${f} plan`).toBe("ok");
      expect(file.ready?.precomputed?.at).toMatch(/^2026-10-/);
      for (const item of file.ready!.items) {
        expect(item.why.length).toBeGreaterThan(0);
        expect(item.guidance.length).toBeGreaterThan(0);
      }
    }
  });
});
