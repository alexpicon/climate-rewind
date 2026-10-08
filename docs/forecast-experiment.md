# Forecast experiment: can history beat the official outlook at predicting flood reports?

Run on October 8, 2026, during ForgeHacks 2026, as a one-day experiment before deciding whether Climate Rewind should ship a forecast of its own. This is the write-up behind the "We trained a flood forecaster" section of the app's How it works page (`lib/forecast-spike.ts` holds the numbers shown there; a test keeps this file and that one in step). "ERO" below is the Weather Prediction Center's Excessive Rainfall Outlook, the official flood outlook.

The analysis scripts and the cached downloads (IEM outlook archive, NASA POWER rain) were run outside this repository and are not included. The tables below are their output.

## VERDICT: NO-GO for shipping a "forecast" feature in Climate Rewind

Short version:

- **The only model that beats ERO-only uses observed rain.** On the 2024-25 test years it gets Brier skill +3.5% vs ERO-only (95% CI +1.7% to +5.3%, date-block bootstrap) and AUC 0.954 vs 0.881. That is a perfect-prognosis result. It cannot be run live, because tomorrow's rain is not known.
- **The live-feasible version does no better than ERO-only.** Strip day-D rain and keep ERO, 3-day antecedent rain, month and point rate: Brier skill vs ERO-only is **0.0%** (CI -1.4% to +1.3%).
- **The lift fades fast when rain is noisy.** In an illustrative degraded-rain simulation (not real QPF), the lift falls from +3.5% to +0.7% with moderately wrong rain and to about 0 with badly wrong rain.
- **ERO alone is already decent.** It beats climatology by +6.0% Brier skill (CI 4.5% to 7.6%) and has AUC 0.88. That is honest and useful, but it is the NWS's skill, not ours.

Decision: we did not build the model. Where the app looks forward, it shows the official outlook and the empirical table below as a fact about that outlook, e.g. "When WPC rated a point Moderate, flood reports followed within 10 km on 31% of days (n=137, 7 states, 2024-25)". No new inference and no "we predict" claim. The 3.5% is a footnote, not a feature.

## Setup (what was actually run)

- **Labels.** Flood rows from the 7 state indexes: `dupOf` null, type in {Flash Flood, Flood, FLASH FLOOD, FLOOD}. That is 28,771 rows. Heavy-rain, wind and other LSR types are excluded. Location is `placed` if present, otherwise `filed`. Local date D. Positive = at least one such row within 10 km (haversine) of the point on D.
- **Points.** 78 points: TN 10, TX 20, NC 10, MO 10, AZ 10, GA 10, WA 8. Includes the 4 sample addresses (Nashville, San Antonio, Asheville, Bellevue). The rest are the largest cities plus a few flash-flood towns (Kerrville, Boone, Flagstaff). Panel: 313,404 point-days, 2015-2025.
- **ERO.** The IEM bulk archive works: `cgi-bin/request/gis/outlooks.py?type=E&d=1&geom=geom`, pulled month by month, then local point-in-polygon.
  - Coverage: WPC ERO starts **Nov 2015** (archive minimum issue time 2015-11-01). There is nothing earlier, so training is 2016-2022, not 2015.
  - Days with no product in the archive are dropped: 1.9% of 2024 and 0.5% of 2025 point-days.
  - Feature `ero_am` = the Day-1 product valid 12Z D to 12Z D+1, issued about 07Z (the early-morning outlook), as 0 = none, 1 = MRGL, 2 = SLGT, 3 = MDT/HIGH (HIGH has only 83 point-days, so it is merged into MDT).
  - Cross-check: the API call for Nashville 2021-03-27 returns MDT, which matches the bulk result.
  - Sensitivity: using the max over later same-day updates raises ERO-only AUC to 0.90. The model's lift vs ERO-only stays 3.3%, and the no-QPF version stays at +0.2%.
