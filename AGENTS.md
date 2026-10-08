# Climate Rewind — project rules for coding agents

ForgeHacks 2026 entry (AI + Climate). Submissions lock Sat Oct 10, 12:00 PM ET. Built during the event; never import code from other projects except the in-repo-adjacent prototype `../mocks/` (made this week for this project).

- Read `DESIGN.md` and `CONTRACT.md` before writing code. Do not change them.
- Stack: Next.js (App Router) + TypeScript, MapLibre GL JS, deployed on Vercel. Tests with vitest.
- No git commands, no deploys, no new dependencies unless the task names them.
- Never invent data, quotes, coordinates or alerts. Tag anything not real as SAMPLE.
- Accessibility (WCAG AA, keyboard, reduced motion, text alternatives) is a hard requirement.
- External APIs used at runtime: US Census geocoder, FEMA NFHL (ArcGIS REST), api.weather.gov alerts, Open-Meteo archive (NASA POWER is its fallback when Open-Meteo is rate limited), IEM NEXRAD tiles. Each must time out (≤8 s) and degrade gracefully with an honest message; tests must not hit the network (use fixtures).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
