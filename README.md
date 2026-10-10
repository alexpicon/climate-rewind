# Climate Rewind

**Climate change, measured at your address.** Type a US street address and see what the weather did there since 2000
(floods, tornadoes, heat, wind, ice, lightning, from National Weather Service records), how often dangerous heat and heavy rain
come now compared with the 2000s, and how much climate models (CMIP6) say that changes by the 2040s.
ForgeHacks 2026 (AI + Climate). **Built during ForgeHacks 2026 (Oct 7–10).**

- The record: every storm night replayed on real NEXRAD radar, the heat wave, the tornado tracks, and every NWS-recorded event for your county and forecast zone since 2000.
- The change: the record in the **same two windows everywhere**, 2000–2009 ("2000s") and 2016–2025 ("last 10 years"), then **the climate models' own change** by the 2040s, with the range across models. Not a forecast.
- The AI: re-files imprecise reports, maps damage, and writes cited sentences that code verifies. It never has the last word.

- Live demo: https://climaterewind.com
- Video: <coming>

## What it shows

Four top tabs, plus "How it works". Each view has a shareable URL.

| Top tab | View | What you see |
| --- | --- | --- |
| **Your history** | Story (the default) | "How the climate here has changed" strip (days a year at 90°F or hotter and days with 1 inch of rain, 2000s → last 10 years, then the models' change), then every NWS event for the address's county and forecast zone since 2000, ranked and replayed year by year. |
| | Storm replay | NEXRAD frames every 5 minutes for the busiest flood night near the address (a picker offers the 5 busiest within 15 km plus any night newer than 2023 with 2 or more reports), each NWS flood report at the minute it was filed, radar hail and rotation flags, and (on sample nights) lightning seen from space. Where the AI detective has results, reports pinned to a city point are re-filed where their words say; where it has not run, the page says so and shows reports as filed. |
| | Heat wave | The address's own daily feels-like highs, the hottest day, and days at 100°F or more per year. A regional replay where `data/heat/<slug>.json` ships (Nashville, Asheville, San Antonio, Bellevue). |
| | Tornadoes | Every tornado track within 10 km drawn on with its damage swath, the NWS's own damage narrative and the radar's rotation flags. |
| **Next 7 days** | | One card per day: the NWS forecast in plain words, what days like it meant here before, and what to do (each piece of advice tied to an official guidance line). The older brief, outlooks and "Ask your street" sit under a collapsed "More". |
| **What's changing** | | The record against the climate models, same measure on both halves: days a year at or above 90°F (air temperature). Chart, text version, each model, Mann-Kendall trend test, and a checked AI explanation. |
| **Get ready** | | A short plan written from this address's own record; every item must cite both a local fact and a line of official guidance. |
| *How it works* (link) | | Each AI job with its measured number, the flood detective in four steps with its pre-registered result, the flood forecaster we trained and set aside, and what is real versus sample. |

**URL params** (`app/page.tsx`, `lib/ui/tabs.ts`): `?address=...` (a street address) and `&tab=` one of `story` (also `history`), `storm`, `heat`, `tornado`, `ahead`, `future`, `ready`, `how`; with no `tab`, a lookup opens on `story`. `&night=` opens a storm night, `&view=3d` the optional 3D view on `storm` and `tornado`. `/event/<id>` plays a featured event (`ian`, `derecho`, `helene`; `lib/ui/event-catalog.ts`).
Try `/?address=450+110th+Ave+NE,+Bellevue,+WA&tab=future` or `/api/lookup?address=100+James+Robertson+Pkwy,+Nashville,+TN`.

The top bar also holds a live strip (green when quiet, red only for a real active NWS warning) that opens a drawer with the alert outline, the NWS's own storm motion and optional live radar.

## Coverage

- **All 50 states + DC** for events and the flood/tornado index. `data/events/<ST>/<code>.json.gz` holds **1,073,750 NCEI Storm Events area events** (2000 on) in 7,656 county and forecast-zone files across the 51 places (counted from `data/events/`). `data/index/<ST>.json.gz` is the flood-report and tornado-track index for all 51 (98,664 flood reports and 16,479 tornado tracks, NCEI Storm Events 2015–2025).
- **NWS Local Storm Reports (IEM LSR 2015–2025) and the AI detective** only for the sample areas: LSRs are in the indexes for 7 states (AZ, GA, MO, NC, TN, TX, WA); the detective has re-filed 131 of 494 imprecise flood reports it read, in 8 states (TX, FL, KY, NC, TN, MS, NY, WA; counted from `data/index`). Elsewhere the page says "the detective hasn't run for this area yet" and moves no pin.
- **Prepared addresses** (4 landing samples plus the 6 moments, so a click is instant): `data/samples/<slug>.json` (heat and rain snapshots), `data/projections/<slug>.json` (record, models and the AI explanation, 10 files), `data/samples/ai/`, and for the four samples `data/outlook-record/<slug>.json` and `data/heat/<slug>.json`. Any address within 200 m of one reads its files; every other address is read live (Open-Meteo), cached by 0.05 degree cell.
- Damage mapper output: `data/damage/<ST>.json` (NC, TN, TX, WA; 68 places). Official guidance lines for the plans: `data/guidance/guidance.json` (28 lines).

## The 6 moments

The landing page's "Moments the records caught" (`lib/ui/landing-moments.ts`; each number read from the app's own data and checked in `tests/landing-moments.test.ts`):

