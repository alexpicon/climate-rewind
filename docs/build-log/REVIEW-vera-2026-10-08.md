# Vera audit, Oct 8, 2026 (summary relayed by Claudio; audit only, no code changed)

Status added later: every item below is marked **Fixed**, with the round of `NOVA-REPORT.md` that fixed it. The audit text itself is unchanged.

## Blockers
1. **Radar replay drops frames on normal connections.** It takes about 24 s to load and hits a hard 20 s cutoff in `storm-scene.ts`. A lookup makes ~590 tile requests. In 3 of 5 runs, 48–51 of 86 frames were dropped; at 25 KB/s, 84 of 86 were dropped. With IEM blocked, it retried 2,861 times.
   - **Fixed** (Fix round 1). One image per frame from IEM's time-enabled WMS, 6 at a time, playback after the first 12. Re-measured: 0 frames dropped on every network profile including 25 KB/s; 18 requests with IEM blocked (was 2,861).
2. **No real AI output ships.** `placed` and `detective` are null in all 6 states. The Nashville placements are hand-made and tagged SAMPLE. The landing and How copy still claim the detective moves pins. Fix: run the detective (needs `ANTHROPIC_API_KEY`) or reword.
   - **Fixed** (Fix round 1, then Round 4b). The copy first said only what was true (nothing moved). The detective has since run for real on the sample areas (110 of 364 imprecise reports re-filed, the rest "I don't know") and its pre-registered result is on the site (Round 5).
3. **Pre-registration is unprovable** (0 commits, no LICENSE). Commit and push `PREREG.md` plus the sample manifest BEFORE running the eval.
   - **Fixed for the commit** (Round 5). The protocol commit ("Pre-register the detective re-test") is dated 14:25 PDT on Oct 8, before the first eval output at 14:30. **Still open: there is no LICENSE file**; that is the owner's call.

## Should-fix
- Focus drops to BODY after lookup, "Watch the night", How and Back.
  - **Fixed** (Fix round 1). Focus goes to the heading of the new view.
- The zoom control sits under the header at 1440. Key is clipped by the dock on the heat and tornado tabs.
  - **Fixed** (Fix round 1). The zoom control sits below the bar; the key sits above the dock.
- axe, WCAG 2.5.3: the live strip and 8 heat-day buttons have mismatched accessible names.
  - **Fixed** (Fix round 1). axe-core with `label-content-name-mismatch` on: 0 violations in 6 states.
- At 390 px the step-2 card covers "More". At 200% zoom and 320×640 the pre-roll card covers the dock.
  - **Fixed** (Fix round 1). Checked by geometry at 390×844 and 320×640. 640×360 stays cramped (noted in that round).
- The heat pre-roll says "Real recorded", but the data is reanalysis. FEMA "minimal flood hazard" needs a mapped-risk caveat. The pilot bars should note post-hoc, Haiku and "reach was a tie".
  - **Fixed** (Fix round 1). "Recorded by weather reanalysis"; FEMA card says "minimal mapped risk, not no risk"; the pilot is a one-line footnote saying it was not pre-registered.
- Detective guardrail holes: "3 feet deep" is accepted as a house number, and an address match never checks the street name.
  - **Fixed** (Fix round 1). Measurements are refused as house numbers, and the matched street must contain the street name from a quoted clue.
- Eval scoring counts missing records as abstains.
  - **Fixed** (Fix round 1). Missing records are reported separately from abstains.

## Verified
- Tests, tsc, build and pytest all pass.
- Payloads match CONTRACT, quotes and narratives are verbatim, and distances, tiers and replay nights recompute exactly.
- Reduced motion works. Screenshots are in `/tmp/vera/shots/`.