- **Rain.** NASA POWER `PRECTOTCORR`, 78 points, complete 2015-2025, no gaps. Features: day-D rain, 3-day antecedent (D-3..D-1).
- **Split by time.** Train 2016-2022 (199k rows, 920 positives). Validate 2023 (28k rows, 118 positives). Test 2024-25 (56k rows, 350 positives, 206 distinct dates).
- **Models.**
  - Climatology: point x month rate, shrunk toward the point rate (k=100 days).
  - ERO-only: empirical P(positive | ERO category) from the training years.
  - Logistic regression (and gradient boosting) on ERO category, log rain D, log 3-day rain, month sin/cos, log point rate, and ERO x rain.
  - Ablations: "noQPF" (no day-D rain) and "noero" (no ERO).
- **Model choice.** LR and HGB tie on validation (Brier skill vs ERO-only +2.6% vs +2.8%). LR is reported because it is simpler. No tuning on test. Refitting on 2016-23 changes nothing material (+3.8%).

## Headline results

Test 2024-25, fit on 2016-22. Brier is lower-is-better. BSS is Brier skill, so higher is better.

| Model | Brier | BSS vs climatology | BSS vs ERO-only | AUC |
|---|---|---|---|---|
| Climatology (point x month) | 0.006167 | 0 | -6.4% | 0.674 |
| ERO-only | 0.005797 | +6.0% | 0 | 0.881 |
| LR, no day-D rain (live-feasible bound) | 0.005797 | +6.0% | 0.0% (CI -1.4 to +1.3) | 0.916 |
| LR, no ERO (rain only) | 0.005635 | +8.6% | +2.8% (CI +0.9 to +4.7) | 0.951 |
| **LR full (perfect-prog rain)** | **0.005597** | **+9.2% (CI 7.0 to 11.6)** | **+3.5% (CI +1.7 to +5.3)** | **0.954** |
| HGB full | 0.005606 | +9.1% | +3.3% | 0.955 |

Reading the table:

- **Where the lift comes from.** Almost all of it is observed day-D rain. A rain-only model with no ERO gets +2.8% vs ERO-only, and ERO adds roughly +0.7 points on top of rain.
- **The AUC gain with no rain.** The no-QPF AUC (0.916 vs 0.881) is probably ERO-only's coarse 4-level ties being broken by point and month rate and antecedent rain (we did not isolate which). It does not improve Brier, and a ranking gain with no Brier gain is not a forecast improvement.
- **Practical size.** With a 0.6% base rate, a 3.5% Brier gain is small. The model's practical value is sharper probabilities on the few days that matter.
- **Validation (2023, 118 positives).** The result is similar (+2.6% vs ERO-only, AUC 0.924 vs 0.781), so the finding is stable across both held-out periods.

Illustrative degraded-rain simulation (noise applied to train and test; NOT real QPF, it only shows the direction):

| Rain error | BSS vs ERO-only | AUC |
|---|---|---|
| none (observed) | +3.5% | 0.954 |
| lognormal sigma 0.5, 15% wrong day | +1.6% | 0.940 |
| sigma 0.8, 30% wrong day | +0.7% | 0.932 |
| sigma 1.2, 50% wrong day | +0.1% | 0.923 |

Real gridpoint QPF errors on convective flash-flood days are in the larger-error rows. So the live lift is plausibly between 0% and +1%, below anything defensible.

## Base rates and positives

| Split | Point-days | Positives | Base rate |
|---|---|---|---|
| Train 2016-22 | 199,368 | 920 | 0.46% |
| Validation 2023 | 28,470 | 118 | 0.41% |
| Test 2024-25 | 56,238 | 350 | 0.62% |

- **Test positives are clustered.** 350 point-days fall on 206 distinct dates. The biggest day is 2024-09-27 (Helene) with 11. The CIs above resample dates, not rows, to respect this.
- **Positives by state in test:** TX 122, NC 68, GA 52, MO 42, TN 38, AZ 23, WA 5.
- **Label sensitivity.** Dropping `placeholder`-precision labels (city-centroid coordinates) gives BSS vs ERO-only +2.9%, no-QPF -0.2%. The conclusion is unchanged.

