#!/usr/bin/env python3
"""
Builds public/data/tornado-tracks.json, the tornado tracks drawn behind the landing page.

Every track is a real NCEI Storm Events tornado row from the shipped state indexes
(data/index/<ST>.json.gz): its start date, the NWS's own begin and end points, its EF
rating and its deaths. Only the lower 48 states are kept (the landing map is the lower
48); a row without both points is left out. Nothing is smoothed, sampled or invented.

Compact layout: one flat list of whole numbers, six per track, sorted by date:
  [day, lat0, lon0, lat1, lon1, ef]  day = days since `from`, coordinates x100
  (about 1 km), ef = index into `ef`. Deaths ride in a parallel `deaths` list of
  [track index, deaths] pairs, since almost every track has none.

Run from the repo root after the indexes change:  python3 scripts/landing-tracks.py
"""
import gzip
import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "data" / "index"
OUT = ROOT / "public" / "data" / "tornado-tracks.json"

EF = ["EFU", "EF0", "EF1", "EF2", "EF3", "EF4", "EF5"]
LOWER_48 = {"lat": (24.0, 50.0), "lon": (-125.5, -66.0)}


def in_lower_48(lat: float, lon: float) -> bool:
    """True for a point inside the lower-48 box.

    Args:
        lat: Latitude in degrees.
        lon: Longitude in degrees.

    Returns:
        Whether the point is inside the box the landing map draws.
    """
    lat_lo, lat_hi = LOWER_48["lat"]
    lon_lo, lon_hi = LOWER_48["lon"]
    return lat_lo <= lat <= lat_hi and lon_lo <= lon <= lon_hi


def main() -> None:
    """Reads every state index and writes the landing tracks file."""
    rows = []
    sources = set()
    built = set()
    for path in sorted(INDEX.glob("*.json.gz")):
        with gzip.open(path, mode="rt", encoding="utf-8") as handle:
            index = json.load(handle)
        sources.update(index.get("sources", []))
        built.add(index.get("built", "")[:10])
        for tornado in index["tornadoes"]:
            begin, end = tornado.get("begin"), tornado.get("end")
            if not begin or not end or tornado.get("ef") not in EF:
                continue
            if not (in_lower_48(*begin) and in_lower_48(*end)):
                continue
            rows.append((tornado["start"][:10], tornado["id"], begin, end, tornado["ef"], tornado.get("deaths") or 0))

    rows.sort(key=lambda row: (row[0], row[1]))
    start = date.fromisoformat(rows[0][0][:4] + "-01-01")
    tracks: list[int] = []
    deaths: list[list[int]] = []
    for i, (day, _id, begin, end, ef, killed) in enumerate(rows):
        offset = (date.fromisoformat(day) - start).days
        tracks += [offset, round(begin[0] * 100), round(begin[1] * 100), round(end[0] * 100), round(end[1] * 100), EF.index(ef)]
        if killed:
            deaths.append([i, killed])

    out = {
        "source": "NCEI Storm Events tornado rows, as filed by the National Weather Service (begin and end points, EF rating, deaths)",
        "sources": sorted(sources),
        "built": max(built),
        "region": "lower 48 states",
        "from": start.isoformat(),
        "to": rows[-1][0],
        "count": len(rows),
        "ef": EF,
        "tracks": tracks,
        "deaths": deaths,
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(rows)} tracks, {sum(d for _, d in deaths)} deaths, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
