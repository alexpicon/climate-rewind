#!/usr/bin/env python3
"""
Builds data/outlook-record/<slug>.json for each sample address: "how the official outlooks have played out HERE".

It only counts. Nothing here is a forecast and nothing is fitted.

  Flood   For every day, the WPC Excessive Rainfall Outlook (ERO) category the early-morning Day 1 product gave this point
          (none / Marginal / Slight / Moderate / High), against whether a flood report was filed within 10 km that day.
  Tornado For every day, the SPC Day 1 tornado probability at this point (06Z product), against whether a tornado track passed
          within 25 miles (SPC's own definition: "within 25 miles of a point") that day.
  Heat    The daily feels-like highs since 2000 (the same Open-Meteo/ERA5 series the heat tab uses), so the app can say where a
          forecast feels-like would rank at this address.

Outlook archives come from the Iowa Environmental Mesonet bulk shapefiles (ERO: Nov 2015 on; SPC: 1987 on), one zip per month,
downloaded once into the cache folders and reused. Flood and tornado events come from data/index/<ST>.json.gz.

Honest choices (also written into each file):
  * A day is the NWS outlook day, 12Z to 12Z. A report is assigned to the outlook day it falls in (UTC time minus 12 h), so a flood
    reported at 2 am belongs to the evening's outlook, not the next day's.
  * The record starts 2016-10-01 (the ERO "Marginal" level was added in Aug/Oct 2016; earlier days would count it as "none").
    Flood days run to 2025-12-31 (IEM Local Storm Reports cover the whole year). Tornado days stop at 2025-06-30, because the NCEI
    Storm Events tornado rows in the index thin out after mid-2025 and a missing row would read as "no tornado".
  * Flood reports count only if they have a usable location: placed by the detective, or filed with precise/rounded coordinates.
    City-placeholder reports are left out (they say "somewhere in this city", not "within 10 km of here"). So these are floods that
    were REPORTED with a place, not every flood. As the detective places more reports, re-run this and the counts grow.
  * WPC redefined the ERO probabilities on 2022-02-10 (Marginal 5-10% became at least 5%, Slight 10-20% became at least 15%,
    Moderate 20-50% became at least 40%, High at least 50% became at least 70%). The file keeps the counts for before and after.
  * Days with no outlook product in the archive are not counted (they are listed as daysMissing).

Needs: python 3.10+, pandas, numpy, geopandas, shapely, requests (not part of the web app; pipeline/requirements.txt is Koda's).
Quinn's spike environment works:  /tmp/fspike/venv/bin/python scripts/outlook-record.py --ero-dir /tmp/fspike/ero

Run from the repo root:
  python3 scripts/outlook-record.py [--ero-dir DIR] [--spc-dir DIR] [--heat-dir DIR[,DIR...]] [--only slug]
"""
from __future__ import annotations

import argparse
import glob
import gzip
import json
import math
import sys
import tempfile
import time
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
INDEX_DIR = ROOT / "data" / "index"
SAMPLES_DIR = ROOT / "data" / "samples"
OUT_DIR = ROOT / "data" / "outlook-record"

RECORD_START = "2016-10-01"
FLOOD_END = "2025-12-31"
TORNADO_END = "2025-06-30"
FLOOD_RADIUS_KM = 10
TORNADO_RADIUS_MI = 25
TORNADO_RADIUS_KM = TORNADO_RADIUS_MI * 1.609344
ERO_REDEFINED = "2022-02-10"
FLOOD_TYPES = {"Flash Flood", "Flood", "FLASH FLOOD", "FLOOD"}
STATES = ["TN", "TX", "NC", "MO", "AZ", "GA", "WA"]
ERO_NAMES = {0: "none", 1: "MRGL", 2: "SLGT", 3: "MDT", 4: "HIGH"}
ERO_CODE = {"MRGL": 1, "SLGT": 2, "MDT": 3, "HIGH": 4}
IEM = "https://mesonet.agron.iastate.edu/cgi-bin/request/gis/outlooks.py"
HEAT_FIRST_YEAR = 2000


