# Pre-registration: detective re-test on a fresh sample (round 3)

Written by Koda on 2026-10-07 at about 8:05 PM CDT. This was written **before** `eval_detective.py` existed, before any sample was drawn, and before anything ran. Nothing in this file may change after the first `run` command. Later changes go in an "Amendment" section with a timestamp, and must be labeled **post hoc** if made after any output was seen.

## Why

Round 2 (`research/memoria-ai-spike/RESULT.md`) gave **SIMILAR** on its pre-registered metric, which was ≤1 km.
- The post-hoc finding was that the detective drops wrong pins: 8% of records were more than 5 km off, against 36% for baseline v2.
- That finding was not the primary metric. It also came from the same 100 records, which had already been seen in round 1.
- This test makes wrong pins the **primary** metric and uses a **fresh sample**.

## Question

On NWS flood reports whose true spot is known, does the production detective (`detective.py`) pin fewer reports more than 5 km off than the no-AI baseline v2, without losing reach?
- The production detective is Claude `claude-sonnet-5-5`, using the Census and Nominatim tools, with the code-side rule checks.

## Data (fixed now)

- **Source:** NCEI Storm Events, Flood and Flash Flood, 2015–2025, county rows, in TX, TN, NC, MO, AZ, GA. Files are in `raw/stormevents/`.
- **Pools:** the same pool definitions as round 2's `build_sets.py`, ported unchanged into `eval_detective.py`. Precise truth means all of the following:
  - ≥4 decimals on one coordinate and ≥3 on the other;
  - the point is not shared with any other row nationwide;
  - BEGIN_RANGE > 0;
  - the narrative is 40–900 characters.
- **Set A:** single-place, n = 60.
- **Set B:** hard (≥3 places, or a relative phrase), n = 40.
- **Exclusions:** all 100 round-1 and round-2 event ids (`research/memoria-ai-spike/data/truth.jsonl`) are removed from both pools before sampling.
- **Seeds:** A = **20261009**, B = **20261010**. Round 2 used 20261007 and 20261008. Sampling is stratified by state, as in round 2.
- **Truth:** the NWS BEGIN point. It is written only to `eval/truth.jsonl` and is never shown to either method.
- **What each method sees:** id, state, county and narrative only. The NWS town field (BEGIN_LOCATION) is withheld, because it is derived from the hidden point.
- **Recorded after drawing:** the sha256 of `eval/sample.jsonl` goes into `eval/sample_manifest.json`. The sample is drawn once.

## Methods

1. **Baseline v2 (no AI).** Round-2 `baseline_v2.py`, ported to `memoria-pipeline/baseline_v2.py`.
   - The logic is unchanged: regex plus the landmark pattern, then Census intersection > Census address > Nominatim mention+town > Nominatim mention alone, with the county check.
   - Only the I/O (cache paths) and the geocoder client are refactored.
   - The Nominatim gap is 2.0 s, the same as round 2.
2. **Detective.** `detective.py` as it is in the repo when the first `run` command starts.
   - `--max-tools 8` per record, model `claude-sonnet-5-5`, one pass.
   - Its output counts only after the code-side checks: substring, query words, match type, county, and coordinates taken from a tool result.
   - A record that ends with verdict "unknown" (including code-side rejections, budget exhaustion, or an API error after retries) counts as **unplaced**.
   - Code-side rejections are reported as their own count.

## Metrics (ALL n=100; A and B reported for context only)

| Metric | Definition |
|---|---|
| **W: wrong-pin rate (PRIMARY)** | records placed > 5 km from truth / 100 (unplaced records are not wrong pins) |
| R: reach | records placed ≤ 1 km from truth / 100 |
| Abstain rate | unplaced / 100 |
| Also | ≤2 km of all; median and p90 error (placed only); >5 km of placed; the detective's confidently-wrong count (high and >5 km); the detective's ≤1 km and >5 km by confidence level; code-side rejection count by reason; tokens and USD |

## Decision rule (fixed now)

Let ΔW = W_baseline − W_detective and ΔR = R_detective − R_baseline, both in percentage points (pp). The test p is an exact two-sided McNemar test on the per-record wrong-pin indicator: a binomial test on the discordant pairs.

- **FEWER WRONG PINS (supported):** ΔW ≥ 15 pp, **and** p < 0.05, **and** ΔR ≥ −5 pp.
- **FEWER WRONG PINS, LESS REACH:** ΔW ≥ 15 pp and p < 0.05, but ΔR < −5 pp. In that case the trade has to be stated alongside the claim.
- **NOT SUPPORTED:** ΔW < 15 pp or p ≥ 0.05, with W_detective ≤ W_baseline.
- **DETECTIVE WORSE:** W_detective > W_baseline.

**Headline bar (secondary, reported separately):** W_detective ≤ 10%. The page may say "the AI rarely pins a report in the wrong place" only if both the decision is "supported" and this bar is met.

## Run protocol

