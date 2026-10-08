"""Regional worst-week heat grid for one demo address (same method as prototype v3.2/v3.3).

usage: heat_grid.py --slug nashville --lat 36.168175 --lon -86.777516 [--start 2012-06-26] [--half-lat 6 --half-lon 8.5]

1. One Open-Meteo archive call at the address, 2000-2025, daily apparent_temperature_max (F), local time zone:
   byYear (days with feels-like >= 100 F), hottest day, and the worst week = the 7 days centred on the hottest day
   (the prototype's Jun 26 - Jul 2, 2012 for Nashville). --start overrides the week.
2. A 0.5-degree lattice around the address (default 25 x 35 = 875 points, the v3.2 extent) for that week, fetched with
   multi-location calls (50 points per call), cached in raw/heat/. Nashville's 2012 week is seeded from the prototype's
   cache (../../mocks/assets/v3.3/data/heat_raw.json) when present.
Output: out/heat/<slug>.json. Reanalysis (ERA5-based, ~10-25 km cells): neighbouring points can share a cell. History only.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

import requests

from common import HEAT_DIR, HERE, RAW

API = "https://archive-api.open-meteo.com/v1/archive"
HEAT_RAW = os.path.join(RAW, "heat")
PROTO_CACHE = os.path.normpath(os.path.join(HERE, "..", "..", "mocks", "assets", "v3.3", "data", "heat_raw.json"))
PROTO_DAYS = ("2012-06-26", "2012-07-02", "America/Chicago")
THRESHOLD_F = 100.0
BATCH = 50


def _get(params: dict, tries: int = 8, timeout: float = 90):
    last = None
    for k in range(tries):
        try:
            r = requests.get(API, params=params, timeout=timeout)
            if r.status_code == 200:
                return r.json()
            last = f"HTTP {r.status_code}: {r.text[:200]}"
            if r.status_code == 400:
                break
        except Exception as e:
            last = repr(e)
        time.sleep(min(60, 10 * (k + 1)))
    raise SystemExit(f"Open-Meteo failed: {last}")


def point_series(slug: str, lat: float, lon: float, y0: int, y1: int) -> dict:
    os.makedirs(HEAT_RAW, exist_ok=True)
    path = os.path.join(HEAT_RAW, f"point_{slug}_{y0}-{y1}.json")
    if os.path.exists(path):
        return json.load(open(path))
    d = _get(dict(latitude=lat, longitude=lon, start_date=f"{y0}-01-01", end_date=f"{y1}-12-31",
                  daily="apparent_temperature_max", temperature_unit="fahrenheit", timezone="auto"))
    json.dump(d, open(path, "w"))
    return d


def summarize(series: dict) -> dict:
    days, vals = series["daily"]["time"], series["daily"]["apparent_temperature_max"]
    pairs = [(t, v) for t, v in zip(days, vals) if v is not None]
    by_year: dict[str, int] = {}
    for t, v in pairs:
        by_year.setdefault(t[:4], 0)
        by_year[t[:4]] += v >= THRESHOLD_F
    hot_t, hot_v = max(pairs, key=lambda p: (p[1], -date.fromisoformat(p[0]).toordinal()))
    best7 = None
    for i in range(len(vals) - 6):
        w = vals[i:i + 7]
        if None in w:
            continue
        m = sum(w) / 7
        if best7 is None or m > best7[1]:
            best7 = (days[i], m)
    return dict(byYear=by_year, hottest=dict(date=hot_t, feelsF=round(hot_v, 1)),
                hottest7DayMean=dict(start=best7[0], meanF=round(best7[1], 1)) if best7 else None,
                timezone=series.get("timezone"), gridCell=[series.get("latitude"), series.get("longitude")])


def lattice(lat: float, lon: float, half_lat: float, half_lon: float, step: float) -> tuple[list, dict]:
    snap = lambda x: round(round(x / step) * step, 2)
    la0, la1 = snap(lat - half_lat), snap(lat + half_lat)
    lo0, lo1 = snap(lon - half_lon), snap(lon + half_lon)
    nla, nlo = int(round((la1 - la0) / step)) + 1, int(round((lo1 - lo0) / step)) + 1
    pts = [(round(la0 + i * step, 2), round(lo0 + j * step, 2)) for i in range(nla) for j in range(nlo)]
    return pts, dict(lat=[la0, la1], lon=[lo0, lo1], rows=nla, cols=nlo)


def grid_cache(start: str, end: str, tz: str) -> tuple[dict, str]:
    os.makedirs(HEAT_RAW, exist_ok=True)
    path = os.path.join(HEAT_RAW, f"grid_{start}_{end}_{tz.replace('/', '-')}.json")
    cache = json.load(open(path)) if os.path.exists(path) else {}
    if (start, end, tz) == PROTO_DAYS and os.path.exists(PROTO_CACHE):
        seeded = json.load(open(PROTO_CACHE))
        for k, v in seeded.items():
            cache.setdefault(k, v)
    return cache, path


def fetch_grid(pts, start, end, tz, gap=4.0):
    cache, path = grid_cache(start, end, tz)
    need = [p for p in pts if f"{p[0]},{p[1]}" not in cache]
    print(f"{len(pts)} grid points, {len(need)} to fetch ({start}..{end}, {tz})", file=sys.stderr)
    for k in range(0, len(need), BATCH):
        chunk = need[k:k + BATCH]
        r = _get(dict(latitude=",".join(str(p[0]) for p in chunk), longitude=",".join(str(p[1]) for p in chunk),
                      start_date=start, end_date=end, daily="apparent_temperature_max", temperature_unit="fahrenheit", timezone=tz))
        r = r if isinstance(r, list) else [r]
        assert len(r) == len(chunk), f"Open-Meteo returned {len(r)} locations for {len(chunk)}"
        for (a, b), x in zip(chunk, r):
            cache[f"{a},{b}"] = dict(snap=[x["latitude"], x["longitude"]], v=x["daily"]["apparent_temperature_max"])
        json.dump(cache, open(path, "w"))
        print(f"  {k + len(chunk)}/{len(need)}", file=sys.stderr, flush=True)
        time.sleep(gap)
    return cache


def box_lattice(lat0: float, lat1: float, lon0: float, lon1: float, step: float) -> tuple[list, dict]:
    """An explicit lat/lon box (snapped to the step) instead of a box centred on the address."""
    snap = lambda x: round(round(x / step) * step, 2)
    la0, la1, lo0, lo1 = snap(lat0), snap(lat1), snap(lon0), snap(lon1)
    nla, nlo = int(round((la1 - la0) / step)) + 1, int(round((lo1 - lo0) / step)) + 1
    pts = [(round(la0 + i * step, 2), round(lo0 + j * step, 2)) for i in range(nla) for j in range(nlo)]
    return pts, dict(lat=[la0, la1], lon=[lo0, lo1], rows=nla, cols=nlo)


def build(slug, lat, lon, start=None, half_lat=6.0, half_lon=8.5, step=0.5, years=(2000, 2025), box=None):
    series = point_series(slug, lat, lon, *years)
    summ = summarize(series)
    tz = summ["timezone"] or "America/Chicago"
    if start:
        s = date.fromisoformat(start)
    else:
        s = date.fromisoformat(summ["hottest"]["date"]) - timedelta(days=3)
    e = s + timedelta(days=6)
    days = [(s + timedelta(days=i)).isoformat() for i in range(7)]
    lookup = dict(zip(series["daily"]["time"], series["daily"]["apparent_temperature_max"]))
    worst = dict(start=days[0], end=days[-1], rule="7 days centred on the hottest day" if not start else "--start override",
                 daily=[dict(date=d, feelsF=None if lookup.get(d) is None else round(lookup[d], 1)) for d in days])
    pts, bounds = box_lattice(*box, step) if box else lattice(lat, lon, half_lat, half_lon, step)
    cache = fetch_grid(pts, days[0], days[-1], tz)
    cells = []
    for a, b in pts:
        v = cache[f"{a},{b}"]["v"]
        if v and None not in v:
            cells.append([a, b, [round(x, 1) for x in v]])
    peak = max(((c[2][i], c[0], c[1], days[i]) for c in cells for i in range(7)), default=None)
    out = dict(slug=slug, address=dict(lat=lat, lon=lon), built=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               source="Open-Meteo historical weather API (archive-api.open-meteo.com, reanalysis)",
               variable="apparent_temperature_max", unit="F", timezone=tz, thresholdF=THRESHOLD_F,
               point=dict(summ, worstWeek=worst), days=days, step=step, bounds=bounds,
               cells=cells, dropped=len(pts) - len(cells),
               gridPeak=dict(feelsF=peak[0], lat=peak[1], lon=peak[2], date=peak[3]) if peak else None,
               distinctReanalysisCells=len({tuple(cache[f'{a},{b}']['snap']) for a, b in pts}),
               note="History, not a forecast. Grid points are 0.5 deg apart; values are the nearest reanalysis cell.")
    os.makedirs(HEAT_DIR, exist_ok=True)
    path = os.path.join(HEAT_DIR, f"{slug}.json")
    json.dump(out, open(path, "w"), separators=(",", ":"))
    return path, out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--start", help="YYYY-MM-DD first day of the week (default: centred on the hottest day)")
    ap.add_argument("--half-lat", type=float, default=6.0)
    ap.add_argument("--half-lon", type=float, default=8.5)
    ap.add_argument("--step", type=float, default=0.5)
    ap.add_argument("--bounds", help="LAT0,LAT1,LON0,LON1 explicit grid box (overrides --half-lat/--half-lon)")
    a = ap.parse_args(argv)
    box = tuple(float(x) for x in a.bounds.split(",")) if a.bounds else None
    if box and (len(box) != 4 or box[0] >= box[1] or box[2] >= box[3]):
        raise SystemExit("--bounds must be LAT0,LAT1,LON0,LON1 with LAT0 < LAT1 and LON0 < LON1")
    path, out = build(a.slug, a.lat, a.lon, a.start, a.half_lat, a.half_lon, a.step, box=box)
    p = out["point"]
    print(json.dumps(dict(path=path, bytes=os.path.getsize(path), hottest=p["hottest"], week=[out["days"][0], out["days"][-1]],
                          cells=len(out["cells"]), dropped=out["dropped"], peak=out["gridPeak"], tz=out["timezone"])))


if __name__ == "__main__":
    main()