# ---------------------------------------------------------------- downloads

def month_range(first: str, last: str):
    y, m = int(first[:4]), int(first[5:7])
    ey, em = int(last[:4]), int(last[5:7])
    while (y, m) <= (ey, em):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def download_months(kind: str, folder: Path, first: str, last: str) -> None:
    """kind: 'E' (excessive rainfall) or 'C' (convective). One zip per month, skipped when already there."""
    import requests

    folder.mkdir(parents=True, exist_ok=True)
    for y, m in month_range(first, last):
        out = folder / f"{y}{m:02d}.zip"
        if out.exists():
            continue
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        params = dict(year1=y, month1=m, day1=1, hour1=0, minute1=0, year2=ny, month2=nm, day2=1, hour2=0, minute2=0, type=kind, d=1, geom="geom")
        for attempt in range(4):
            try:
                r = requests.get(IEM, params=params, timeout=300)
                if r.status_code == 200 and r.content[:2] == b"PK":
                    out.write_bytes(r.content)
                    break
                if b"no results" in r.content[:200]:
                    break  # an empty month (before the archive starts)
                print("  retry", kind, y, m, r.status_code, r.content[:80], file=sys.stderr)
            except Exception as error:  # network hiccup
                print("  retry", kind, y, m, error, file=sys.stderr)
            time.sleep(5)


def read_zips(folder: Path):
    import geopandas as gpd

    frames = []
    for z in sorted(folder.glob("*.zip")):
        tmp = tempfile.mkdtemp()
        zipfile.ZipFile(z).extractall(tmp)
        shp = glob.glob(tmp + "/*.shp")
        if shp:
            frames.append(gpd.read_file(shp[0]))
    return pd.concat(frames, ignore_index=True)


# ---------------------------------------------------------------- outlook lookup at points

def outlook_day(frame: pd.DataFrame) -> pd.DataFrame:
    """Adds issue/expire datetimes and `pdate`, the UTC date the 12Z-12Z outlook period starts."""
    frame = frame.copy()
    frame["issue"] = pd.to_datetime(frame.ISSUE, format="%Y%m%d%H%M")
    frame["expire"] = pd.to_datetime(frame.EXPIRE, format="%Y%m%d%H%M")
    frame["pdate"] = (frame.expire - pd.Timedelta(hours=24)).dt.floor("D")
    return frame


def ero_by_day(ero: pd.DataFrame, points: list[tuple[float, float]]) -> pd.DataFrame:
    """Per day and point: the early-morning (08Z) Day 1 ERO category 0..4. Days with no product at all are absent."""
    import shapely

    ero = outlook_day(ero[(ero.TYPE == "E") & (ero.DAY == 1)])
    xs = np.array([p[1] for p in points])
    ys = np.array([p[0] for p in points])
    products = ero[["pdate", "issue", "CYCLE"]].drop_duplicates().sort_values(["pdate", "issue"])
    polygons = ero[ero.THRESHOLD.notna() & ero.geometry.notna()]
    cats: dict[tuple, np.ndarray] = {}
    for (pdate, issue), group in polygons.groupby(["pdate", "issue"]):
        cat = np.zeros(len(points), int)
        for _, row in group.iterrows():
            code = ERO_CODE.get(row.THRESHOLD)
            if code is None:  # a future category (like Enhanced) is not in the archive yet
                continue
            inside = shapely.contains_xy(row.geometry, xs, ys)
            cat[inside] = np.maximum(cat[inside], code)
        cats[(pdate, issue)] = cat
    rows = []
    for pdate, group in products.groupby("pdate"):
        morning = group[group.CYCLE == 8]
        if len(morning) == 0:  # no 08Z product that day: the first one issued at or after 06Z
            morning = group[group.issue >= pdate + pd.Timedelta(hours=6)]
        if len(morning) == 0:
            continue
        cat = cats.get((pdate, morning.iloc[0].issue), np.zeros(len(points), int))
        for i in range(len(points)):
            rows.append((pdate.normalize(), i, int(cat[i])))
    return pd.DataFrame(rows, columns=["date", "pt", "ero"])