1. **Mayfield, KY, Dec 10, 2021.** An EF4 tornado passed 0.65 km from 100 E Broadway; 24 deaths and 210 injuries recorded in Graves County.
2. **Rolling Fork, MS, Mar 24, 2023.** An EF4 at night, 0.3 km from 100 Walnut St; 14 deaths and 150 injuries in Sharkey County.
3. **Flushing, Queens, Sept 1, 2021.** Hurricane Ida's remnants: 25 flood reports within 15 km in one night, with radar and lightning; 11 deaths in Queens.
4. **Lahaina, HI, Aug 8, 2023.** 102 deaths and $5.5 billion in damage recorded for the forecast zone that holds Front Street.
5. **Fort Myers, FL, Sept 28, 2022.** Hurricane Ian's landfall: about $7 billion and 60 deaths recorded for coastal Lee County.
6. **Portland, OR, June 26–28, 2021.** The Pacific Northwest heat dome: 93 deaths; Portland International hit 108, 112 and 116°F on three days in a row.

Each card carries one cautious attribution line with a "Source" link (a single tornado "can't yet be pinned on climate change"; the Lahaina card says no formal attribution study exists).

## The climate framing

Everything on the Story strip and What's changing uses **one measure** (days a year at or above 90°F, air temperature) and **the same windows** (`THEN_SPAN` 2000–2009 and `NOW_SPAN` 2016–2025 in `lib/climate/observed.ts`), so one "now" number appears on both tabs.

