"""Shared helpers for the Climate Rewind pipeline: paths, time zones, distance, precision rules."""
from __future__ import annotations

import gzip
import json
import math
import os
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(HERE, "out")
# Set MEMORIA_DATA_DIR (for example ../data) to write the index and heat files straight into the web app's data folder.
_DATA = os.environ.get("MEMORIA_DATA_DIR")
INDEX_DIR = os.path.join(_DATA, "index") if _DATA else os.path.join(OUT, "index")
DETECTIVE_DIR = os.path.join(OUT, "detective")
HEAT_DIR = os.path.join(_DATA, "heat") if _DATA else os.path.join(OUT, "heat")
EVENTS_DIR = os.path.join(_DATA, "events") if _DATA else os.path.join(OUT, "events")
CACHE_DIR = os.path.join(HERE, "cache")

STATE_NAMES = {
    "TN": "TENNESSEE", "TX": "TEXAS", "NC": "NORTH CAROLINA",
    "MO": "MISSOURI", "AZ": "ARIZONA", "GA": "GEORGIA",
    "WA": "WASHINGTON",
    # added Oct 8 2026: Storm-Events-only states (area events for all; point index without LSR/detective)
    "AL": "ALABAMA", "AK": "ALASKA", "AR": "ARKANSAS", "CA": "CALIFORNIA", "CO": "COLORADO",
    "CT": "CONNECTICUT", "DE": "DELAWARE", "DC": "DISTRICT OF COLUMBIA", "FL": "FLORIDA", "HI": "HAWAII",
    "ID": "IDAHO", "IL": "ILLINOIS", "IN": "INDIANA", "IA": "IOWA", "KS": "KANSAS", "KY": "KENTUCKY",
    "LA": "LOUISIANA", "ME": "MAINE", "MD": "MARYLAND", "MA": "MASSACHUSETTS", "MI": "MICHIGAN",
    "MN": "MINNESOTA", "MS": "MISSISSIPPI", "MT": "MONTANA", "NE": "NEBRASKA", "NV": "NEVADA",
    "NH": "NEW HAMPSHIRE", "NJ": "NEW JERSEY", "NM": "NEW MEXICO", "NY": "NEW YORK", "ND": "NORTH DAKOTA",
    "OH": "OHIO", "OK": "OKLAHOMA", "OR": "OREGON", "PA": "PENNSYLVANIA", "RI": "RHODE ISLAND",
    "SC": "SOUTH CAROLINA", "SD": "SOUTH DAKOTA", "UT": "UTAH", "VT": "VERMONT", "VA": "VIRGINIA",
    "WV": "WEST VIRGINIA", "WI": "WISCONSIN", "WY": "WYOMING",
}
# States whose index keeps IEM LSRs + detective results; never rebuilt by the Storm-Events-only path.
LSR_STATES = ("TN", "TX", "NC", "MO", "AZ", "GA", "WA")
_E, _C, _M, _P = "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"
DEFAULT_TZ = {  # fallback only (LSR times); per-county zones come from Storm Events CZ_TIMEZONE
    "TN": _C, "TX": _C, "NC": _E, "MO": _C, "AZ": "America/Phoenix", "GA": _E, "WA": _P,
    "AL": _C, "AK": "America/Anchorage", "AR": _C, "CA": _P, "CO": _M, "CT": _E, "DE": _E, "DC": _E, "FL": _E,
    "HI": "Pacific/Honolulu", "ID": _M, "IL": _C, "IN": "America/Indiana/Indianapolis", "IA": _C, "KS": _C,
    "KY": _E, "LA": _C, "ME": _E, "MD": _E, "MA": _E, "MI": _E, "MN": _C, "MS": _C, "MT": _M, "NE": _C, "NV": _P,
    "NH": _E, "NJ": _E, "NM": _M, "NY": _E, "ND": _C, "OH": _E, "OK": _C, "OR": _P, "PA": _E, "RI": _E, "SC": _E,
    "SD": _C, "UT": _M, "VT": _E, "VA": _E, "WV": _E, "WI": _C, "WY": _M,
}

# Storm Events CZ_TIMEZONE, e.g. "CST-6". Per NWSI 10-1605, Storm Data times are local STANDARD time.
# Files before ~2007 carry the bare abbreviation ("CST"); a few rows carry daylight labels ("PDT-7"), taken at face value.
_TZ_RE = re.compile(r"^([A-Z]+?)(-?\d+)?$")
_BARE_OFFSET = {"EST": -5, "CST": -6, "MST": -7, "PST": -8, "AKST": -9, "HST": -10, "AST": -4,
                "EDT": -4, "CDT": -5, "MDT": -6, "PDT": -7}