ERO-only empirical probabilities (test, 2024-25):

| ERO | Point-days | Positives | Observed rate | Trained estimate |
|---|---|---|---|---|
| none | 49,173 | 54 | 0.11% | 0.16% |
| MRGL | 5,374 | 131 | 2.4% | 2.3% |
| SLGT | 1,554 | 123 | 7.9% | 6.1% |
| MDT/HIGH | 137 | 42 | 30.7% | 20.9% |

Note: 15% of test positives fell on days with no ERO at all.

## Reliability (test 2024-25)

Full LR model:

| Predicted bin | n | Positives | Mean predicted | Observed |
|---|---|---|---|---|
| <0.25% | 46,026 | 15 | 0.04% | 0.03% |
| 0.25-0.5% | 2,868 | 20 | 0.36% | 0.70% |
| 0.5-1% | 2,299 | 28 | 0.71% | 1.22% |
| 1-2% | 1,906 | 45 | 1.4% | 2.4% |
| 2-4% | 1,511 | 58 | 2.8% | 3.8% |
| 4-8% | 938 | 69 | 5.6% | 7.4% |
| 8-16% | 455 | 53 | 11.1% | 11.7% |
| >16% | 235 | 62 | 26.0% | 26.4% |

- **Under-prediction in the middle bins.** The model under-predicts there (mean prediction 0.50% vs 0.62% observed overall). Two causes:
  - The test years are wetter or more heavily reported. ERO>0 days rose from 8.4% (train) to 12.6% (test), a known WPC drift toward larger outlook areas.
  - Point rates are frozen at 2016-22.
- **ERO-only has the same problem.** It under-predicts MDT (20.9% predicted vs 30.7% observed).
- **Bottom line on calibration.** Rank order is good. Absolute probabilities would need recalibration every year, which is a further cost of a live model.

## Per-state notes (test, n of positives in brackets)

| State | Positives | BSS vs ERO-only | AUC full | AUC ERO | Note |
|---|---|---|---|---|---|
| NC | 68 | +9.1% | 0.961 | 0.902 | Best case, but one state; the Helene days sit here. |
| MO | 42 | +3.4% | 0.952 | 0.852 | |
| TX | 122 | +3.3% | 0.958 | 0.879 | Largest sample. |
| TN | 38 | +1.2% | 0.956 | 0.861 | |
| AZ | 23 | +0.5% | 0.977 | 0.963 | Too few positives. Monsoon ERO already strong. |
| GA | 52 | +0.1% | 0.940 | 0.856 | Reporting is sparse. |
| WA | 5 | +0.1% | 0.909 | 0.693 | 5 positives, uninterpretable. |

- **Noise.** Per-state differences are noise-level except NC. we would not market any per-state claim.
- **Reporting-bias.** The index is reported floods, not floods. Raw report density follows population and NWS office practice. Points are all cities, so this is "flooding reported near a city", not flood risk.

## Example outputs (plain language)

Out-of-sample test examples (2024-25). "Model" is the full LR with observed rain:

| Point and date | ERO | Rain D / 3d | Model | ERO-only | Climatology | Reported |
|---|---|---|---|---|---|---|
| Nashville 2025-04-03 | SLGT | 64 / 25 mm | 32% | 6.1% | 1.0% | yes (6 reports) |
| Nashville 2024-05-08 | MDT | 70 / 19 mm | 50% | 21% | 0.3% | no |
| San Antonio 2025-06-12 | SLGT | 31 / 30 mm | 22% | 6.1% | 1.2% | yes |
| San Antonio 2025-05-30 | none | 16 / 31 mm | 4.2% | 0.2% | 1.8% | yes (ERO miss) |
| Asheville 2024-09-26 | HIGH | 142 / 52 mm | 42% | 21% | 0.4% | yes |
| Asheville 2024-09-27 | HIGH | 67 / 193 mm | 36% | 21% | 0.4% | no, see data caveat |
| Bellevue 2025-12-10 | SLGT | 38 / 70 mm | 0.5% | 6.1% | 0.3% | no |