1. `eval_detective.py sample` (once), then record the sha256.
2. `eval_detective.py run --method baseline`.
3. `eval_detective.py run --method detective`.
   - If the API key is missing the run cannot start.
   - A crash mid-run may be resumed: finished records are cached and are not re-run.
   - A whole re-run is not allowed after any output has been read.
4. `eval_detective.py score`. The scorer is frozen at the commit or diff state used for step 2.
5. Examples, selected as in round 2: 3 detective wins in sha1(id) order, and the 3 worst detective losses.

Bug fixes (crashes, parse errors) are allowed. Any change that alters which point either method picks must be labeled post hoc, with both versions reported.

## Known limits (stated up front)

- **Selection bias.** Records with precise truth are the ones NWS staff could geocode, which skews toward specific narratives. Production centroid LSRs are vaguer, so the absolute numbers are optimistic for production.
- **Truth noise.** NWS points have their own error. Rex found a 1.91 km case where Census and Nominatim agreed with each other and the NWS point was off.
- **Not identical to round 2.** The detective is the same model family (Claude Sonnet) as the valid round-2 pilot, but runs in a different harness (an SDK tool loop with code-side checks instead of agents issuing curl calls by hand), so it is not the round-2 agent. This tests the production detective.

## Changes before any run

Written on 2026-10-08, before any `run` command and before any output existed (`eval/out_*.jsonl` do not exist yet). These are scoring and guardrail corrections found in an audit; none of them changes the sample, the seeds, the truth, the metrics' wrong-pin or reach definitions, or the decision rule.

- **Missing is not abstain.** A record with no output line (the run did not reach it) is now counted as *missing*, reported separately from *abstain* (the method ran and left it unplaced). In the Metrics table, "Abstain rate = unplaced / 100" now means "ran and unplaced / 100", and a "Missing rate = no output / 100" is added; placed + abstain + missing = 100%. W and R are unchanged (still over all 100, so a missing record is neither a wrong pin nor a hit). The scorer marks the result `complete: false` and prints a warning when any record is missing, and the page must not report an incomplete run.
- **Detective guardrails tightened** (`detective.py`, in the "code-side checks" this file already relies on): an address match is refused when its house number is a measurement ("3 feet", "40 mph", "2 inches", a range ending in a unit), and must be on the street named in the query and in a quoted clue (normalized, suffixes ignored). These make the detective stricter, so they can only turn a placement into "unknown". Both are in place before the first `run`, so the first run uses them.

- **Intersection must be stated by the text** (2026-10-08, Koda, decided by Claudio; before any `run`, no `eval/out_*.jsonl` exists). A guardrail fix found in the demo-area audit (`pipeline/RUN-2026-10-08.md`): when a report only *lists* roads ("CHARLOTTE PIKE...21ST AVENUE...AND THE I-440 EXIT RAMP"), the detective could query "Charlotte Pike & 21st Ave", Census matched that real intersection, and every existing check passed. Now an "intersection" match is accepted only if the narrative itself relates the two streets: both names within ~8 words of each other with a connector between them (at, and, &, near, /, @, "between … and"; "intersection of A and B" reduces to "A and B"), and no ellipsis, semicolon or comma list between them. It is enforced in `census_match_type` (the tool marks the candidate `not_acceptable`) and again in `verify_verdict` (`intersection_not_in_text`), and the system prompt states the rule. It can only turn a placement into "unknown". No metric, sample, seed, truth or threshold changes; the first `run` uses it.
- Correction before any run (Claudio, Oct 8, 2026): the round-2 pilot that produced 36% vs 8% used Claude Sonnet agents (run 2); the Haiku run 1 was invalid (scripted picker) and was never scored. Line about 'Sonnet, not Haiku' corrected accordingly. No metric, sample or threshold changed.
- **"From A to B" is a connector** (2026-10-08, Koda, decided by Claudio; before any `run`, no `eval/out_*.jsonl` exists). "X is closed from A to B" (also "through"/"thru") describes a segment of street X, so it relates X to A and X to B, never A to B. `intersection_in_text` now accepts "X & A" and "X & B" for that wording (X within ~8 words before "from", A at most 6 words, only suffix/direction words between "to" and B) and still refuses "A & B". The system prompt states it. This loosens the intersection rule only for this wording; no metric, sample, seed, truth or threshold changes, and the first `run` uses it.
- **"Between A and B" is a segment, like "from A to B"** (2026-10-08, Koda, decided by Claudio; before any `run`, no `eval/out_*.jsonl` exists). "X is closed between A and B" relates X to A and X to B, never A to B: `intersection_in_text` now refuses the pair when "between" (within 4 words, no list punctuation) leads into A and only the "and"/"&" of "between ... and" joins A and B. The system prompt states it. This only tightens the rule (it can only turn a placement into "unknown"); no cached demo-area placement changed. No metric, sample, seed, truth or threshold changes; the first `run` uses it.

- Change before any run (Claudio, Oct 8, 2026): the product was renamed from "Memoria del Agua" to "Climate Rewind"; the detective and damage-mapper system prompts now say "Climate Rewind" instead of "Memoria". Wording only; no rule, metric, sample or threshold changed.
