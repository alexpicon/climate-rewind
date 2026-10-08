#!/usr/bin/env python3
"""
Builds tests/fixtures/index/TN.json.gz, the development FIXTURE for Tennessee.

Everything in it is a real NWS row taken from the approved prototype's raw data
(../mocks/assets/v3/raw): the 59 flood Local Storm Reports of Mar 27-28, 2021,
ten Nashville flood events and the Nashville-area tornadoes from NCEI Storm Events
(with the full verbatim narratives and the NWS's own coordinates).
It is NOT the pipeline index and says so ("fixture": true). Koda's pipeline output
replaces it later (same shape, see CONTRACT.md).

The detective has not been run, so `placed` and `detective` are null, with one
exception: 95 Wallace Road, where the report text is a street address and the
prototype checked it by hand against the Census geocoder.

Run from the repo root:  python3 scripts/build-fixture.py
"""
import csv
import gzip
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT.parent / "mocks" / "assets" / "v3" / "raw"
OUT = ROOT / "tests" / "fixtures" / "index" / "TN.json.gz"

CENTRAL = ZoneInfo("America/Chicago")
NASHVILLE_PLACEHOLDER = (36.17, -86.78)

# Tornado events from the prototype's 10 km search (data.js), plus the Wilson Co. part
# of the Mar 3, 2020 EF3. Only the ids are taken from there; every field comes from Storm Events.
TORNADO_IDS = [
    "5133907", "5146065", "5146066", "5146465", "5356644", "5481500", "165305", "251494",
    "428683", "719854", "719856", "882999", "883007", "999627", "1144554",
]

# Nashville flood events from the answer key (../research/memoria-gate/answers/answer_key.csv, address 3).
# Every field is read back from the Storm Events bulk files; nothing is typed in by hand.
FLOOD_EVENT_IDS = [
    "688349", "702795", "810951", "976572", "978823", "978822", "985943", "1011060", "1167968", "1228400",
]

# Hand check from the prototype: "95 Wallace Road" is a street address; Census match below.
WALLACE_ROAD = {
    "remark_contains": "95 WALLACE ROAD",
    "placed": [36.0825, -86.7021],
    "match": "95 WALLACE RD, NASHVILLE, TN 37211",
}