def parse_cz_offset(cz_tz: str) -> tuple[str, int]:
    m = _TZ_RE.match((cz_tz or "").strip().upper())
    if not m:
        raise ValueError(f"unparseable CZ_TIMEZONE {cz_tz!r}")
    abbr = m.group(1)
    if m.group(2) is not None:
        return abbr, int(m.group(2))
    if abbr not in _BARE_OFFSET:
        raise ValueError(f"unparseable CZ_TIMEZONE {cz_tz!r}")
    return abbr, _BARE_OFFSET[abbr]


def iana_for(state: str, tz_abbr: str) -> str:
    if tz_abbr.startswith("AK"):
        return "America/Anchorage"
    if tz_abbr.startswith("H"):  # HST: Hawaii, or the western Aleutians
        return "America/Adak" if state == "AK" else "Pacific/Honolulu"
    a = tz_abbr[0]  # E, C, M, P
    if a == "E":
        # Indiana's Eastern counties skipped DST before 2006; the Indianapolis zone encodes that history.
        return "America/Indiana/Indianapolis" if state == "IN" else "America/New_York"
    if a == "C":
        return "America/Chicago"
    if a == "M":
        return "America/Phoenix" if state == "AZ" else "America/Denver"
    if a == "P":
        return "America/Los_Angeles"
    raise ValueError(f"no IANA zone for {state} {tz_abbr}")


def se_time(date_time: str, cz_tz: str, state: str) -> datetime:
    """'27-MAR-21 21:55:00' + 'CST-6' -> aware datetime in the civil local zone (DST applied)."""
    if state == "AK" and (cz_tz or "").strip().upper() == "AST":
        cz_tz = "AKST-9"  # pre-2006 Alaska rows: bare "AST" = Alaska Standard Time, not Atlantic
    abbr, off = parse_cz_offset(cz_tz)
    naive = datetime.strptime(date_time.strip(), "%d-%b-%y %H:%M:%S")
    fixed = naive.replace(tzinfo=timezone(timedelta(hours=off)))
    return fixed.astimezone(ZoneInfo(iana_for(state, abbr)))


def lsr_time(valid_utc: str, iana: str) -> datetime:
    """IEM LSR 'valid' is UTC, e.g. '2021-03-28T03:55:00Z'."""
    t = datetime.strptime(valid_utc.replace("Z", ""), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    return t.astimezone(ZoneInfo(iana))


def iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def hav_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p = math.pi / 180
    x = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(min(1.0, x)))


def decimals(s: str) -> int:
    s = (s or "").strip()
    return len(s.split(".", 1)[1]) if "." in s else 0


# LSR city like "5 S THOMPSON'S STATION" or "0.5 NNE NASHVILLE" = distance prefix (an offset point, not a placeholder).
DIST_PREFIX = re.compile(r"^\s*\d+(?:\.\d+)?\s+(?:N|NNE|NE|ENE|E|ESE|SE|SSE|S|SSW|SW|WSW|W|WNW|NW|NNW)\s+\S")


def lsr_precision(city: str | None) -> str:
    """CONTRACT: LSR with a city field and no 'N SE' prefix = placeholder; otherwise rounded."""
    if city and city.strip() and not DIST_PREFIX.match(city):
        return "placeholder"
    return "rounded"


def se_precision(lat_s: str, lon_s: str, shared_count: int) -> str:
    """CONTRACT: >=3 decimals and not shared by >2 rows = precise; <=2 decimals = rounded.
    Gap in the contract: >=3 decimals but shared by >2 rows. We label that 'placeholder' (a stock point reused
    across reports is by definition not a measured spot). Missing coordinates = 'none'."""
    if not lat_s.strip() or not lon_s.strip():
        return "none"
    d = min(decimals(lat_s), decimals(lon_s))
    if d <= 2:
        return "rounded"
    return "precise" if shared_count <= 2 else "placeholder"


def read_index(st: str, path: str | None = None) -> dict:
    with gzip.open(path or os.path.join(INDEX_DIR, f"{st}.json.gz"), "rt", encoding="utf-8") as fh:
        return json.load(fh)


def write_index(st: str, data: dict, path: str | None = None) -> str:
    path = path or os.path.join(INDEX_DIR, f"{st}.json.gz")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=9) as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)
    return path
