# Round 7B: "What's changing here" and "Get ready" (Nova B)

Oct 8, 2026. Two new views, two new API routes. Nothing committed. Shared files (`ClimateRewindApp.tsx`, `lib/ui/tabs.ts`, `lib/lookup.ts`, `lib/types.ts`, `lib/ai/*`) were not edited; `lib/ai/*` is only imported.

## What shipped

**What's changing here** (`/api/future?lat&lon[&explain=1]`, `components/views/future/`)
- Observed: per-decade counts and a Mann-Kendall test with Sen slope (`lib/climate/trend.ts`, plain TS) for feels-like days at 90 F and 100 F and for days of 1 inch of rain or more, 2000 to 2025, from the Open-Meteo archive. A trend is shown only when p < 0.05; otherwise the page says "No clear trend yet."
- Projected: Open-Meteo Climate API, all 7 HighResMIP models (endpoint and model list checked with one curl after the 00:00 UTC reset and against Open-Meteo's docs). Days a year at 90 F (air temperature), 2001 to 2020 against 2041 to 2050, per model, with the range across models.
- Chart: past decades as bars, then the models' own 2001 to 2020 band and the projected 2041 to 2050 band. Text version and per-model table beside it. The caveat line is on screen verbatim.
- The 4 samples are precomputed in `data/projections/<slug>.json` (`scripts/projections-samples.ts`), explanation included. Other addresses are read live, cached per 0.05 degree cell for a day, de-duplicated while in flight, rate limited (20 new places a minute per visitor), and each half falls back on its own with a plain notice.
- AI explanation: sources are built from the computed numbers; the model copies them; `lib/ai/verify` checks every number and citation. Result on the 4 samples: 24 of 24 sentences kept, 0 dropped.

**Get ready** (`/api/ready?lat&lon&state`, `components/views/ready/`)
- `data/guidance/guidance.json`: 28 verbatim excerpts with URLs (ready.gov floods, tornadoes, extreme heat, wildfires, winter weather, power outages, thunderstorms; weather.gov flood, tornado, heat, wind; airnow.gov). Fetched Oct 8 and copied by script, not typed. Retrieval date is in the file.
- The plan is built from the address's flood reports (5 km), tornado tracks (10 km), heat record, and area events when wired. The AI writes up to 6 items; code keeps an item only if it cites at least one real local fact (an event id or a "local-..." number) AND at least one guidance line, and it passes the site-wide number, quote and overclaim checks. The "why" and the official link are filled from our data by id, never from the model's words.
- Nothing local in the record: no plan and no model call, with a "not the same as no risk" line. AI off or resting: the page still shows the record counted by code.
- Checklist with real checkboxes, "Why: <event>, <date>" (linked to the NCEI record) and the official source link, "What the official pages say" disclosure, a print button and a print layout (black on white, URLs written out; the disclosures are opened for printing).

## Real runs (dev server, real model)
- `/api/ready` Nashville: 6 items kept, 0 dropped. Bellevue: 6 kept, 0 dropped. Examples cite the Apr 5, 2025 flash flood report, the EF3 of Mar 3, 2020, the 113.1 F day of Jun 29, 2012.
- `/api/future` Bellevue and Nashville: served from the sample files, explanation ok (6 sentences each).
- Print layout checked as a PDF; Future and Ready screenshots taken in headless Chrome (no WebGL, so no map behind them).

## What the real numbers say (and what we chose to show)
- Models run high against the record at several spots: Asheville 2001 to 2020 models 5.2 to 13.8 against about 2.2 observed; Nashville 36.0 to 59.2 against 37.1; Bellevue 1.8 to 9.4 against 1.3. So the chart draws the models' own 2001 to 2020 band and says in words when they run higher or lower than the record. The honest comparison is band to band.
- Bellevue: models' middle 4.1 to 8.9 days a year, range 3.8 to 12.1 by 2041 to 2050; the record shows no clear trend yet (feels-like 90 F days 3.4, 3.9, 5.5 a year, p = 0.075). Shown as it is.
- San Antonio shows clear upward trends (p 0.001 and 0.005); Nashville's only clear trend is more days of 1 inch of rain (p = 0.018, ERA5 reanalysis, not a rain gauge).
- Open-Meteo bias-corrects the models onto ERA5-Land and the HighResMIP runs are "as close to RCP8.5 as possible" (their docs); a fine-print line says so.

## Checks
- `tsc --noEmit`: clean. `vitest run`: 42 files, 651 tests pass (mine: trend on known series including ties, projection math, observed counting, route caching and fallbacks, ready-item verifier, local facts, UI render, client calls; no network). `next build`: clean, no warnings.
- Not covered: no cross-browser run, no screen reader, no real phone. No accessibility linter is wired in this repo.

## Flags for Claudio
1. **Area events not wired.** `lib/ready/events.ts` no longer reads `data/events` (Koda deleted the per-state files). `ReadyDeps.areaEvents({lat, lon, state, county, zone})` is the injection point and defaults to null (the page says storm events for the wider area are not part of the plan yet). Wire it to `selectAreaEvents` in `lib/ready/ready-route.ts` `defaultReadyDeps`. My earlier Nashville and Bellevue runs with events (wind, winter, heat events cited) worked against the old layout.
2. **`next.config.ts` needs entries** (not mine to edit): `"/api/future": ["./data/projections/**/*"]` and `"/api/ready": ["./data/index/**/*", "./data/samples/**/*"]` plus whatever the events selector reads. Without them the Vercel functions will not find the sample files. (`data/events` is about 47,000 files; include only what is needed.)
3. **Open-Meteo allowance.** By its documented weighting an uncached address costs roughly 1,460 of the 10,000 free daily calls (archive about 680, two climate requests about 780), so a free key covers only a handful of new addresses a day on one IP; the 4 samples are precomputed for that reason. Judges testing their own address may hit the honest fallback. A paid key is Alex's call.
4. No `package.json` script added (not mine). Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --disable-warning=ExperimentalWarning --experimental-transform-types scripts/projections-samples.ts` (add `--refresh` to refetch, `--no-explain` for numbers only).
5. Ready plans for the 4 samples are not precomputed: the first click per instance costs one model call (about 6 to 8 s).

## Check by keyboard and screen reader (Alex)
- Changing tab: the chart is `role="img"` with a title and description; open "Text version of the chart" and "Each model" with Enter or Space; read the trend lines in order; open an AI source chip and close it with Escape.
- Ready tab: Tab to each checkbox and tick with Space (label is the action text, the "why" is its description); follow the "Why" and "Official source" links; open "What the official pages say"; press "Print this plan" and check the preview.
- Both: the announcements ("numbers ready", "plan ready") should be spoken once; the focus ring should be visible everywhere.
