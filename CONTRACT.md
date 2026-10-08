# Climate Rewind — data contract (v1, Oct 7 2026)

Shared by the web app (`memoria/`) and the data pipeline (`memoria-pipeline/`, merged into `memoria/pipeline/` later). Change only with Claudio's OK.

## Static index files (produced by the pipeline, read by the web API)
Location in the web repo: `data/index/<ST>.json.gz` (one per state, two-letter code). gzip JSON:

```jsonc
{
  "state": "TN", "built": "2026-10-08T03:00:00Z", "sources": ["NCEI Storm Events 2015-2025", "IEM LSR 2015-2025"],
  "floods": [ {
    "id": "SE-1265274" | "LSR-<wfo>-<valid>-<n>",
    "source": "StormEvents" | "LSR",
    "type": "Flash Flood" | "Flood" | "<LSR typetext>",
    "start": "2021-03-27T22:55:00-05:00",      // local time WITH offset (never bare UTC)
    "county": "Davidson", "wfo": "OHX", "city": "NASHVILLE",
    "quote": "ROSA PARKS BLVD UNDERWATER NEAR THE FARMERS MARKET WITH CARS STALLED",  // verbatim NWS text
    "filed": [36.17, -86.78],                   // lat, lon exactly as the NWS filed it
    "coordPrecision": "precise" | "rounded" | "placeholder" | "none",  // rule-based, see below
    "placed": [36.1739, -86.7911] | null,       // detective result, null if not run or unknown
    "detective": null | { "verdict": "placed" | "unknown", "clues": ["Rosa L Parks Blvd", "Farmers Market"],
                          "match": "ROSA L PARKS BLVD & JEFFERSON ST, NASHVILLE, TN", "matchType": "intersection" | "address" | "named_area",
                          "confidence": "high" | "medium" | "low", "model": "claude-sonnet-5-5", "ranAt": "..." },
    "dupOf": null | "<id>"                      // set when an LSR duplicates a Storm Events row
  } ],
  "tornadoes": [ { "id": "SE-882999", "start": "...", "ef": "EF3", "begin": [lat, lon], "end": [lat, lon],
                   "widthYd": 1600, "lengthMi": 21.49, "deaths": 5, "injuries": 220,
                   "narrative": "<verbatim EVENT_NARRATIVE>", "episodeNarrative": "<verbatim>" } ]
}
```
coordPrecision rules: Storm Events with ≥3 decimals and not shared by >2 rows = precise; ≤2 decimals = rounded; LSR with a `city` field and no "N SE" distance prefix = placeholder; LSR otherwise = rounded (all LSRs are ≤2 decimals).

## Per-address payload (`GET /api/lookup?address=...`)
```jsonc
{
  "address": { "input": "...", "matched": "...", "lat": 36.168175, "lon": -86.777516, "state": "TN", "county": "Davidson" },
  "fema": { "zone": "X", "subtype": "AREA OF MINIMAL FLOOD HAZARD", "sfha": false } | null,
  "live": { "checkedAt": "...", "alerts": [ { "event": "...", "headline": "...", "ends": "...", "polygon": GeoJSON|null, "motion": "..."|null } ] },
  "floods": { "reports": [ /* index rows within 5 km of the address by placed (if any) else filed point, plus distanceKm and tier */ ],
              "tierCounts": { "mentioned": 0, "about1km": 0, "citywide": 0 } },
  "stormReplay": { "date": "2021-03-27", "startUtc": "...", "endUtc": "...", "frameMinutes": 5, "reportIds": [...] } | null,  // night with most flood reports within 15 km
  "tornadoes": [ /* within 10 km, with minDistanceKm */ ],
  "heat": { "byYear": { "2000": 10, ... }, "hottest": { "date": "2012-06-29", "feelsF": 113.3 }, "worstWeek": { "start": "...", "end": "...", "daily": [...] } }
}
```
tier: "mentioned" = detective verdict placed with address/intersection match; "about1km" = precise or rounded filed point; "citywide" = placeholder/none with no placement.

## Honesty rules (both repos)
Never invent data, quotes, coordinates or alerts. Anything not real is tagged SAMPLE in the UI. Never claim "every flood", "predicts", or a heat trend.
