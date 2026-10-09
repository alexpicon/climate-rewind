/**
 * Writes data/projections/<slug>.json for each sample address: the observed decades and trends (Open-Meteo archive) and the projected range
 * (Open-Meteo Climate API, CMIP6 HighResMIP models), and the AI explanation (checked by code), so the four samples never wait on outside services.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --disable-warning=ExperimentalWarning --experimental-transform-types scripts/projections-samples.ts
 *   ... scripts/projections-samples.ts --only bellevue --refresh
 *   ... scripts/projections-samples.ts --no-explain        (numbers only)
 *
 * Safe to run again: a part that is already complete is kept (--refresh fetches it again). Open-Meteo answers 429 with a "daily limit" message
 * until 00:00 UTC; this script stops at that point and says so (exit 1). A per-minute limit is retried with a growing wait.
 * The explanation needs ANTHROPIC_API_KEY in .env.local (never printed); without it the numbers are still written. Node 22.7 or newer; run from the repo root.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, next) {
      if ((s.startsWith("./") || s.startsWith("../")) && !/\\.[cm]?[jt]s$|\\.json$/.test(s)) { try { return await next(s + ".ts", c); } catch {} }
      return next(s, c);
    }`),
);

// .env.local fills in any variable that is missing or empty in the shell. Values are never printed.
try {
  for (const line of readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
} catch {
  // no .env.local
}

const { SAMPLE_ADDRESSES } = await import("../lib/ui/tabs.ts");
const { geocodeAddress } = await import("../lib/sources.ts");
const { slugify } = await import("../lib/index-store.ts");
const { buildObserved } = await import("../lib/climate/observed.ts");
const { archiveUrl, buildProjection, climateUrl, observationsFromArchive, BASELINE_PERIOD, FUTURE_PERIOD } = await import("../lib/climate/projection.ts");
const { explainFuture } = await import("../lib/climate/explain.ts");
const { createAiDeps } = await import("../lib/ai/service.ts");
type FuturePayload = import("../lib/climate/types.ts").FuturePayload;

const flag = (name: string) => process.argv.includes(`--${name}`);
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const only = arg("only");
const refresh = flag("refresh");
const explain = !flag("no-explain");
const OUT_DIR = path.join(process.cwd(), "data", "projections");
const FIRST_YEAR = 2000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const asFetch = (url: string, init?: RequestInit) => fetch(url, init);

class DailyLimit extends Error {}

async function getJson<T>(url: string, label: string): Promise<T> {
  const waits = [5, 20, 60, 120];
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    } catch (error) {
      if (attempt >= waits.length) throw new Error(`${label}: ${String(error)}`);
      await sleep(waits[attempt] * 1000);
      continue;
    }
    if (response.ok) return (await response.json()) as T;
    const body = await response.text();
    if (/daily/i.test(body)) throw new DailyLimit(`${label}: ${body.slice(0, 120)}`);
    if ((response.status === 429 || response.status >= 500) && attempt < waits.length) {
      console.log(`  ${label}: HTTP ${response.status}, waiting ${waits[attempt]} s`);
      await sleep(waits[attempt] * 1000);
      continue;
    }
    throw new Error(`${label}: HTTP ${response.status} ${body.slice(0, 120)}`);
  }
}

const aiDeps = explain ? createAiDeps(process.env) : null;
let incomplete = 0;
let stoppedByLimit = false;

for (const sample of SAMPLE_ADDRESSES) {
  const address = await geocodeAddress(sample.address, asFetch);
  const slug = slugify(address.city ?? sample.label);
  if (only && only !== slug) continue;
  console.log(`\n${slug}: ${address.matched} (${address.lat.toFixed(5)}, ${address.lon.toFixed(5)})`);

  const file = path.join(OUT_DIR, `${slug}.json`);
  const existing: FuturePayload | null = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as FuturePayload) : null;
  const payload: FuturePayload = {
    slug,
    lat: address.lat,
    lon: address.lon,
    built: new Date().toISOString(),
    observed: refresh ? null : (existing?.observed ?? null),
    projected: refresh ? null : (existing?.projected ?? null),
    notices: {},
    explanation: refresh ? undefined : existing?.explanation,
  };
  const lastYear = new Date().getUTCFullYear() - 1;

  try {
    if (payload.observed) {
      console.log("  observed: kept");
    } else {
      const reply = await getJson<Parameters<typeof observationsFromArchive>[0]>(archiveUrl(address.lat, address.lon, FIRST_YEAR, lastYear), "archive");
      payload.observed = buildObserved(observationsFromArchive(reply), `Open-Meteo historical weather archive (ERA5 reanalysis), daily, ${FIRST_YEAR} to ${lastYear}`);
      console.log(`  observed: ${payload.observed ? payload.observed.measures.map((m) => `${m.id}=${m.trend?.verdict ?? "n/a"}`).join(" ") : "NO DATA"}`);
      payload.explanation = undefined;
    }
    if (payload.projected) {
      console.log("  projected: kept");
    } else {
      const base = await getJson<Parameters<typeof buildProjection>[0]>(climateUrl(address.lat, address.lon, BASELINE_PERIOD[0], BASELINE_PERIOD[1]), "climate 2001-2020");
      const future = await getJson<Parameters<typeof buildProjection>[1]>(climateUrl(address.lat, address.lon, FUTURE_PERIOD[0], FUTURE_PERIOD[1]), "climate 2041-2050");
      payload.projected = buildProjection(base, future);
      const p = payload.projected;
      console.log(p ? `  projected: ${p.models.filter((m) => m.baseline !== null).length} models; days >= 90 F: ${p.baseline?.min}-${p.baseline?.max} -> ${p.future?.min}-${p.future?.max}` : "  projected: NO DATA");
      payload.explanation = undefined;
    }
  } catch (error) {
    if (error instanceof DailyLimit) stoppedByLimit = true;
    console.log(`  NOT captured (${(error as Error).message})`);
    incomplete += 1;
  }

  if (!payload.observed) payload.notices.observed = "The weather archive was not read for this sample yet.";
  if (!payload.projected) payload.notices.projected = "The climate models were not read for this sample yet.";

  if (aiDeps && (payload.observed || payload.projected) && !payload.explanation) {
    if (!aiDeps.client) {
      console.log("  explanation: skipped (no ANTHROPIC_API_KEY in .env.local)");
    } else {
      const ran = await explainFuture(payload, aiDeps);
      if (ran.ok && ran.answer.state === "ok") {
        payload.explanation = ran.answer;
        console.log(`  explanation: ${ran.answer.sentences.length} verified sentences, ${ran.answer.dropped} dropped`);
        for (const s of ran.answer.sentences) console.log(`    - ${s.text}`);
      } else {
        console.log(`  explanation: NOT made (${ran.ok ? ran.answer.message : ran.failure.body.message})`);
        incomplete += 1;
      }
    }
  }

  if (payload.observed || payload.projected) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(file, `${JSON.stringify(payload, null, 1)}\n`);
    console.log(`  wrote ${path.relative(process.cwd(), file)}`);
  }
  if (stoppedByLimit) break;
}

if (incomplete > 0) {
  console.log(`\n${incomplete} part${incomplete === 1 ? "" : "s"} not captured.${stoppedByLimit ? " Open-Meteo's daily limit was reached: run this again after 00:00 UTC; finished parts are kept." : ""}`);
  process.exit(1);
}
console.log("\nAll samples are complete.");