def spc_by_day(spc: pd.DataFrame, points: list[tuple[float, float]]) -> pd.DataFrame:
    """Per day and point: the 06Z Day 1 tornado probability in percent (0, 2, 5, 10, 15, 30, 45, 60). Days without a 06Z product are absent."""
    import shapely

    spc = outlook_day(spc[(spc.TYPE == "C") & (spc.DAY == 1)])
    xs = np.array([p[1] for p in points])
    ys = np.array([p[0] for p in points])
    morning = spc[spc.CYCLE == 6]
    rows = []
    for pdate, group in morning.groupby("pdate"):
        prob = np.zeros(len(points), int)
        for _, row in group[(group.CATEGORY == "TORNADO") & group.geometry.notna()].iterrows():
            try:
                value = round(float(row.THRESHOLD) * 100)
            except (TypeError, ValueError):
                continue  # SIGN / CIG hatching is not a probability
            inside = shapely.contains_xy(row.geometry, xs, ys)
            prob[inside] = np.maximum(prob[inside], value)
        for i in range(len(points)):
            rows.append((pdate.normalize(), i, int(prob[i])))
    return pd.DataFrame(rows, columns=["date", "pt", "tor"])


# ---------------------------------------------------------------- events from the index

def outlook_date(iso: str) -> pd.Timestamp:
    """The outlook day (12Z to 12Z) an event falls in, from its local ISO time with offset."""
    utc = datetime.fromisoformat(iso).astimezone(timezone.utc)
    return pd.Timestamp((utc - timedelta(hours=12)).date())


def haversine_km(la1, lo1, la2, lo2):
    p = math.pi / 180
    a = np.sin((la2 - la1) * p / 2) ** 2 + np.cos(la1 * p) * np.cos(la2 * p) * np.sin((lo2 - lo1) * p / 2) ** 2
    return 12742 * np.arcsin(np.sqrt(a))


def segment_km(lat, lon, a, b) -> float:
    """Shortest distance from a point to the track a-b (flat local projection, as lib/geo.ts does)."""
    kx = 111.32 * math.cos(lat * math.pi / 180)
    ky = 111.32
    ax, ay = (a[1] - lon) * kx, (a[0] - lat) * ky
    bx, by = (b[1] - lon) * kx, (b[0] - lat) * ky
    dx, dy = bx - ax, by - ay
    length = dx * dx + dy * dy
    t = 0.0 if length == 0 else max(0.0, min(1.0, (-ax * dx - ay * dy) / length))
    return math.hypot(ax + t * dx, ay + t * dy)


def load_events():
    floods, tornadoes = [], []
    for state in STATES:
        path = INDEX_DIR / f"{state}.json.gz"
        if not path.exists():
            continue
        data = json.load(gzip.open(path))
        for f in data["floods"]:
            if f.get("dupOf") is not None or f["type"] not in FLOOD_TYPES:
                continue
            placed = f.get("placed")
            if placed:
                point = placed
            elif f.get("filed") and f.get("coordPrecision") in ("precise", "rounded"):
                point = f["filed"]
            else:
                continue  # a city placeholder or no location: not "within 10 km of here"
            floods.append((outlook_date(f["start"]), point[0], point[1]))
        for t in data["tornadoes"]:
            tornadoes.append((outlook_date(t["start"]), t["begin"], t["end"]))
    return pd.DataFrame(floods, columns=["date", "lat", "lon"]), tornadoes


# ---------------------------------------------------------------- counting

def tally(frame: pd.DataFrame, level_col: str, hit_col: str, names: dict) -> dict:
    out = {}
    for level, name in names.items():
        sub = frame[frame[level_col] == level]
        out[name] = {"days": int(len(sub)), "hitDays": int(sub[hit_col].sum())}
    return out


