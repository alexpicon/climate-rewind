/**
 * Writes data/samples/ai/<slug>.json for each sample address: the real AI brief, story and plan, made by running the app's own endpoints once.
 * The sample clicks then show them at once (lib/ai/precomputed.ts), labelled "computed ahead of time" with the time they were made.
 *
 *   1. Start the app with the answers-ahead-of-time switch OFF (so it records live ones) and the real key in .env.local:
 *        MEMORIA_SAMPLE_AI=off env -u ANTHROPIC_API_KEY npx next start -p 3702
 *   2. npm run precompute-ai -- --base http://127.0.0.1:3702            (all four)
 *      npm run precompute-ai -- --base http://127.0.0.1:3702 --only nashville
 *
 * A part is saved only when the checks passed at least one sentence (state "ok" / a plan with items). Anything else is reported and the part
 * is left as it was (null if there was none), never filled with a made-up answer. The brief opens with live alerts and the next three days, so it
 * goes stale: the page shows its time and asks for a fresh one; run this again before a demo to refresh it. Needs Node 22.7 or newer.
 */
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const base = (arg("base") ?? "http://127.0.0.1:3702").replace(/\/$/, "");
const only = arg("only");
const SAMPLES = path.join(process.cwd(), "data", "samples");
const OUT = path.join(SAMPLES, "ai");
mkdirSync(OUT, { recursive: true });

interface Snapshot {
  slug: string;
  address: string;
  lat: number;
  lon: number;
}

const slugs = ["nashville", "san-antonio", "asheville", "bellevue"].filter((slug) => !only || slug === only);
let failed = 0;

async function call(label: string, url: string, init?: RequestInit): Promise<Record<string, unknown> | null> {
  const started = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
    const body = (await response.json()) as Record<string, unknown>;
    console.log(`  ${label}: HTTP ${response.status}, state ${String(body.state ?? "")}, ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return response.ok ? body : null;
  } catch (error) {
    console.log(`  ${label}: failed (${(error as Error).message})`);
    return null;
  }
}

for (const slug of slugs) {
  const snapshot = JSON.parse(readFileSync(path.join(SAMPLES, `${slug}.json`), "utf8")) as Snapshot;
  console.log(`${slug}: ${snapshot.address}`);
  const file = path.join(OUT, `${slug}.json`);
  const kept = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  const at = new Date().toISOString();
  const post = (path_: string) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: snapshot.address }) });

  const brief = await call("brief", `${base}/api/brief`, post("brief"));
  const story = await call("story", `${base}/api/story`, post("story"));
  const stateCode = snapshot.address.match(/,\s*([A-Z]{2})\s*$/)?.[1] ?? "";
  const ready = await call("plan", `${base}/api/ready?lat=${snapshot.lat}&lon=${snapshot.lon}&state=${stateCode}`);

  const okBrief = brief && brief.state === "ok" && Array.isArray(brief.sentences) && brief.sentences.length > 0;
  const okStory = story && story.state === "ok" && Array.isArray(story.sentences) && story.sentences.length > 0;
  const okReady = ready && ready.state === "ok" && Array.isArray(ready.items) && ready.items.length > 0;
  if (!okBrief || !okStory || !okReady) failed += 1;

  const stamp = (part: Record<string, unknown>) => ({ ...part, cached: false, precomputed: { at } });
  writeFileSync(
    file,
    JSON.stringify(
      {
        slug,
        address: snapshot.address,
        lat: snapshot.lat,
        lon: snapshot.lon,
        brief: okBrief ? stamp(brief!) : (kept.brief ?? null),
        story: okStory ? stamp(story!) : (kept.story ?? null),
        ready: okReady ? stamp(ready!) : (kept.ready ?? null),
      },
      null,
      1,
    ) + "\n",
  );
  console.log(`  saved ${path.relative(process.cwd(), file)}: brief ${okBrief ? "ok" : "KEPT/none"}, story ${okStory ? "ok" : "KEPT/none"}, plan ${okReady ? "ok" : "KEPT/none"}`);
}

if (failed) {
  console.log(`${failed} sample(s) have a part that was not saved. Run again, or check the key and the daily AI allowance.`);
  process.exit(1);
}
