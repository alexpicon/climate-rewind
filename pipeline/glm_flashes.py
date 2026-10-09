"""Lightning flashes for one storm replay night, from the GOES Geostationary Lightning Mapper.

Reads NOAA's public GLM Level 2 files (one every 20 seconds, the whole disk the satellite
sees) from the AWS open-data bucket, keeps the good-quality flashes inside the replay's map
box and time window, and writes them to public/data/lightning/<slug>/<night>.json with an
entry in public/data/lightning/index.json. Nothing is smoothed, sampled or invented: every
row is one flash as the satellite reported it.

What a flash's numbers mean (the page says so too): the position is the centroid of the
light the satellite saw (good to roughly 8 to 14 km), the energy is the radiant (light)
energy reaching the sensor, not the electrical current, and GLM sees all lightning, in
cloud as well as to ground.

    python glm_flashes.py --slug nashville --night 2021-03-28T03:55 \\
        --start 2021-03-28T03:05:00Z --end 2021-03-28T10:10:00Z \\
        --bounds -88.113,35.083,-85.442,37.253 --lat 36.168175 --lon -86.777516 --satellite 16

Needs netCDF4 (see requirements.txt). Run from pipeline/.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ElementTree
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import netCDF4
import numpy as np

LOG = logging.getLogger("glm_flashes")

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data" / "lightning"
BUCKET = "https://noaa-goes{satellite}.s3.amazonaws.com"
S3_NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"
FILE_START = re.compile(r"_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})(\d)_")
TIMEOUT_S = 30
WORKERS = 16
BATCH = 96


@dataclass(frozen=True)
class Night:
    """One replay night: where and when to keep flashes."""

    slug: str
    night_id: str
    start: datetime
    end: datetime
    bounds: tuple[float, float, float, float]
    lat: float
    lon: float
    satellite: int


def parse_time(text: str) -> datetime:
    """Reads an ISO time in UTC ("2021-03-28T03:05:00Z").

    Args:
        text: The time, with a trailing Z or an explicit UTC offset.

    Returns:
        The time as an aware UTC datetime.
    """
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(UTC)


def file_start(key: str) -> datetime | None:
    """The observation start time written in a GLM file name, or None if the name has none.

    Args:
        key: The object key, such as "GLM-L2-LCFA/2021/087/03/OR_GLM-L2-LCFA_G16_s20210870300000_...nc".

    Returns:
        The start time, to the tenth of a second.
    """
    match = FILE_START.search(key)
    if not match:
        return None
    year, doy, hour, minute, second, tenth = (int(part) for part in match.groups())
    return datetime(year, 1, 1, hour, minute, second, tenth * 100_000, tzinfo=UTC) + timedelta(days=doy - 1)


def list_keys(satellite: int, start: datetime, end: datetime) -> list[str]:
    """Lists the GLM files whose 20 seconds overlap [start, end].

    Args:
        satellite: The GOES number (16, 17, 18 or 19).
        start: The window's start.
        end: The window's end.

    Returns:
        The object keys, in time order.
    """
    keys: list[str] = []
    hour = start.replace(minute=0, second=0, microsecond=0)
    while hour <= end:
        prefix = f"GLM-L2-LCFA/{hour:%Y}/{hour:%j}/{hour:%H}/"
        token: str | None = None
        while True:
            url = f"{BUCKET.format(satellite=satellite)}/?list-type=2&prefix={prefix}"
            if token:
                url += f"&continuation-token={urllib.parse.quote(token)}"
            with urllib.request.urlopen(url, timeout=TIMEOUT_S) as response:
                tree = ElementTree.fromstring(response.read())
            keys += [node.text for node in tree.iter(f"{S3_NS}Key") if node.text]
            next_token = tree.find(f"{S3_NS}NextContinuationToken")
            if next_token is None or not next_token.text:
                break
            token = next_token.text
        hour += timedelta(hours=1)
    window_start = start - timedelta(seconds=20)
    return sorted(key for key in keys if (started := file_start(key)) and window_start <= started <= end)


def flashes_in(data: bytes, night: Night) -> list[list[float]]:
    """The good-quality flashes of one file that fall inside the night's box and window.

    Args:
        data: The NetCDF file's bytes.
        night: The night being extracted.

    Returns:
        Rows of [seconds since the night's start, lat, lon, energy in femtojoules, area in km2].
    """
    with netCDF4.Dataset("glm", memory=data) as dataset:
        if len(dataset.dimensions["number_of_flashes"]) == 0:
            return []
        lat = np.asarray(dataset.variables["flash_lat"][:], dtype=float)
        lon = np.asarray(dataset.variables["flash_lon"][:], dtype=float)
        energy = np.asarray(dataset.variables["flash_energy"][:], dtype=float)
        area = np.asarray(dataset.variables["flash_area"][:], dtype=float)
        quality = np.asarray(dataset.variables["flash_quality_flag"][:])
        offsets = dataset.variables["flash_time_offset_of_first_event"]
        base = parse_time(offsets.units.removeprefix("seconds since ").replace(" ", "T") + "Z")
        seconds = np.asarray(offsets[:], dtype=float)
    west, south, east, north = night.bounds
    keep = (quality == 0) & (lon >= west) & (lon <= east) & (lat >= south) & (lat <= north)
    rows: list[list[float]] = []
    for i in np.flatnonzero(keep):
        when = base + timedelta(seconds=float(seconds[i]))
        if not night.start <= when <= night.end:
            continue
        rows.append([
            round((when - night.start).total_seconds(), 1),
            round(float(lat[i]), 4),
            round(float(lon[i]), 4),
            round(float(energy[i]) * 1e15, 1),
            round(float(area[i]) / 1e6, 1),
        ])
    return rows


def fetch(satellite: int, key: str) -> bytes | None:
    """Downloads one file into memory, trying twice.

    Args:
        satellite: The GOES number.
        key: The object key.

    Returns:
        The bytes, or None when both tries fail.
    """
    url = f"{BUCKET.format(satellite=satellite)}/{key}"
    for attempt in (1, 2):
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT_S) as response:
                return response.read()
        except OSError as error:
            LOG.warning("try %d failed for %s: %s", attempt, key, error)
    return None


def extract(night: Night) -> dict:
    """Reads every file of the night and builds the output document.

    Args:
        night: The night to extract.

    Returns:
        The JSON-ready document, flashes sorted by time.
    """
    keys = list_keys(night.satellite, night.start, night.end)
    LOG.info("%s %s: %d files from GOES-%d", night.slug, night.night_id, len(keys), night.satellite)
    flashes: list[list[float]] = []
    missing = 0
    # Downloads run in parallel; the NetCDF library is not thread-safe, so every file is parsed here, one at a time. Batches keep
    # at most BATCH files in memory.
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for begin in range(0, len(keys), BATCH):
            batch = keys[begin : begin + BATCH]
            for data in pool.map(lambda key: fetch(night.satellite, key), batch):
                if data is None:
                    missing += 1
                else:
                    flashes += flashes_in(data, night)
            LOG.info("  %d of %d files, %d flashes so far", begin + len(batch), len(keys), len(flashes))
    flashes.sort(key=lambda row: row[0])
    expected = int((night.end - night.start).total_seconds() // 20) + 1
    return {
        "source": f"NOAA GOES-{night.satellite} Geostationary Lightning Mapper, Level 2 flashes (AWS open data)",
        "note": "Position is the centroid of the light the satellite saw (roughly 8 to 14 km). Energy is radiant energy at the sensor, not current. All lightning, in cloud and to ground.",
        "slug": night.slug,
        "nightId": night.night_id,
        "lat": night.lat,
        "lon": night.lon,
        "startUtc": night.start.isoformat().replace("+00:00", "Z"),
        "endUtc": night.end.isoformat().replace("+00:00", "Z"),
        "bounds": list(night.bounds),
        "files": len(keys),
        "filesExpected": expected,
        "filesMissing": missing,
        "columns": ["seconds since startUtc", "lat", "lon", "energy (femtojoules)", "area (km2)"],
        "flashes": flashes,
    }


def write(document: dict) -> Path:
    """Writes the night's file and updates the index.

    Args:
        document: The output of `extract`.

    Returns:
        The path of the night's file.
    """
    folder = OUT_DIR / document["slug"]
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{document['nightId'].replace(':', '')}.json"
    path.write_text(json.dumps(document, separators=(",", ":")), encoding="utf-8")
    index_path = OUT_DIR / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"nights": []}
    entry = {
        "slug": document["slug"],
        "nightId": document["nightId"],
        "lat": document["lat"],
        "lon": document["lon"],
        "file": str(path.relative_to(ROOT / "public")),
        "flashes": len(document["flashes"]),
    }
    index["nights"] = sorted(
        [n for n in index["nights"] if not (n["slug"] == entry["slug"] and n["nightId"] == entry["nightId"])] + [entry],
        key=lambda n: (n["slug"], n["nightId"]),
    )
    index_path.write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    return path


def main() -> None:
    """Parses the command line, extracts the night and writes it."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--slug", required=True)
    parser.add_argument("--night", required=True, help="the replay's night id, e.g. 2021-03-28T03:55")
    parser.add_argument("--start", required=True, help="UTC, e.g. 2021-03-28T03:05:00Z")
    parser.add_argument("--end", required=True)
    parser.add_argument("--bounds", required=True, help="west,south,east,north")
    parser.add_argument("--lat", type=float, required=True, help="the sample address")
    parser.add_argument("--lon", type=float, required=True)
    parser.add_argument("--satellite", type=int, required=True, choices=[16, 17, 18, 19])
    args = parser.parse_args()
    west, south, east, north = (float(part) for part in args.bounds.split(","))
    night = Night(args.slug, args.night, parse_time(args.start), parse_time(args.end), (west, south, east, north), args.lat, args.lon, args.satellite)
    document = extract(night)
    path = write(document)
    LOG.info("wrote %s: %d flashes, %d of %d files missing", path.relative_to(ROOT), len(document["flashes"]), document["filesMissing"], document["files"])


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