def merge_levels(counts: dict, groups: dict[str, list[str]]) -> dict:
    merged = {}
    for name, parts in groups.items():
        merged[name] = {
            "days": sum(counts[p]["days"] for p in parts),
            "hitDays": sum(counts[p]["hitDays"] for p in parts),
        }
    return merged


def flood_record(slug_pt: int, lat: float, lon: float, ero: pd.DataFrame, floods: pd.DataFrame) -> dict:
    days = ero[(ero.pt == slug_pt) & (ero.date >= RECORD_START) & (ero.date <= FLOOD_END)].copy()
    near = floods[haversine_km(lat, lon, floods.lat.values, floods.lon.values) <= FLOOD_RADIUS_KM]
    flood_days = set(near.date.unique())
    days["hit"] = days.date.isin(flood_days).astype(int)
    all_days = pd.date_range(RECORD_START, FLOOD_END)
    redefined = pd.Timestamp(ERO_REDEFINED)
    return {
        "radiusKm": FLOOD_RADIUS_KM,
        "window": {"start": RECORD_START, "end": FLOOD_END},
        "days": int(len(days)),
        "daysMissing": int(len(all_days) - len(days)),
        "hitDays": int(days.hit.sum()),
        "reportsWithin10Km": int(len(near)),
        "redefined": ERO_REDEFINED,
        "byCategory": tally(days, "ero", "hit", ERO_NAMES),
        "beforeRedefinition": tally(days[days.date < redefined], "ero", "hit", ERO_NAMES),
        "sinceRedefinition": tally(days[days.date >= redefined], "ero", "hit", ERO_NAMES),
    }


def tornado_record(slug_pt: int, lat: float, lon: float, spc: pd.DataFrame, tornadoes: list) -> dict:
    days = spc[(spc.pt == slug_pt) & (spc.date >= RECORD_START) & (spc.date <= TORNADO_END)].copy()
    near_days = {d for d, a, b in tornadoes if segment_km(lat, lon, a, b) <= TORNADO_RADIUS_KM}
    days["hit"] = days.date.isin(near_days).astype(int)
    days["level"] = days.tor.map(lambda p: 0 if p == 0 else (2 if p == 2 else (5 if p == 5 else 10)))
    names = {0: "none", 2: "2", 5: "5", 10: "10+"}
    all_days = pd.date_range(RECORD_START, TORNADO_END)
    return {
        "radiusMi": TORNADO_RADIUS_MI,
        "window": {"start": RECORD_START, "end": TORNADO_END},
        "days": int(len(days)),
        "daysMissing": int(len(all_days) - len(days)),
        "hitDays": int(days.hit.sum()),
        "byProbability": tally(days, "level", "hit", names),
    }


# ---------------------------------------------------------------- heat

def heat_series(slug: str, lat: float, lon: float, heat_dirs: list[Path], cache_dir: Path) -> tuple[list, str] | None:
    """Daily feels-like highs (F) since 2000, from a saved Open-Meteo reply or a live request. None when neither is possible."""
    last_year = datetime.now(timezone.utc).year - 1
    name = f"point_{slug}_{HEAT_FIRST_YEAR}-{last_year}.json"
    for folder in heat_dirs + [cache_dir]:
        path = folder / name
        if path.exists():
            return parse_heat(json.loads(path.read_text()), f"saved copy of the Open-Meteo request ({name})")
    import requests

    url = (
        "https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={lat:.4f}&longitude={lon:.4f}&start_date={HEAT_FIRST_YEAR}-01-01&end_date={last_year}-12-31"
        "&daily=apparent_temperature_max&temperature_unit=fahrenheit&timezone=auto"
    )
    r = requests.get(url, timeout=120)
    if r.status_code != 200:
        print(f"  heat: Open-Meteo answered {r.status_code} ({r.text[:90]}); {slug} gets no heat history until this is run again", file=sys.stderr)
        return None
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / name).write_text(r.text)
    return parse_heat(r.json(), "Open-Meteo archive request made by this script")


