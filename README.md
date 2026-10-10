# Climate Rewind

**Climate change, measured at your address.** Type a US street address and see what the weather did there since 2000
(floods, tornadoes, heat, wind, ice, lightning, from National Weather Service records), how often dangerous heat and heavy rain
come now compared with the 2000s, and what climate models (CMIP6) say the 2040s could look like.
ForgeHacks 2026 (AI + Climate). **Built during ForgeHacks 2026 (Oct 7–10).**

- The record: every storm night replayed on real NEXRAD radar, the heat wave, the tornado tracks.
- The change: then (2000s) → now (2016–2025) → 2040s (the range across climate models, not a forecast), for any address.
- The AI: re-files imprecise reports, maps damage, and writes cited sentences that code verifies. It never has the last word.

- Live demo: https://climaterewind.com
- Video: <coming>

## Results

Every number below is read from a file in this repository.

- **The AI flood detective (pre-registered, 100 fresh reports):** wrong pins (more than 5 km off) fell from **28% to 2%** (exact McNemar p = 3e-8). The trade-off is reach: **16% vs 33% within 1 km**, because it abstains rather than guess when a report names only a road. See [`pipeline/eval/`](pipeline/eval/) ([protocol](pipeline/eval/PREREG.md), [scores](pipeline/eval/score.json)) and the table under "The AI detective's pre-registered test".
- **The damage mapper:** extraction **precision 0.98, recall 0.86** on 5 hand-labelled NWS damage surveys (72 labelled places; 45 pinned). Gold labels and scoring: [`pipeline/eval/damage_gold.json`](pipeline/eval/damage_gold.json), [`pipeline/eval/score_damage.py`](pipeline/eval/score_damage.py).
- **The brief verifier:** **98.5%** of the AI's written sentences passed code verification (66 of 67, over the fixed 20 questions at 4 addresses); the dropped sentence is shown as dropped, never rewritten. [`data/ai-eval/brief.json`](data/ai-eval/brief.json).
- **CMIP6 projections** (`data/projections/<slug>.json`, Open-Meteo Climate API, seven HighResMIP models, a high-emissions path): at all 10 prepared addresses the middle model has more 90°F air-temperature days a year in 2041–2050 than in 2001–2020 (Bellevue 4.1 → 8.9, Portland 20.0 → 28.2, Nashville 53.7 → 75.8), and the models disagree, so the page shows the range. In the 26-year weather record, a Mann-Kendall trend with p < 0.05 shows at 2 of the 10 (Fort Myers, Portland); everywhere else it says "no clear trend yet". These are not forecasts.
- **The forecaster experiment (a negative result we kept):** a flood model trained on 2016–22 beat the official outlook by Brier skill **+3.5%** only when it was given the day's observed rain (hindsight); with only what is known in advance it scored **0.0%**. So we did not ship a forecast, and explain the official ones instead. [`docs/forecast-experiment.md`](docs/forecast-experiment.md).