def local_iso(utc_text: str) -> str:
    moment = datetime.strptime(utc_text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return moment.astimezone(CENTRAL).isoformat()


def standard_offset_hours(cz_timezone: str) -> int:
    """Storm Events times are local standard time: 'CST-6' (newer rows) or just 'CST' (older rows)."""
    explicit = re.search(r"(-?\d+)$", cz_timezone)
    if explicit:
        return int(explicit.group(1))
    return {"CST": -6, "EST": -5}[cz_timezone[:3]]


def coord_precision(props: dict) -> str:
    """CONTRACT rule: an LSR with a bare city and no 'N SE' distance prefix is a placeholder."""
    city = props.get("city") or ""
    has_distance_prefix = re.match(r"^\d+\s+[NSEW]{1,3}\s+", city, re.I) is not None
    return "placeholder" if city and not has_distance_prefix else "rounded"


def lsr_flood_rows() -> list[dict]:
    raw = json.loads((RAW / "lsr_raw.json").read_text())
    rows, seen = [], {}
    for feature in raw["features"]:
        props = feature["properties"]
        if "FLOOD" not in props["typetext"]:
            continue
        key = (props["wfo"], props["valid"])
        seen[key] = seen.get(key, -1) + 1
        row = {
            "id": f"LSR-{props['wfo']}-{props['valid'].replace('-', '').replace(':', '')}-{seen[key]}",
            "source": "LSR",
            "type": props["typetext"].title(),
            "start": local_iso(props["valid"]),
            "county": props["county"].title(),
            "wfo": props["wfo"],
            "city": props["city"].upper(),
            "quote": props["remark"],
            "filed": [props["lat"], props["lon"]],
            "coordPrecision": coord_precision(props),
            "placed": None,
            "detective": None,
            "dupOf": None,
        }
        if WALLACE_ROAD["remark_contains"] in props["remark"].upper():
            row["placed"] = WALLACE_ROAD["placed"]
            row["detective"] = {
                "verdict": "placed",
                "clues": ["95 Wallace Road"],
                "match": WALLACE_ROAD["match"],
                "matchType": "address",
                "confidence": "high",
                "model": "manual Census check (prototype); the AI detective has not run on this row",
                "ranAt": "2026-10-07T00:00:00Z",
            }
        rows.append(row)
    return rows


def read_storm_events(wanted: set[str]) -> dict[str, dict]:
    """Scans the NCEI Storm Events bulk files once for the given event ids."""
    found: dict[str, dict] = {}
    for path in sorted((RAW / "se").glob("StormEvents_details-*.csv.gz")):
        with gzip.open(path, "rt", newline="") as handle:
            for record in csv.DictReader(handle):
                if record["EVENT_ID"] in wanted:
                    found[record["EVENT_ID"]] = record
    missing = wanted - set(found)
    if missing:
        sys.exit(f"Storm Events rows not found: {sorted(missing)}")
    return found


def storm_local_iso(record: dict) -> str:
    """Storm Events begin time as local time with an offset (the files use local standard time)."""
    offset_hours = standard_offset_hours(record["CZ_TIMEZONE"])
    begun = datetime.strptime(
        f"{record['BEGIN_YEARMONTH']}{record['BEGIN_DAY'].zfill(2)}{record['BEGIN_TIME'].zfill(4)}", "%Y%m%d%H%M"
    )
    return begun.replace(tzinfo=timezone(timedelta(hours=offset_hours))).isoformat()


def decimals(text: str) -> int:
    return len(text.split(".")[1]) if "." in text else 0


def storm_event_flood_row(r: dict) -> dict:
    if r["EVENT_TYPE"] not in ("Flash Flood", "Flood"):
        sys.exit(f"{r['EVENT_ID']} is a {r['EVENT_TYPE']}, not a flood")
    # CONTRACT: Storm Events with 3+ decimals are "precise" (the "shared by more than 2 rows" check needs the full state file).
    precise = decimals(r["BEGIN_LAT"]) >= 3 and decimals(r["BEGIN_LON"]) >= 3
    return {
        "id": f"SE-{r['EVENT_ID']}",
        "source": "StormEvents",
        "type": r["EVENT_TYPE"],
        "start": storm_local_iso(r),
        "county": r["CZ_NAME"].title(),
        "wfo": r["WFO"],
        "city": r["BEGIN_LOCATION"],
        "quote": r["EVENT_NARRATIVE"],
        "filed": [float(r["BEGIN_LAT"]), float(r["BEGIN_LON"])],
        "coordPrecision": "precise" if precise else "rounded",
        "placed": None,
        "detective": None,
        "dupOf": None,
    }


def tornado_row(r: dict) -> dict:
    if r["EVENT_TYPE"] != "Tornado":
        sys.exit(f"{r['EVENT_ID']} is a {r['EVENT_TYPE']}, not a tornado")
    return {
        "id": f"SE-{r['EVENT_ID']}",
        "start": storm_local_iso(r),
        "ef": r["TOR_F_SCALE"],
        "begin": [float(r["BEGIN_LAT"]), float(r["BEGIN_LON"])],
        "end": [float(r["END_LAT"]), float(r["END_LON"])],
        "widthYd": int(float(r["TOR_WIDTH"] or 0)),
        "lengthMi": float(r["TOR_LENGTH"] or 0),
        "deaths": int(r["DEATHS_DIRECT"] or 0) + int(r["DEATHS_INDIRECT"] or 0),
        "injuries": int(r["INJURIES_DIRECT"] or 0) + int(r["INJURIES_INDIRECT"] or 0),
        "narrative": r["EVENT_NARRATIVE"],
        "episodeNarrative": r["EPISODE_NARRATIVE"],
    }


def main() -> None:
    events = read_storm_events(set(FLOOD_EVENT_IDS) | set(TORNADO_IDS))
    index = {
        "state": "TN",
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fixture": True,
        "sources": [
            "FIXTURE: NCEI Storm Events (Nashville area tornadoes, two flood rows)",
            "FIXTURE: IEM Local Storm Reports, OHX, Mar 27-28 2021",
        ],
        "floods": [storm_event_flood_row(events[i]) for i in FLOOD_EVENT_IDS] + lsr_flood_rows(),
        "tornadoes": [tornado_row(events[i]) for i in TORNADO_IDS],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(OUT, "wt") as handle:
        json.dump(index, handle, separators=(",", ":"))
    print(f"wrote {OUT}: {len(index['floods'])} floods, {len(index['tornadoes'])} tornadoes")


if __name__ == "__main__":
    main()