def parse_heat(reply: dict, source: str) -> tuple[list, str]:
    times = reply["daily"]["time"]
    values = reply["daily"]["apparent_temperature_max"]
    start = datetime.fromisoformat(times[0]).date()
    series: list = []
    day = start
    lookup = dict(zip(times, values))
    end = datetime.fromisoformat(times[-1]).date()
    while day <= end:
        v = lookup.get(day.isoformat())
        series.append(None if v is None else round(float(v), 1))
        day += timedelta(days=1)
    return [start.isoformat(), series], source


# ---------------------------------------------------------------- main

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--ero-dir", default="/tmp/memoria-outlooks/ero")
    parser.add_argument("--spc-dir", default="/tmp/memoria-outlooks/spc")
    parser.add_argument("--heat-dir", default="", help="comma-separated folders with point_<slug>_2000-<year>.json")
    parser.add_argument("--heat-cache", default="/tmp/memoria-outlooks/heat")
    parser.add_argument("--only", default=None)
    args = parser.parse_args()

    samples = []
    for path in sorted(SAMPLES_DIR.glob("*.json")):
        s = json.loads(path.read_text())
        if args.only and s["slug"] != args.only:
            continue
        samples.append(s)
    points = [(s["lat"], s["lon"]) for s in samples]

    ero_dir, spc_dir = Path(args.ero_dir), Path(args.spc_dir)
    print("ERO archive ...")
    download_months("E", ero_dir, "2015-11", "2025-12")
    print("SPC archive ...")
    download_months("C", spc_dir, RECORD_START[:7], TORNADO_END[:7])
    ero = ero_by_day(read_zips(ero_dir), points)
    spc = spc_by_day(read_zips(spc_dir), points)
    floods, tornadoes = load_events()
    print(f"{len(floods)} placed flood reports, {len(tornadoes)} tornado tracks in the index")

    heat_dirs = [Path(p) for p in args.heat_dir.split(",") if p]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for i, s in enumerate(samples):
        lat, lon = s["lat"], s["lon"]
        record = {
            "slug": s["slug"],
            "address": s["address"],
            "lat": lat,
            "lon": lon,
            "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "flood": flood_record(i, lat, lon, ero, floods),
            "tornado": tornado_record(i, lat, lon, spc, tornadoes),
            "heat": None,
            "sources": [
                "WPC Excessive Rainfall Outlook, Day 1 (08Z), Iowa Environmental Mesonet archive",
                "SPC Day 1 convective outlook (06Z), Iowa Environmental Mesonet archive",
                "NWS Local Storm Reports and NCEI Storm Events (data/index)",
                "Open-Meteo archive (ERA5) daily apparent temperature high",
            ],
        }
        found = heat_series(s["slug"], lat, lon, heat_dirs, Path(args.heat_cache))
        if found:
            (start, series), source = found
            record["heat"] = {"source": source, "start": start, "feelsF": series}
        (OUT_DIR / f"{s['slug']}.json").write_text(json.dumps(record, separators=(",", ":")) + "\n")
        f, t = record["flood"], record["tornado"]
        print(f"\n{s['slug']}: flood {f['hitDays']}/{f['days']} days ({f['daysMissing']} missing); tornado {t['hitDays']}/{t['days']} days")
        for name, c in f["byCategory"].items():
            print(f"   ERO {name:5s} {c['hitDays']:4d} of {c['days']:5d}")
        for name, c in t["byProbability"].items():
            print(f"   SPC tornado {name:5s} {c['hitDays']:4d} of {c['days']:5d}")
        print("   heat:", "none" if not record["heat"] else f"{len(record['heat']['feelsF'])} days")
    return 0


if __name__ == "__main__":
    sys.exit(main())
