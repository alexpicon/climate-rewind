# Climate Rewind — design rules (from Alex's review, Oct 7 2026)

Visual reference: `../mocks/05-prototype-v3.3.html` (+ `../mocks/assets/v3.3/`). Reuse its look, data handling and animation code. **But it is too busy. The product must be calmer: one thing at a time.**

1. **Map is the hero, full-bleed.** Dark premium look from v3.3 (navy/charcoal, glass panels, one warm accent, serif display + clean sans).
2. **One panel.** Big number + one plain sentence ("38 flood reports that night"). Everything else behind a "More" disclosure.
3. **One explanation, once.** The pre-roll card ("This is what really happened over your street that night") on first view of a tab; after that only a tiny tag "REPLAY · 1 s ≈ 5 min" (or "CORRECTION", "LIVE"). No duplicate explainer boxes.
4. **Legend collapsed** to a small key button that expands on click/focus.
5. **Top bar:** logo · address search · tabs (Storm replay, Heat wave, Tornadoes, How it works). Live alerts = a small dot + short text; green when quiet, red only for a real active alert; click opens a drawer. Must not overlap anything at 1280–1920 px widths (v3.3 overlapped at ~1560 px).
6. **Labels on hover/focus**, except the active pin's label. Address = one house icon marker (aria-label with the address).
7. **Detective step framing:** "Each pin is a written flood report, not a storm. We're fixing where the map filed it." Show the report quote with place words highlighted, then the pin moves carrying a paper "No. N".
8. **Accessibility (non-negotiable):** WCAG AA contrast, keyboard for every control, visible focus, pause/play on every animation, `prefers-reduced-motion` shows end states, a text version for every animation, real headings/landmarks.
9. **Honesty:** SAMPLE tags on anything not real; never fake an alert; "Shows NWS reports we could place near you, not every flood."