**Honesty first.** Real data is real; anything that is not is tagged SAMPLE. It shows NWS reports we could
place near you, not every flood. We make no forecast of our own (the next-72-hours outlooks are the National Weather Service's, and the AI only explains them), and we never fake an alert.

## Architecture overview

```
 browser (Next.js App Router, MapLibre)                    server (Next route handlers, no database)
 ┌────────────────────────────────────┐   address    ┌──────────────────────────────────────────────────────────────┐
 │ landing → one search box + samples │ ───────────▶ │ /api/lookup  Census geocode, then in parallel:               │
 │ tabs: 72 hours · storm · heat ·    │              │   FEMA zone · NWS alerts · heat (Open-Meteo, else NASA POWER)│
 │       tornadoes · how it works     │ ◀─────────── │   flood trigger (rain: ERA5, else NASA POWER; NWS forecast)  │
 │ every view = f(progress p, data)   │   payload    │   state index (data/index/<ST>.json.gz): floods, tornadoes   │
 └────────────────────────────────────┘              ├──────────────────────────────────────────────────────────────┤
        │ POST address (+ question)                  │ /api/outlook  WPC flood, SPC tornado, NWS HeatRisk at a point │
        ▼                                            │ /api/brief, /api/ask                                          │
   verified sentences + cite chips  ◀──────────────  │   build sources from the address's own data (lib/ai/sources) │
                                                     │   one model call (structured JSON) → code verifies EVERY     │
                                                     │   sentence (lib/ai/verify) → only verified sentences leave   │
                                                     │   guards: rate limit · token budget · caches · same-origin   │
                                                     └──────────────────────────────────────────────────────────────┘
 offline (Python, pipeline/): NCEI + IEM → per-state index · AI flood detective (re-files imprecise reports) · AI damage mapper
```

Three ideas run through it. **Real data or a label:** anything not real is tagged SAMPLE, and outside the states we have indexed the app says "we have not indexed X yet" instead of "no floods". **The model never has the last word:** it only rewrites facts we already hold, and code drops any sentence whose citation, number or quotation is not in a cited source. **Every outside call can fail:** each has an 8 second timeout and an honest notice, and the heat and rain history fall back from Open-Meteo to NASA POWER (labelled as such on the page). The file-by-file map is under "Architecture" below.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000   (a predev step copies MapLibre's worker into public/vendor)
npm test             # vitest, no network
npm run typecheck    # tsc --noEmit
npm run build && npm start
```

**Secrets.** Copy `.env.example` to `.env.local` and paste your `ANTHROPIC_API_KEY` (git-ignored; never sent to the browser). Gotcha: a variable the shell already defines wins over `.env.local`, **even when it is empty**. If your shell exports `ANTHROPIC_API_KEY=` (some tools do), `npm run dev` / `npm start` see no key and the AI shows "not available". The server treats an empty value as unset, but Next does not expose the `.env.local` value in that case, so there is no fallback. Fix: `unset ANTHROPIC_API_KEY` in that shell, or start with `env -u ANTHROPIC_API_KEY npm run dev`. (`npm run eval-brief` reads `.env.local` itself and is not affected.) On Vercel, set `ANTHROPIC_API_KEY` and `AI_DAILY_TOKEN_BUDGET` in the project's environment variables.

**Spend cap.** `AI_DAILY_TOKEN_BUDGET` (default 3,000,000 tokens a UTC day, about 750 briefs; `0` switches the AI off) is only a per-server-instance ceiling: on a serverless host every warm instance counts separately, so it is not a bill cap. **The real safety net is the monthly spend limit you set on the API key in the Anthropic console** (Settings, Limits). Set it before the demo goes public.

Try `/?address=100+James+Robertson+Pkwy,+Nashville,+TN` or the API directly:
`/api/lookup?address=100+James+Robertson+Pkwy,+Nashville,+TN`. Every view has a shareable URL
(`?address=...&tab=ahead|storm|heat|tornado|how`; with no `tab`, a lookup opens on `ahead`).

## What it shows

| Tab | What you see |
| --- | --- |
| Next 72 hours | The AI brief (every sentence checked in code against a cited source), the official outlooks made local (WPC Excessive Rainfall Outlook, SPC tornado probability, NWS HeatRisk, the NWS feels-like forecast), under each one "how this has played out here" (counts of past days at the address), and "Ask your street". See "The AI briefing" below. |
| Storm replay | IEM NEXRAD frames every 5 minutes for the busiest flood night near the address (a "Storm nights" picker offers the 5 busiest within 15 km plus any night newer than 2023 with 2 or more reports), one image per frame, playback starting once the first 12 are in while the rest load ahead, with each NWS flood report appearing at the minute it was filed. Step 2: where the AI detective has results, reports the NWS pinned to one city point are re-filed where their own words say, with the words highlighted; where it has not run, step 2 says so and shows the nearby reports as filed, with their precision tiers. |
| Heat wave | The address's own daily feels-like highs (Open-Meteo; if Open-Meteo is rate limited, a heat index from NASA POWER (MERRA-2) instead, and the page says so): the hottest day, and a chart of days at 100 F or more per year. If `data/heat/<city>.json` exists for that week (Nashville, Asheville, San Antonio and Bellevue ship), a regional replay of 875 squares (0.5 degrees each) around the address. |
| Tornadoes | Every tornado track within 10 km draws on with a vortex and its damage swath, with the NWS's own damage narrative, ending on the closest pass. |
| How it works | Each AI job with its measured number (or "pending"), the flood detective in four steps with its pre-registered result, the flood forecaster we trained and set aside (a small chart), and what is real versus sample. |

**Your street's flood trigger** (storm tab card, and one line in the live drawer): the typical (median) rain (Open-Meteo archive, ERA5 `precipitation_sum`, or NASA POWER `PRECTOTCORR` for any dates Open-Meteo cannot give, labelled on the card; the larger of the day and the day before) on days with flood reports within 5 km, "on days with flood reports here, the typical rain was X in", compared with the NWS gridded forecast (`api.weather.gov` points, then `quantitativePrecipitation`, per local day for the next 3 days). The forecast is below (under 80% of the median), near (within 20%) or above (over 120%). It needs 3 or more flood dates, otherwise it says "Not enough history at this address yet." A history-based signal, never "will flood". It is the additive `floodTrigger` field of `/api/lookup`.

**3D view** (optional, off by default, storm replay and tornado tabs, `?view=3d`): a "3D" toggle tilts the map to about 60 degrees with terrain from AWS Terrarium elevation tiles and extruded buildings from OpenFreeMap vector tiles (both keyless). Radar, reports, tornado swaths and pins sit on the terrain. Reduced motion skips the slow fly-in.

The top bar also holds a small live strip (green when quiet, red only for a real active NWS warning) that opens a
drawer with the alert outline, the NWS's own storm motion, and optional live radar.

## The AI briefing, "Ask your street" and the track record

`POST /api/brief {address}` and `POST /api/ask {address, question}` (question at most 300 characters). The server rebuilds the context from the address's own data (never from anything the browser sends): flood reports with ids and verbatim quotes, the detective's placements, tornado narratives, the damage mapper's places (`data/damage/<ST>.json`) if present, the official outlooks and the local record, the heat history, the flood trigger, FEMA and the live alerts. Each piece is a source with an id (`lib/ai/sources.ts`).

It calls `claude-sonnet-5-5` with structured JSON output (`{scope, sentences[{text, cites[]}]}`, thinking off), then **code verifies every sentence** (`lib/ai/verify.ts`) and only the verified ones are shown, each with chips that open the source:
1. at least one citation, 2. every cited id exists in the context, 3. every number in the sentence (digits or words) appears in a cited source, 4. every quotation appears word for word in a cited source, 5. no overclaims ("will flood", "we predict", "you are safe", "no chance of"), 6. plain text only.
Percentages and totals are worked out in code and written into the sources, so the model copies and never calculates. Report text is untrusted data: angle brackets are stripped, it sits inside `<source>` tags, the system prompt says never to follow it, and the verifier is the real defence. Off-topic questions get our fixed refusal line, not the model's words.

**Coverage.** For an address in a state we have not indexed (Denver, Washington DC), the context holds one source, "We have not indexed Colorado yet, so we cannot say whether floods or tornadoes were reported here.", and the verifier treats that as the only allowed statement about the past: "no floods", "no tornadoes", "nothing reported" and every other all-clear is dropped. A question about what *will* happen ("will my street flood tomorrow?") gets our own fixed line first, "We don't forecast; here is the official outlook and how it has played out here.", then whatever the model can back with the outlook and the record.

Guardrails (`lib/ai/guard.ts`, `lib/ai/service.ts`): about 10 requests a minute per IP (429 with `Retry-After`), server-side answer caches (the 72-hour brief for 60 minutes, by address and a hash of the alerts active now, so new alerts make a new brief; a question for 10 minutes, by address and question; identical requests in flight share one model call), a hard per-day token budget from `AI_DAILY_TOKEN_BUDGET` (default 3,000,000, `0` switches the AI off; input plus output tokens, resets 00:00 UTC; a per-instance ceiling, **the Anthropic console spend cap is the real safety net**) with an honest "The AI is resting" state, a same-origin check, and a 503 "not available" state when `ANTHROPIC_API_KEY` is missing. The limiter, cache and budget live in server memory, so on a serverless host each warm instance has its own. The key is read only by `lib/ai/service.ts` (server) and is never sent to the browser.

`npm run eval-brief` runs the fixed 20-question test (5 per sample address) for real and writes `data/ai-eval/brief.json`, which "How it works" reads: the share of written sentences that pass verification, and the drops by reason.

**Official outlooks and the local record** (`GET /api/outlook?lat=&lon=`, `lib/outlooks.ts`): WPC Excessive Rainfall Outlook and SPC tornado probability from IEM `api/1/nws/outlook_by_point.json` (Days 1 to 3; Day 3 only has a combined any-severe probability), NWS HeatRisk from the NWS ArcGIS ImageServer point query, and the NWS gridpoint `apparentTemperature` for the feels-like forecast. For the four sample addresses `data/outlook-record/<slug>.json` (built by `scripts/outlook-record.py` from the IEM bulk outlook archives and `data/index`) says how those outlooks played out there: for each ERO category, on how many days a flood was reported within 10 km (counted per NWS outlook day, 12Z to 12Z, since Oct 2016; WPC redefined the categories on Feb 10, 2022 and the file keeps both eras); for each SPC tornado probability, on how many days a tornado track passed within 25 miles; and the daily feels-like history since 2000 for ranking the forecast. These are counts of past days with a stated n, never "our prediction". Re-run `scripts/outlook-record.py` when `data/index` changes (placements move reports). Other addresses show the official outlooks only.

The product name is one constant: `lib/brand.ts` (`APP_NAME`).

## Data sources (all keyless)

US Census geocoder (street addresses only), FEMA NFHL flood zones (ArcGIS REST, layer 28), api.weather.gov alerts,
Open-Meteo archive (daily `apparent_temperature_max`, 2000 to last year; daily `precipitation_sum` for the flood trigger), NASA POWER (MERRA-2; no key; the fallback when Open-Meteo answers 429 or fails: daily `T2M_MAX` with humidity from `QV2M` and `PS` (`RH2M` if those are missing) turned into a heat index with the NWS Rothfusz formula, and `PRECTOTCORR` for rain; days in local solar time), api.weather.gov gridpoint forecasts, IEM outlook-by-point and bulk outlook archives, NWS HeatRisk (ArcGIS ImageServer), Anthropic API (the AI briefing, server side only), AWS Terrarium terrain tiles and OpenFreeMap building tiles (3D view only), IEM NEXRAD through its time-enabled WMS (`n0q-t.cgi`, layer `nexrad-n0q-wmst`, one 8-bit PNG per 5-minute frame, about 45 KB),
NCEI Storm Events and IEM Local Storm Reports (through the per-state index below), Esri World Dark Gray basemap.
Each external call has an 8 second timeout and degrades to `null` plus a plain-language notice.

## Architecture

```
app/page.tsx                     server component: reads ?address & ?tab, renders the client shell
app/api/lookup/route.ts          GET /api/lookup, thin wrapper over lib/lookup.ts
app/api/outlook/route.ts         GET /api/outlook: official outlooks at a point plus the local record
app/api/brief/route.ts, ask/     POST: the verified AI brief and answers (lib/ai/*)
app/api/alerts/route.ts          just the live alerts (the 5-minute refresh and "Check again")
app/api/heat/[slug]/route.ts     regional heat grid from data/heat/<slug>.json
lib/lookup.ts                    flood filter and tiers, replay-night selection, tornado distance, heat summary, orchestration
lib/sources.ts                   Census, FEMA, NWS, Open-Meteo (injectable fetch, 8 s timeouts)
lib/nasa-power.ts                NASA POWER fallback for heat (heat index) and rain, when Open-Meteo fails
lib/states.ts                    state names for plain-language messages
lib/outlooks.ts, outlook-record.ts   official outlooks at a point, the sample addresses' track record, heat ranking
lib/ai/                          sources (the data the model may cite), verify (the code checks), guard (rate limit, budget, cache), service, prompt
lib/brand.ts                     the product name, in one place
lib/flood-trigger.ts             the street's flood trigger: rain on flood dates, the NWS forecast per local day, the comparison
lib/ui/terrain3d.ts              the optional 3D view: terrain, buildings, camera helpers
lib/index-store.ts               loads data/index/<ST>.json.gz (cached) and data/heat/<slug>.json
lib/geo.ts, lib/types.ts         haversine, point-to-segment distance, contract types
lib/ui/*                         pure helpers for the views (text, placements, storm/tornado/heat models) with tests
components/                      the client UI: top bar, panels, dock, map, and one folder per view
components/views/*/*-scene.ts    the imperative MapLibre code for each animation, driven by a progress value p
tests/                           vitest: lookup logic with fixtures, UI models, rendered panels; nothing touches the network
tests/fixtures/index/TN.json.gz  development FIXTURE for tests only (see below)
data/index/<ST>.json.gz          the pipeline's real indexes: TN, TX, NC, MO, AZ, GA, WA
data/heat/<slug>.json            regional heat grids (nashville, asheville, san-antonio), converted from the pipeline
pipeline/                        the data pipeline (Python): builds the indexes and heat grids, the AI detective, its eval
lib/heat-convert.ts              pipeline heat file -> HeatGrid (tested); `npm run convert-heat` is its CLI (scripts/convert-heat.ts)
scripts/outlook-record.py        builds data/outlook-record/<slug>.json (Python: geopandas, shapely; see its header)
scripts/eval-brief.ts            the 20-question test of the AI briefing (npm run eval-brief)
scripts/build-fixture.py         rebuilds the TN test fixture from real NWS rows
```

Each animated view is a pure function of one progress value `p` (0 to 1), so playing, pausing, scrubbing, reduced
motion and screenshots all take the same code path.

## Data contract

`CONTRACT.md` defines the per-state index (`data/index/<ST>.json.gz`, produced by the pipeline) and the lookup payload.
The payload also carries a few additive fields: `coverage` (`indexed`, `fixture` or `not yet indexed`), `notices`
(why a source is empty), `address.city`, `heat.regionalSlug`, `stormReplay.bounds` and `stormReplay.reports`
(the radar box and every report in it, so the map can draw the region), `NearbyTornado.closest`, and alert `id`,
`severity` and `urgency`.

**The indexes are the pipeline's real output** (built Oct 7 2026, six states, plus Washington added Oct 8, NCEI Storm Events and IEM LSRs 2015 to 2025,
verbatim text and the NWS's own coordinates). The AI detective has since run around the sample addresses (110 of 364 imprecise
reports re-filed, the rest "I don't know") and the landing page's moments (21 of 130, near Mayfield, Rolling Fork, Flushing and
Fort Myers); `placed` and `detective` are null for reports it has not run on. These
re-filings are not scored against the truth for the shipped areas. The scored result is the pre-registered test below.

- Where the detective has not run for an area, step 2 says "The AI detective hasn't run for this area yet", shows the
  nearby reports as filed and their precision tiers. Nothing moves.
- The hand-made Nashville placements (`lib/ui/placements.ts`) are tagged SAMPLE everywhere they appear.

### The AI detective's pre-registered test

> In a pre-registered test on 100 fresh reports, the AI detective cut wrong pins from 28% to 2%.
> It places fewer reports (16% vs 33% within 1 km), because it refuses to guess when a report names only a road.

| 100 fresh NWS reports, true locations hidden | No AI (baseline) | AI detective |
| --- | --- | --- |
| Wrong pins, more than 5 km off (primary) | 28% | 2% |
| Within 1 km (reach) | 33% | 16% |
| Abstained ("I don't know") | 10% | 79% |

Exact McNemar test on the discordant pairs: 26 reports wrong only without AI, 0 wrong only with it, p = 3e-8. No wrong pin was
a confident one. The pre-registered verdict is "fewer wrong pins, less reach", so the two claims always appear together.
Pilot: 36% → 8% (an earlier pilot on records already seen once; not pre-registered).

- [Protocol, committed before the run](pipeline/eval/PREREG.md) (the git history shows the order: the "Pre-register the detective re-test" commit, 14:25 PDT on Oct 8, then the first output at 14:30)
- [Scores](pipeline/eval/score.json) and [the run write-up](pipeline/RUN-2026-10-08.md#pre-registered-eval-result)
- [Sample manifest](pipeline/eval/sample_manifest.json), [baseline output](pipeline/eval/out_baseline.jsonl), [detective output](pipeline/eval/out_detective.jsonl), [code hashes at run time](pipeline/eval/code_hashes_at_run.txt)

The numbers on the pages live in one constant, `lib/detective-eval.ts`; `tests/detective-eval.test.ts` fails if it stops matching `pipeline/eval/score.json`.

`tests/fixtures/index/TN.json.gz` is a small hand-built development fixture (`"fixture": true`), used only by tests.

### Refreshing the data

```bash
cd pipeline && ../../memoria-pipeline/.venv/bin/python build_index.py --states TN,TX,NC,MO,AZ,GA   # or any venv with requirements.txt
MEMORIA_DATA_DIR=../data python build_index.py --offline --states ...                                # write straight into ../data
python heat_grid.py --slug san-antonio --lat 29.424796 --lon -98.494679                              # -> pipeline/out/heat/san-antonio.json
cd .. && npm run convert-heat -- --in pipeline/out/heat/san-antonio.json --place "San Antonio"     # -> data/heat/san-antonio.json
```

**Sample snapshots (Open-Meteo's free daily limit).** A 26-year heat request costs about 680 of Open-Meteo's 10,000 free calls a day, so the four sample addresses read a snapshot instead: `data/samples/<slug>.json` holds the heat summary and the rain on each flood date. A lookup within 200 m of a sample uses it (`lib/samples.ts`); alerts, the NWS forecast and FEMA stay live, and any other address is live with a 6 h cache by 0.05 degree cell. Make or refresh them with `npm run snapshot-samples` (Node 22.7+; safe to re-run, finished parts are kept; `--refresh` fetches again; on a "daily limit" answer it stops and says to retry after 00:00 UTC). `--heat-cache <dirs>` and `--rain-seed <file>` are fallbacks for when the live call fails, and the file's `source` says which was used.

A heat grid is only used when its slug equals the Census city name (`SAN ANTONIO` becomes `san-antonio`) and its days equal the
address's own worst week (`gridMatchesWeek`). Pipeline docs: `pipeline/README.md`.

## More documents

- [`docs/forecast-experiment.md`](docs/forecast-experiment.md): the flood-forecaster experiment behind the chart on How it works (a model with hindsight beat the official outlook by 3.5%; with only what is known in advance, 0.0%; so we explain the official forecasts instead of competing).
- [`docs/build-log/`](docs/build-log/README.md): the build log and the first QA audit, kept as they were written.
- `pipeline/README.md`, `pipeline/RUN-2026-10-08.md`: the data pipeline, the detective and its pre-registered test.

## Accessibility

WCAG AA contrast, a keyboard path through every control, visible focus, pause/play and a slider on every animation,
`prefers-reduced-motion` shows end states (no flights, no auto-play), a text version of every animation, a polite live
region that narrates progress, real headings and landmarks, and no information carried by colour alone.