Nashville 2021-03-27 (the March 2021 flood; 2021 is in the training window, so this uses a fit with 2021 left out):

- ERO that day was MDT. Observed rain was 67 mm.
- "Model: 30% chance flooding is reported within 10 km; ERO alone: 20%; climatology: 0.3%. It was reported: yes (5 reports)."
- The next day, 2021-03-28, shows the day-alignment problem: ERO was none, POWER rain was 37 mm (UTC day), model 10%, reported yes (3 reports). The storm straddles the UTC boundary.

Note the Nashville 2024-05-08 miss: the model gave 50% after 70 mm of rain, and no flood was reported. Probabilities at this level are confident-sounding numbers on data this thin, which is a presentation risk.

## Data-quality caveats (read before quoting any number)

1. **Perfect-prognosis rain.** The headline lift uses observed rain, which is not available at forecast time. The real feature set at inference is much weaker, and the no-QPF row is the honest bound.
2. **Day alignment.** POWER daily rain is by UTC day. Labels are local date. Evening convection in the Central and Mountain zones lands partly in UTC D+1. Adding D+1 rain (`pD1`) changed nothing material (+3.5%), but the mismatch adds noise to rain features.
3. **State-border truncation.** Reports come only from the 7 indexed states. Points near borders lose neighbours' reports: Kansas City, St. Louis, Memphis, Columbus GA, Vancouver WA, Kingsport, Joplin, El Paso, Yuma, Lake Havasu, Kingman. Point rate absorbs it, but it biases rates down.
4. **Label gaps.** Asheville 2024-09-27 (Helene) shows no flood report within 10 km in the index despite extreme rain and ERO HIGH. we did not investigate why (possibly missing reports during the event); the index records reports, not floods. This counts as a "false alarm" for every model.
5. **ERO drift.** WPC's outlook area grew over 2016-2025, so ERO-only and every model are non-stationary. The test years are not exchangeable with the training years.
6. **Overlapping points.** Bellevue and Seattle (and similar pairs) share most of their 10 km neighbourhood. The date-block bootstrap handles this. Per-state and per-point numbers are not independent.
7. **Small positives.** 350 test positives, 206 dates. The +3.5% CI excludes zero, but the per-state and per-bin numbers above are noisy.

## Build cost to run it live

Even though we decided not to build it, this is what it would take:

- **Inputs at inference.**
  - Today's ERO: one IEM `outlook_by_point` call (free, fast).
  - Rain: NWS gridpoint `quantitativePrecipitationAmount`, via `/points/{lat},{lon}` then `/gridpoints/{wfo}/{x},{y}`. Two calls, cache the grid mapping. This replaces observed day-D rain.
  - Antecedent rain: the last 3 days of observations (POWER lags days, so NWS/MRMS or CoCoRaHS would be needed).
- **Engineering.** About a day: fetch, feature builder, LR coefficients as a static JSON, a lookup endpoint.
- **The blocking problem.** There is no free archive of past NWS gridpoint QPF. So the model would be trained on observed rain (perfect-prog) and deployed on forecast rain. That is a known source of degradation: it over-trusts the rain input, probabilities are miscalibrated, and tail days behave worst. The alternative is to log live forecasts for months to train a proper model, which cannot happen before the Oct 10 lock.
- **Maintenance.** Yearly recalibration (the test-year under-prediction above), plus a rain-feed outage fallback to ERO-only.

## What we did not do

- No real archived QPF test, so the live degradation is a bound plus a simulation, not a measurement.
- No county/FEMA-zone features, no river-gauge features.
- No per-point models. One pooled model across 78 points.
