# Vera audit, Oct 8, 2026 (summary relayed by Claudio; audit only, no code changed)

## Blockers
1. **Radar replay drops frames on normal connections.** It takes about 24 s to load and hits a hard 20 s cutoff in `storm-scene.ts`. A lookup makes ~590 tile requests. In 3 of 5 runs, 48–51 of 86 frames were dropped; at 25 KB/s, 84 of 86 were dropped. With IEM blocked, it retried 2,861 times.
2. **No real AI output ships.** `placed` and `detective` are null in all 6 states. The Nashville placements are hand-made and tagged SAMPLE. The landing and How copy still claim the detective moves pins. Fix: run the detective (needs `ANTHROPIC_API_KEY`) or reword.
3. **Pre-registration is unprovable** (0 commits, no LICENSE). Commit and push `PREREG.md` plus the sample manifest BEFORE running the eval.

## Should-fix
- Focus drops to BODY after lookup, "Watch the night", How and Back.
- The zoom control sits under the header at 1440. Key is clipped by the dock on the heat and tornado tabs.
- axe, WCAG 2.5.3: the live strip and 8 heat-day buttons have mismatched accessible names.
- At 390 px the step-2 card covers "More". At 200% zoom and 320×640 the pre-roll card covers the dock.
- The heat pre-roll says "Real recorded", but the data is reanalysis. FEMA "minimal flood hazard" needs a mapped-risk caveat. The pilot bars should note post-hoc, Haiku and "reach was a tie".
- Detective guardrail holes: "3 feet deep" is accepted as a house number, and an address match never checks the street name.
- Eval scoring counts missing records as abstains.

## Verified
- Tests, tsc, build and pytest all pass.
- Payloads match CONTRACT, quotes and narratives are verbatim, and distances, tiers and replay nights recompute exactly.
- Reduced motion works. Screenshots are in `/tmp/vera/shots/`.