- **The record** is the Open-Meteo archive (ERA5 reanalysis), daily, 2000 to last year. A "trend" is stated only when a Mann-Kendall test with Sen slope on the yearly counts gives p < 0.05; otherwise "no clear trend yet" (which means too few or too variable years, not that nothing is changing).
- **The models** are 7 CMIP6 HighResMIP models via the Open-Meteo Climate API, on a grid about 25 km wide, on a high-emissions path. We show **the models' own change**: the middle model's 2041–2050 value minus its 2001–2020 value, and the lowest to highest change across single models. The page reads, for example, "Climate models: 4.1/yr (2001–2020, models) → 8.9/yr (2041–2050), about +4.8 days a year (models range from +2.0 to +6.8)". The strip shows the record then the change, never a raw model level beside the record.
- **No false adjustment claim.** The models are not tuned to the record and can run hotter than it. The one caveat line says so: "Climate models (CMIP6) are physics simulations, not a forecast; they run hotter than the record here, so we show their change." (It says "hotter" only where the models' own 2001–2020 middle is well above what the record counted; `caveatLine` in `lib/climate/projection.ts`.)

At the 10 prepared addresses (`data/projections/<slug>.json`): days a year at 90°F or hotter, record 2000s → 2016–2025, then the models' change by 2041–2050 (middle, range across the 7 models):

| Address | 2000s | 2016–2025 | Models' change |
| --- | --- | --- | --- |
| Bellevue, WA | 1.3 | 2.2 | +4.8 (+2.0 to +6.8) |
| Portland, OR | 11.0 | 17.5 | +8.2 (+5.5 to +12.3) |
| Nashville, TN | 35.2 | 35.6 | +22.1 (+16.8 to +30.2) |
| Fort Myers, FL | 26.8 | 61.0 | +45.5 (+27.3 to +55.5) |

A Mann-Kendall trend with p < 0.05 shows at 2 of the 10 (Fort Myers, Portland); everywhere else it says "no clear trend yet". The explanation is written by the AI from these numbers only and each sentence is verified in code (`lib/climate/explain.ts`); for the prepared addresses it is saved in the same file, made by `scripts/projections-samples.ts`.

## Results

Every number below is read from a file in this repository.

- **The AI flood detective (pre-registered, 100 fresh reports):** wrong pins (more than 5 km off) fell from **28% to 2%** (exact McNemar p = 3e-8; 26 reports wrong only without AI, 0 only with it). The trade-off is reach: **16% vs 33% within 1 km**, because it abstains (79% of reports) rather than guess when a report names only a road. No wrong pin was a confident one. [`pipeline/eval/score.json`](pipeline/eval/score.json), [protocol](pipeline/eval/PREREG.md), constants in `lib/detective-eval.ts` (a test fails if they stop matching `score.json`). The live re-filings on this site are not scored one by one; this test is.
- **The damage mapper:** extraction **precision 0.98, recall 0.86** on 5 hand-labelled NWS damage surveys (72 labelled places; 45 pinned); 10 of 10 spot-checked pins on the named place (`lib/ai-jobs.ts`). Gold labels and scoring: [`pipeline/eval/damage_gold.json`](pipeline/eval/damage_gold.json), [`pipeline/eval/score_damage.py`](pipeline/eval/score_damage.py). A small test, not pre-registered.
- **The brief verifier:** **98.5%** of the AI's written sentences passed code verification (66 of 67 over the fixed 20 questions at 4 addresses; the one dropped was an overclaim); briefs alone 24 of 24. [`data/ai-eval/brief.json`](data/ai-eval/brief.json).
- **The forecaster experiment (a negative result we kept):** a flood model trained on 2016–2022 and tested on 2024–2025 beat the official outlook by Brier skill **+3.5%** only when told the observed rain (hindsight); with only what is known in advance it scored **0.0%**. So we did not ship a forecast and explain the official ones instead. [`docs/forecast-experiment.md`](docs/forecast-experiment.md), `lib/forecast-spike.ts`.

**Honesty first.** Real data is real; anything that is not is tagged SAMPLE. It shows NWS reports we could place near you, not every flood. We make no forecast of our own (the Next 7 days outlooks are the National Weather Service's, and the AI only explains them), and we never fake an alert.

## The AI jobs

Six model-backed jobs, all through `claude-sonnet-5-5` with structured JSON output and thinking off, and none shown unless code verifies it (`lib/ai/verify.ts`):

| Job | Where | Measured |
| --- | --- | --- |
| Flood detective (offline, `pipeline/detective.py`) | Storm replay, Story | 28% → 2% wrong pins, pre-registered (above) |
| Damage mapper (offline, `pipeline/damage_mapper.py`) | Tornadoes | precision 0.98, recall 0.86 on 5 surveys (above) |
| Brief and "Ask your street" (`/api/brief`, `/api/ask`) | Next 7 days, "More" | 98.5% of sentences verified, 66 of 67 (above) |
| "What to do" per notable day (`/api/week`, `lib/week/actions.ts`) | Next 7 days | one call per address, cached 60 min; code drops any action with no cite, an off-list cite, or an unsupported number/quote |
| What's changing explanation (`/api/future?explain=1`) | What's changing | each sentence's numbers must be in a cited source; saved for the 10 prepared addresses |
| Get ready plan (`/api/ready`) | Get ready | kept only if each item cites a real local fact and a guidance line; cached 6 h per address |

The verifier (`lib/ai/verify.ts`) checks: at least one citation; every cited id exists; every number appears in a cited source; every quotation appears word for word; no overclaims ("will flood", "we predict", "you are safe"); plain text only. Percentages and totals are worked out in code, so the model copies and never calculates. Report text is untrusted data: angle brackets are stripped, it sits inside `<source>` tags, and the verifier is the real defence. Off-topic questions get a fixed refusal line.

**Coverage honesty.** Where an area is not indexed the source says so and the verifier allows no all-clear ("no floods", "nothing reported"). A question about what *will* happen gets our fixed line, "We don't forecast; here is the official outlook and how it has played out here."

Guardrails (`lib/ai/guard.ts`, `lib/ai/service.ts`): about 10 requests a minute per IP (429 with `Retry-After`), server-side answer caches, a per-day token budget from `AI_DAILY_TOKEN_BUDGET` (default 3,000,000, `0` switches the AI off; resets 00:00 UTC; a per-instance ceiling, **the monthly spend cap on the API key in the Anthropic console is the real safety net**), an honest "The AI is resting" state, a same-origin check, and a 503 "not available" state when `ANTHROPIC_API_KEY` is missing. The key is read only server side.

## Architecture

```
 browser (Next.js App Router, MapLibre)                   server (Next route handlers, no database)
 ┌──────────────────────────────────────┐   address   ┌───────────────────────────────────────────────────────────────┐
 │ landing: search box, samples, moments│ ──────────▶ │ /api/lookup   Census geocode, then FEMA zone, NWS alerts,     │
 │ Your history: Story · Storm · Heat · │             │               heat (Open-Meteo, else NASA POWER), flood        │
 │   Tornadoes                          │ ◀────────── │               trigger, state index (data/index)               │
 │ Next 7 days · What's changing ·      │   payloads  │ /api/story, area-map, area-replay  data/events (county/zone)  │
 │   Get ready · How it works           │             │ /api/week     NWS forecast + HeatRisk + WPC/SPC outlooks      │
 │ every view = f(progress p, data)     │             │ /api/future   Open-Meteo archive + Climate API, Mann-Kendall  │
 └──────────────────────────────────────┘             │ /api/ready, /api/brief, /api/ask  sources → one model call →  │
                                                      │               code verifies EVERY sentence → only those leave │
                                                      │ guards: rate limit · token budget · caches · same-origin      │
                                                      └───────────────────────────────────────────────────────────────┘
 offline: Python (pipeline/) builds the indexes, the AI detective and the damage mapper; Node scripts (scripts/) make the prepared-address files
```

Three ideas run through it. **Real data or a label:** anything not real is tagged SAMPLE, and where there is no data the app says so instead of "no floods". **The model never has the last word:** it only rewrites facts we already hold, and code drops any sentence whose citation, number or quotation is not in a cited source. **Every outside call can fail:** each has an 8 second timeout and an honest notice, and heat and rain history fall back from Open-Meteo to NASA POWER (labelled on the page). Each animated view is a pure function of one progress value `p` (0 to 1), so playing, pausing, scrubbing, reduced motion and screenshots share one code path.

```
app/page.tsx                     server component: reads ?address, ?tab, ?night, ?view; renders the client shell
app/api/*/route.ts               lookup, alerts, story, area-map, area-replay, replay, signatures, outlook, outlook-areas, week, future, ready, brief, ask, heat/[slug], alert-zone
app/event/[id]/                  featured event pages (ian, derecho, helene)
components/climate/              the "How the climate here has changed" strip (Story)
components/views/<view>/         one folder per view (story, storm, heat, tornado, ahead, future, ready) + HowView.tsx
lib/lookup.ts, sources.ts        orchestration; Census, FEMA, NWS, Open-Meteo (injectable fetch, 8 s timeouts)
lib/climate/                     observed (windows, Mann-Kendall), projection (models, change, caveat), chart-model, explain (AI), live/samples
lib/climate-strip/               the strip's numbers, from the same payload as What's changing
lib/week/, lib/ready/            Next 7 days cards and actions; Get ready facts and plan
lib/area-events.ts               data/events/<ST>/<code>.json.gz, zone outlines, severity ranking
lib/ai/                          sources (what the model may cite), verify, guard, service, prompt
lib/ai-jobs.ts                   the AI jobs and their measured numbers (How it works)
lib/ui/*                         pure helpers for the views, tabs and URLs, landing moments
tests/                           vitest, fixtures only; nothing touches the network
data/                            events, index, samples, projections, heat, outlook-record, damage, guidance, ai-eval
pipeline/                        the Python data pipeline, the AI detective, its pre-registered eval (pipeline/README.md)
scripts/                         prepared-address and eval scripts (below)
```

The product name is one constant: `lib/brand.ts` (`APP_NAME`). `CONTRACT.md` defines the per-state index and the lookup payload.

## Data sources (all keyless except Anthropic)

- [US Census Geocoder](https://geocoding.geo.census.gov/geocoder/): street addresses only.
- [FEMA National Flood Hazard Layer](https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer): flood zone for the point (layer 28).
- [api.weather.gov](https://www.weather.gov/documentation/services-web-api): alerts, gridpoint forecasts, forecast zones.
- [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) (ERA5 reanalysis, [ERA5 at Copernicus](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels)): daily `apparent_temperature_max`, `temperature_2m_max`, `precipitation_sum`, 2000 to last year.
- [Open-Meteo Climate API](https://open-meteo.com/en/docs/climate-api): the 7 CMIP6 HighResMIP models ([HighResMIP, Haarsma et al. 2016](https://gmd.copernicus.org/articles/9/4185/2016/)), daily `temperature_2m_max`, 2001–2020 and 2041–2050.
- [NASA POWER](https://power.larc.nasa.gov/) (MERRA-2): the fallback when Open-Meteo is rate limited (heat index by the NWS Rothfusz formula, and rain), labelled on the page.
- [NCEI Storm Events Database](https://www.ncei.noaa.gov/access/storm-events-database/): area events, flood reports, tornado tracks and the NWS damage narratives.
- [IEM Local Storm Reports](https://mesonet.agron.iastate.edu/lsr/) and [IEM web services](https://mesonet.agron.iastate.edu/ogc/): LSRs, outlook archives, and NEXRAD frames through the time-enabled WMS (`nexrad-n0q-wmst`).
- [WPC Excessive Rainfall Outlook](https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php), [SPC convective outlooks](https://www.spc.noaa.gov/products/outlook/), [NWS HeatRisk](https://www.wpc.ncep.noaa.gov/heatrisk/).
- [Anthropic API](https://docs.claude.com/en/docs/intro): the AI jobs, server side only.
- Maps: [MapLibre GL JS](https://maplibre.org/), Esri World Dark Gray tiles, and for the optional 3D view [OpenFreeMap](https://openfreemap.org/) buildings and [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/).

Each external call has an 8 second timeout and degrades to `null` plus a plain-language notice.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000   (a predev step copies MapLibre's worker into public/vendor)
npm test             # vitest, no network
npm run typecheck    # tsc --noEmit
npm run build && npm start
```

**Secrets.** Copy `.env.example` to `.env.local` and paste your `ANTHROPIC_API_KEY` (git-ignored; never sent to the browser). Gotcha: a variable the shell already defines wins over `.env.local`, **even when it is empty**; if your shell exports `ANTHROPIC_API_KEY=`, the AI shows "not available". Fix: `unset ANTHROPIC_API_KEY`, or `env -u ANTHROPIC_API_KEY npm run dev`. On Vercel set `ANTHROPIC_API_KEY` and `AI_DAILY_TOKEN_BUDGET` in the project's environment variables, and set the monthly spend limit on the key in the Anthropic console before the demo goes public.

### Refreshing the data (Node 22.7+; run from the repo root; each script is safe to re-run)

```bash
npm run snapshot-samples                  # data/samples/<slug>.json (heat and rain snapshots for the prepared addresses)
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --disable-warning=ExperimentalWarning --experimental-transform-types scripts/projections-samples.ts
                                          # data/projections/<slug>.json: record, models, AI explanation (--refresh refetches; --explain-again redoes the text)
npm run precompute-ai                     # data/samples/ai: the saved brief, story and plan for each prepared address (needs the app running; see the script header)
npm run eval-brief                        # the 20-question test -> data/ai-eval/brief.json
npm run outlook-record                    # data/outlook-record/<slug>.json
npm run convert-heat -- --in pipeline/out/heat/san-antonio.json --place "San Antonio"
```

Open-Meteo's free tier stops at a daily limit (resets 00:00 UTC); the scripts stop and say so, and finished parts are kept. The Python pipeline (`pipeline/`: indexes, heat grids, the detective and its eval) is documented in `pipeline/README.md` and `pipeline/RUN-2026-10-08.md`.

## More documents

- [`docs/forecast-experiment.md`](docs/forecast-experiment.md): the flood-forecaster experiment (hindsight +3.5%; in advance 0.0%).
- [`docs/build-log/`](docs/build-log/README.md): the build log and QA audits, kept as written.
- [`pipeline/eval/PREREG.md`](pipeline/eval/PREREG.md): the detective's pre-registered protocol.

## Accessibility

WCAG AA contrast, a keyboard path through every control, visible focus, pause/play and a slider on every animation, `prefers-reduced-motion` shows end states (no flights, no auto-play), a text version of every chart and animation, a polite live region that narrates progress, real headings and landmarks, and no information carried by colour alone.
