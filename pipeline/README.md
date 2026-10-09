# Climate Rewind: data pipeline

This pipeline builds the static files the web app reads (`memoria/CONTRACT.md`): per-state flood and tornado indexes, AI detective placements, and regional heat grids. It is Python 3 with a venv in `.venv`. Dependencies: requests, pandas, pyarrow, anthropic, pytest.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python build_index.py --states TN,TX,NC,MO,AZ,GA          # ~2.5 min cold, ~11 s from cache (--offline)
.venv/bin/python detective.py --state TN --near 36.168,-86.778 --km 30 --only-imprecise --dry-run
.venv/bin/python heat_grid.py --slug nashville --lat 36.168175 --lon -86.777516
.venv/bin/python -m pytest -q                                          # no network, no API key needed
```

This folder lives in the web repo as `pipeline/`. Set `MEMORIA_DATA_DIR=../data` to write the index and heat files straight into the app's `data/` folder; `out/`, `raw/`, `cache/` and `.venv/` are git-ignored. `heat_grid.py` output is converted for the app with `npm run convert-heat` (see the repo README).

## Sources

| Data | Source | Notes |
|---|---|---|
| Floods (Flood, Flash Flood) and tornadoes, 2015–2025 | NCEI Storm Events bulk details CSVs (`ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/`) | Reused from `/tmp/memoria/raw` and copied to `raw/stormevents/`; downloaded if missing |
| Flood LSRs (`FLOOD`, `FLASH FLOOD`, plus other typetexts whose remark describes flooding), 2015–2025 | IEM `geojson/lsr.geojson`, one call per WFO per year | Raw responses gzipped in `raw/lsr/<WFO>_<YYYY>.json.gz` along with the call log |
| Geocoding (detective, baseline) | US Census geocoder `onelineaddress` / `coordinates`; Nominatim `/search` | Cached in `cache/`; Nominatim uses UA `memoria/0.1 (forgehacks)` with ≥1.1 s between calls and stops on 403/429 |
| Heat | Open-Meteo historical archive (reanalysis), daily `apparent_temperature_max`, F | Point series 2000–2025, plus a 0.5° grid for the worst week |

## build_index.py → `out/index/<ST>.json.gz`

- **WFOs per state** are taken from the Storm Events rows for that state, so offices that cross state lines (MEG, HUN, RNK, AKQ, DVN, OAX, PAH, ...) are fetched.
- **LSR state** is assigned from each report's own `st` field, not from the office.
- **10,000-feature cap.** Every IEM response count is asserted below 10,000. A year that reaches the cap is re-fetched month by month, and each month is asserted. The largest single call in this build was 4,203 (DVN 2019).
- **Times are local, with an offset.**
  - LSR `valid` is UTC. It is converted using the county's zone, taken as the majority `CZ_TIMEZONE` of Storm Events rows for that county, with the WFO and then the state as fallbacks.
  - Storm Events times are local *standard* time (NWSI 10-1605: `CST-6` all year). They are converted to civil local time, so DST is applied. Example: `27-MAR-21 21:55 CST-6` → `2021-03-27T22:55:00-05:00`, which matches the LSR at 03:55Z.
  - Arizona stays on MST. El Paso and Hudspeth use Mountain time with DST.
- **Flood LSRs from other typetexts.** Helene's Asheville-area reports were filed as `TROPICAL CYCLONE`, so any non-flood typetext (TROPICAL CYCLONE, HEAVY RAIN, TSTM WND DMG, ...) is kept when its remark describes flooding. `type` keeps the original typetext.
  - Keywords: flood, flooding, flooded, water rescue, high water, submerged, inundat, washed out, swept away.
  - A keyword hit is ignored when it is negated within the same sentence (`No reports of flooding`), or when it is part of an agency, gauge or forecast phrase (`Flood Control`, `flood stage`, `Flood Warning`, `mean high high water`).
  - Coastal and ocean types stay out whatever the remark says: COASTAL/LAKESHORE/TIDAL FLOOD, HIGH ASTR TIDES, STORM SURGE, RIP CURRENTS, HIGH SURF, SNEAKER WAVE.
  - This adds 511 rows across the 6 states. Per state (tropical-cyclone rows in brackets): TN 27 (0), TX 127 (1), NC 65 (2), MO 48 (0), AZ 118 (0), GA 126 (14). `_stats.json` carries `lsr_by_remark`, `lsr_tropical_cyclone` and `lsr_by_remark_types`.
  - LSR ids are numbered within a WFO-minute, so a new row in the same minute can shift the `-<n>` suffix of an existing one. No detective results existed when this was added, and the eval sample is Storm Events only.
- **coordPrecision** follows the CONTRACT rules:
  - Storm Events ≥3 decimals and shared by ≤2 rows nationwide (all types, 2015–2025) = `precise`; ≤2 decimals = `rounded`; no coordinates = `none`.
  - LSR with a `city` and no "N SE" distance prefix = `placeholder`; any other LSR = `rounded`.
  - **Contract gap:** a Storm Events point with ≥3 decimals that is shared by >2 rows is labelled `placeholder`.
- **dupOf.** An LSR within 2 km of a Storm Events flood's begin or end point, and within 3 h of its [begin, end] window, gets `dupOf` set to the nearest such SE id.
- **Text.** `quote` is the verbatim `EVENT_NARRATIVE` or LSR `remark`, with no case or whitespace changes (NCEI's own `|||` separators are kept). Tornado `narrative` and `episodeNarrative` are verbatim too.
- **Tornadoes:** one row per county segment, with `deaths`/`injuries` = DIRECT counts for that segment. SE-882999 (Davidson part of the Mar 3, 2020 EF3) has 2/170, while its narrative's whole-track totals are 5/220.
- **Detective merge.** Cached detective results in `out/detective/<ST>.jsonl` are merged on every build, so a rebuild never loses them.
- **Verification.** The build prints counts per state and spot-checks N random rows (`--verify 5`) against the raw sources: verbatim text, coordinates and time conversion.

## detective.py: the AI flood detective

- **Design.** An Anthropic SDK tool-use loop with `claude-sonnet-5-5` and three tools:
  - `census_geocode`: an address, or the intersection form `A & B, Town, ST`.
  - `nominatim_search`
  - `submit_verdict`
- **Rules.** The system prompt carries the spike and Rex rules: substring-only places, Census address or intersection only, Nominatim named areas only, the record's county only, "unknown" over guessing, and the narrative treated as data. **The code enforces these rules again in `verify_verdict`**, and any failure becomes `unknown`:
  - every clue is a substring of the narrative;
  - the street part of the query (before the first comma) uses only narrative words, so no added cross street or house number;
  - the match type is computed by code, not claimed by the model;
  - an address match needs a real house number: a number followed by a unit word (feet, ft, inches, in, mph, miles) or that appears in the text only as a measurement ("3 feet deep", "40 mph", "2 to 3 feet") is refused;
  - an address match must be on the street named in the query and in a quoted clue (normalized, suffixes like Rd/Road ignored), so "95 Wallace Rd" never accepts "95 Church St";
  - **an intersection match must be stated by the text** (added 2026-10-08, PREREG "Changes before any run"): both street names within ~8 words of each other with a connector between them (at, and, &, near, /, @, "between … and"), and no ellipsis, semicolon or comma list between them. "CHARLOTTE PIKE...21ST AVENUE...AND THE I-440 EXIT RAMP" is a list, so "Charlotte Pike & 21st Ave" is refused; "VANTAGE WAY AND ROSA PARKS BLVD" is accepted. "from A to B" is not a connector, so a closure range ("136TH PLACE NE IS CLOSED FROM SPRING BLVD. TO NE 20TH STREET") is refused;
  - a named-area name must appear in the text;
  - the result must be in the right state and county (Census county, Nominatim county, or a Census coordinates lookup);
  - **the coordinates must equal a candidate returned by a tool call in this run** (a per-run candidate registry).
- **Budget guards:**
  - `--max-tools` per record (default 8; calls past the budget never reach a geocoder);
  - `--max-records` per run (default 25);
  - `--dry-run` (selection plus cost estimate, no API calls);
  - a missing `ANTHROPIC_API_KEY` exits with a clear message.
- **Caching.** Results are cached in `out/detective/<ST>.jsonl` with an audit (tokens, tool calls, rejection reason) and merged into the index. `--merge` merges only.

- **Budget and speed flags (added 2026-10-08):** `--budget-usd N --ledger PATH` meters real API `usage` (assumed prices) and refuses any call that could pass the cap, across runs that share the ledger (`budget.py`); `--workers N` runs records in parallel (Nominatim stays serialized at 1.1 s).
- **Thinking blocks (fixed 2026-10-08):** the model returns `thinking` blocks. They are now sent back with their text and signature; before the fix every multi-turn record failed with HTTP 400.

## damage_mapper.py: tornado damage places → `data/damage/<ST>.json`

- **Extract** (one call per tornado row): named streets, intersections, neighbourhoods and landmarks with damage, each with a verbatim damage phrase and the EF rating only if it is written in that sentence. The code drops a place or phrase that is not a substring, or a place that is not in its phrase's sentence, and nulls an EF rating that is not in that sentence.
- **One tornado, one pass (episode track, round 2).** A county row repeats the whole-track narrative, so the rows are grouped per tornado from the raw Storm Events CSVs: same `EPISODE_ID`, linked by an identical narrative or by `TOR_OTHER_CZ_NAME` plus end point = next begin point. Each tornado is extracted and geocoded once, against **all** its segments (SE-882999's track is Davidson → Wilson → Smith). A pin is attributed to the segment nearest to it (`tornadoId` in the output). The whole NWS episode is not used: the Mar 3, 2020 episode also holds the Cookeville EF4 and Humphreys County tornadoes, 75–100 km away, where an "I-40" would also be "on track".
- **Geocode** (one detective loop per place, the same tools and `verify_verdict`, including the intersection rule), plus:
  - the query is about this place: street words come from the place or its phrase, at least one is the place's own, and any house number is in the place;
  - the point is within 2 km of the tornado's track (any segment);
  - the county is one of the track's Storm Events `CZ_NAME`s.
- **Two more pin kinds, damage mapper only (round 2, Claudio's decision; the track bounds them):**
  - **lone street** (`matchType: "street"`): tool `street_on_track` looks the street up in Census TIGERweb road lines (Transportation layers 2, 6, 8; cached in `cache/tiger_roads.json`) inside the track's box, keeps lines whose name is the same street (same distinctive words; suffix, direction and interstate marker agree when both give one: "Barclay Drive" = "Barclay Dr", never "Barclay Ct"), and returns the point on it nearest the track. Accepted only within 2 km. No house number or cross street in that query.
  - **landmark / neighbourhood** (`matchType: "landmark"`): a Nominatim feature (not a road, waterway, boundary, town or county) whose name is in the text and is the place or contains it or sits inside it ("Ft." = "Fort"). Named areas must pass the same name check.
- **Output:** placed rows only, `{tornadoId, place, phrase, ef, lat, lon, matchType, confidence}`. The full audit is in `out/damage/<ST>.jsonl`.
- `damage_mapper.py --state TN --near 36.168,-86.778 --km 15 --budget-usd 15 --ledger out/ledger/damage.json [--dry-run] [--force] [--force-extract]` (`--force` re-geocodes cached places; extractions are reused unless `--force-extract`)

## eval_detective.py: the pre-registered re-test

- **Pre-registration first.** Read `eval/PREREG.md` before anything else. It was committed before the run (the git history shows the order: the protocol commit, then the outputs).
- **Sample.** The fresh sample is already drawn (`eval/sample.jsonl`, sha256 in `eval/sample_manifest.json`).
  - Seeds 20261009/20261010, 100 records (A 60 / B 40), 0 overlap with the spike's 100.
  - Truth is held only in `eval/truth.jsonl`. Methods see only id, state, county and narrative.
- **Baseline.** Baseline v2 is ported to `baseline_v2.py` with its logic unchanged.
- **Primary metric:** the wrong-pin rate, i.e. pins more than 5 km from the hidden NWS point, out of all 100 records.
- **Also reported:** within 1 km, abstain rate (ran and left unplaced), missing rate (no output at all, reported separately and never counted as an abstain; the scorer flags an incomplete run), calibration, and a McNemar test.
- **Status:** not run. The detective needs the API key. Run order: `run --method baseline`, `run --method detective`, `score`.

## heat_grid.py → `out/heat/<slug>.json`

- **Address series.** One Open-Meteo call at the address for 2000–2025 gives `byYear` (days with feels-like ≥100 °F), the hottest day, and the worst week, defined as the 7 days centred on the hottest day.
- **Grid.** A 0.5° lattice (25 × 35 = 875 points, the v3.2 extent) is fetched for that week in batched multi-location calls of 50 points.
- **Nashville** reuses the prototype's cached 2012 grid.
- **Labelling.** The output is history, not a forecast. The grid shows reanalysis cells, not street-level readings.

## What's real

- **Real data:** every index row, quote, coordinate and time comes from NCEI or IEM. The heat values are real Open-Meteo reanalysis.
- **Detective:** real results exist for the 4 sample areas only (imprecise rows within 15 km of Nashville, San Antonio, Asheville, Bellevue: 364 rows, 108 placed after the round-2 intersection rule), merged into `data/index/`. Every other row still has `placed: null`, `detective: null`. See `RUN-2026-10-08.md`.
- **Tornado damage places:** `data/damage/<ST>.json` holds the real pins from the 11 sample-area tornado rows (`damage_mapper.py`, round 2 on 2026-10-08; see `RUN-2026-10-08.md`). Scored against hand labels with `python eval/score_damage.py`.
- **Eval:** the eval numbers do not exist yet. Round-2 numbers (8% vs 36% wrong pins) are pilot numbers from a different harness (Claude Sonnet agents calling the geocoders via curl by hand; an earlier Haiku run was invalid because it scripted an auto-picker).

## Cost estimate (detective)

**Pricing assumption:** $3 per million input tokens and $15 per million output tokens. This is the Sonnet-tier list price and is **unverified for `claude-sonnet-5-5`**; it is set in `detective.py` as `PRICE_IN` and `PRICE_OUT`. The estimate assumes about 4 turns per record, resending the system prompt and tools each turn. The worst case is 8 tool calls plus 2 turns.

| Run | Records | Typical | Worst case |
|---|---|---|---|
| Eval (100 records) | 100 | ~$3.60 | ~$17 |
| Nashville demo (`--near 36.168,-86.778 --km 30 --only-imprecise`) | 313 | ~$11 | ~$53 |
| Default capped run (`--max-records 25`) | 25 | ~$0.90 | ~$4.20 |
| **All imprecise rows, 6 states** | 29,125 (16,859 non-dup) | **~$1,060** | ~$4,900 |

The all-states run is well above the plan's "tens of dollars", so run the detective on demand for the demo radii. Options to bring the all-states run down:
- prompt caching on the system prompt and tools;
- the Batch API (half price);
- skipping `dupOf` rows;
- a cheaper model.

Measure real tokens on the eval run first. The code records `input_tokens` and `output_tokens` for each record.

## Satellite lightning for the sample storm nights (`glm_flashes.py`)

Reads NOAA's GOES Geostationary Lightning Mapper Level 2 files (public AWS open data, one file every 20 seconds, 2018 on) for one
replay night, keeps the good-quality flashes (quality flag 0) inside the replay's map box and window, and writes
`public/data/lightning/<slug>/<night>.json` plus an entry in `public/data/lightning/index.json`. The storm replay draws them only
for that sample address and night. A flash's position is the centroid of the light the satellite saw (roughly 8 to 14 km), its
energy is radiant energy at the sensor (not current), and GLM sees all lightning, in cloud and to ground.

A night is about 180 files an hour at about 700 KB each, so it runs offline, never at request time. Needs `netCDF4` (pinned in
`requirements.txt`). Pass the night id, window and box from the lookup's `stormReplay`, and the satellite: GOES-16 for the East
until Apr 7, 2025 (then 19), GOES-17 for the West until Jan 4, 2023 (then 18).

| Sample | Night | Satellite | Files | Flashes |
|---|---|---|---|---|
| Nashville | 2021-03-28T03:55 | GOES-16 | 1,277 | 21,839 |
| Asheville | 2024-09-25T23:00 (Helene) | GOES-16 | 602 | 1,657 |
| Bellevue | 2019-12-20T15:58 | GOES-17 | 735 | 0 |

San Antonio's replay night (June 2, 2016) is before GLM began, so it has no lightning file.
