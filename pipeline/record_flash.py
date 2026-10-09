"""The seconds of a record lightning flash, from the GOES Geostationary Lightning Mapper, for the landing page's replay.

Reads NOAA's public GLM Level 2 files (AWS open data) for a short window and keeps every light "group" (the satellite's
unit of light in one 2 ms frame) inside a box around the storm: its time, position and radiant energy. NOAA's routine
processing splits a megaflash into many short flashes, so the record is shown the way the certifying study found it: as
the light itself, spreading across the storm. Other flashes in the same storm in those seconds are in the file too; the
page says so. Nothing is smoothed or invented.

The default is the WMO-certified 768 km flash of 29 April 2020, which began at 14:32:39.016 UTC near Houston and ran into
southeastern Mississippi (Peterson et al., BAMS 2022). GOES-16 data on AWS begins on 13 February 2018, so the 829 km flash
of 22 October 2017 that has since taken the record is not in the public archive.

    python record_flash.py   # -> public/data/lightning/record-2020-04-29.json

Needs netCDF4 (see requirements.txt). Run from pipeline/.
"""

from __future__ import annotations

import json
import logging
import math
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path

import netCDF4
import numpy as np

from glm_flashes import fetch, list_keys

LOG = logging.getLogger("record_flash")
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "lightning" / "record-2020-04-29.json"

START = datetime(2020, 4, 29, 14, 32, 38, tzinfo=UTC)
END = START + timedelta(seconds=10)
# lat0, lat1, lon0, lon1: the Gulf coast from south Texas to Alabama.
BOX = (26.5, 34.0, -99.0, -86.5)
RECORD = {
    "lengthKm": 768,
    "lengthMi": 477,
    "began": "2020-04-29T14:32:39.016Z",
    "where": "from near Houston, Texas, into southeastern Mississippi",
    "certified": "World Meteorological Organization, 2022",
    "since": "An 829 km (515 mi) flash of 22 October 2017, from eastern Texas to near Kansas City, was certified in 2025 as the new record. GOES-16 data from 2017 is not in the public cloud archive.",
}


def groups_in(data: bytes) -> list[list[float]]:
    """The light groups of one file inside the box and window.

    Args:
        data: The NetCDF file's bytes.

    Returns:
        Rows of [milliseconds since START, lat, lon, energy in femtojoules].
    """
    with netCDF4.Dataset("glm", memory=data) as dataset:
        lat = np.asarray(dataset.variables["group_lat"][:], dtype=float)
        lon = np.asarray(dataset.variables["group_lon"][:], dtype=float)
        energy = np.asarray(dataset.variables["group_energy"][:], dtype=float)
        offsets = dataset.variables["group_time_offset"]
        base = datetime.fromisoformat(offsets.units.removeprefix("seconds since ").replace(" ", "T") + "+00:00")
        seconds = np.asarray(offsets[:], dtype=float)
    rows: list[list[float]] = []
    keep = (lat >= BOX[0]) & (lat <= BOX[1]) & (lon >= BOX[2]) & (lon <= BOX[3])
    for i in np.flatnonzero(keep):
        when = base + timedelta(seconds=float(seconds[i]))
        if START <= when <= END:
            rows.append([round((when - START).total_seconds() * 1000, 1), round(float(lat[i]), 3), round(float(lon[i]), 3), round(float(energy[i]) * 1e15, 1)])
    return rows


def span_km(rows: list[list[float]]) -> int:
    """The great-circle distance between the westernmost and easternmost light, in km.

    Args:
        rows: Group rows as written by `groups_in`.

    Returns:
        The span, rounded to the kilometre.
    """
    west = min(rows, key=lambda r: r[2])
    east = max(rows, key=lambda r: r[2])
    p1, p2 = math.radians(west[1]), math.radians(east[1])
    dl = math.radians(east[2] - west[2])
    return round(6371 * math.acos(min(1.0, math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dl))))


def main() -> None:
    """Fetches the window's files and writes the record file."""
    keys = list_keys(16, START, END)
    rows: list[list[float]] = []
    for key in keys:
        data = fetch(16, key)
        if data is None:
            message = f"could not read {key}"
            raise RuntimeError(message)
        rows += groups_in(data)
    rows.sort(key=lambda r: r[0])
    out = {
        "source": "NOAA GOES-16 Geostationary Lightning Mapper, Level 2 light groups (AWS open data)",
        "note": "Every light group the satellite recorded over this storm in these ten seconds, the record flash and the other flashes in the storm alike. A group's position is the centre of the light the satellite saw (roughly 8 to 14 km).",
        "record": RECORD,
        "startUtc": START.isoformat().replace("+00:00", "Z"),
        "endUtc": END.isoformat().replace("+00:00", "Z"),
        "box": list(BOX),
        "files": [key.rsplit("/", 1)[-1] for key in keys],
        "spanKm": span_km(rows),
        "columns": ["ms since startUtc", "lat", "lon", "energy (femtojoules)"],
        "groups": rows,
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    LOG.info("wrote %s: %d groups from %d files, span %d km", OUT.relative_to(ROOT), len(rows), len(keys), out["spanKm"])


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
