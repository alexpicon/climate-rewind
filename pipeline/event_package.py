"""Builds the landing page's event replays: public/data/events/<id>.json, one self-contained file per event.

Each package holds, for the event's box and hours:

- wind: NOAA's HRRR weather model (3 km), hour by hour, as archived by Open-Meteo's historical-forecast API, sampled on a
  regular grid: 10 m wind speed and direction and the gust, in mph. It is a model's picture of the wind, not measurements.
- track (hurricanes): NHC's official best track (HURDAT2): position, peak wind, pressure and the 34, 50 and 64 knot wind
  radii by quadrant, every six hours and at landfall.
- reports: the National Weather Service's Local Storm Reports in the box and hours, through Iowa State's IEM (wind gusts
  measured or estimated, damage, tornadoes, floods, storm surge), verbatim.

    python event_package.py                 # every event
    python event_package.py --only ian      # one

Network: archive-api style requests to Open-Meteo (keyless; a few hundred calls an event), one IEM request, and the HURDAT2
file from the NHC (fetched once into out/). Run from pipeline/.
"""

from __future__ import annotations

import argparse
import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

LOG = logging.getLogger("event_package")
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data" / "events"
CACHE = Path(__file__).resolve().parent / "out" / "events"
HURDAT2_URL = "https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-092326.txt"
OPEN_METEO = "https://historical-forecast-api.open-meteo.com/v1/forecast"
IEM_LSR = "https://mesonet.agron.iastate.edu/geojson/lsr.php"
BATCH = 80
TIMEOUT_S = 60


@dataclass(frozen=True)
class Event:
    """One event to package."""

    id: str
    title: str
    start: datetime
    end: datetime
    # south, north, west, east
    box: tuple[float, float, float, float]
    step: float
    states: tuple[str, ...]
    hurricane: str | None = None


EVENTS = [
    Event(
        id="ian",
        title="Hurricane Ian makes landfall",
        start=datetime(2022, 9, 28, 0, tzinfo=UTC),
        end=datetime(2022, 9, 29, 12, tzinfo=UTC),
        box=(24.0, 29.6, -85.0, -79.6),
        step=0.25,
        states=("FL",),
        hurricane="AL092022",
    ),
    Event(
        id="derecho",
        title="The Iowa derecho",
        start=datetime(2020, 8, 10, 12, tzinfo=UTC),
        end=datetime(2020, 8, 11, 2, tzinfo=UTC),
        box=(40.3, 43.7, -97.0, -86.8),
        step=0.25,
        states=("IA", "IL", "NE"),
    ),
    Event(
        id="helene",
        title="Hurricane Helene from the Gulf to the mountains",
        start=datetime(2024, 9, 26, 12, tzinfo=UTC),
        end=datetime(2024, 9, 27, 18, tzinfo=UTC),
        box=(26.0, 37.0, -87.5, -79.5),
        step=0.35,
        states=("FL", "GA", "SC", "NC", "TN"),
        hurricane="AL092024",
    ),
]


def get_json(url: str) -> object:
    """GETs JSON with a few retries for rate limits.

    Args:
        url: The URL.

    Returns:
        The parsed JSON.
    """
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT_S) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", "replace")
            if error.code == 429 and "daily" not in body.lower() and attempt < 4:
                wait = 10 * (attempt + 1)
                LOG.info("  rate limited, waiting %d s", wait)
                time.sleep(wait)
                continue
            message = f"HTTP {error.code} from {url[:80]}: {body[:160]}"
            raise RuntimeError(message) from error
    message = f"gave up on {url[:80]}"
    raise RuntimeError(message)


def grid(event: Event) -> list[tuple[float, float]]:
    """The event's sample points, row by row from the south-west.

    Args:
        event: The event.

    Returns:
        (lat, lon) points every `step` degrees inside the box.
    """
    south, north, west, east = event.box
    rows = int(round((north - south) / event.step)) + 1
    cols = int(round((east - west) / event.step)) + 1
    return [(round(south + r * event.step, 3), round(west + c * event.step, 3)) for r in range(rows) for c in range(cols)]


def wind(event: Event) -> dict:
    """The HRRR wind on the event's grid, every hour.

    Args:
        event: The event.

    Returns:
        {lats, lons, rows, cols, hours, speed, dir, gust}: per hour, one value per point in grid order (mph, degrees from).
    """
    points = grid(event)
    hours: list[str] | None = None
    speed: list[list[int]] = []
    direction: list[list[int]] = []
    gust: list[list[int]] = []
    for begin in range(0, len(points), BATCH):
        batch = points[begin : begin + BATCH]
        query = {
            "latitude": ",".join(str(p[0]) for p in batch),
            "longitude": ",".join(str(p[1]) for p in batch),
            "start_date": event.start.date().isoformat(),
            "end_date": event.end.date().isoformat(),
            "hourly": "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
            "wind_speed_unit": "mph",
            "timezone": "GMT",
            "models": "gfs_hrrr",
        }
        reply = get_json(f"{OPEN_METEO}?{urllib.parse.urlencode(query)}")
        locations = reply if isinstance(reply, list) else [reply]
        for location in locations:
            hourly = location["hourly"]
            keep = [i for i, t in enumerate(hourly["time"]) if event.start <= datetime.fromisoformat(t + "+00:00") <= event.end]
            if hours is None:
                hours = [hourly["time"][i] + ":00Z" for i in keep]
            speed.append([round(hourly["wind_speed_10m"][i] or 0) for i in keep])
            direction.append([round(hourly["wind_direction_10m"][i] or 0) for i in keep])
            gust.append([round(hourly["wind_gusts_10m"][i] or 0) for i in keep])
        LOG.info("  wind: %d of %d points", min(begin + BATCH, len(points)), len(points))
    # Transposed: one list per hour, a value per point.
    by_hour = lambda series: [[series[p][h] for p in range(len(points))] for h in range(len(hours or []))]  # noqa: E731
    south, north, west, east = event.box
    return {
        "source": "NOAA HRRR weather model (3 km), hour by hour, as archived by Open-Meteo: a model's picture of the wind, not measurements",
        "step": event.step,
        "south": south,
        "west": west,
        "rows": int(round((north - south) / event.step)) + 1,
        "cols": int(round((east - west) / event.step)) + 1,
        "hours": hours,
        "speed": by_hour(speed),
        "dir": by_hour(direction),
        "gust": by_hour(gust),
    }


def hurdat2_track(storm_id: str, event: Event) -> list[dict]:
    """The NHC best track of one storm inside the event's hours (plus one point either side).

    Args:
        storm_id: The HURDAT2 id, like AL092022.
        event: The event.

    Returns:
        Points: time, lat, lon, wind (kt), pressure (mb), status, landfall flag and wind radii (nm, NE SE SW NW) at 34, 50, 64 kt.
    """
    CACHE.mkdir(parents=True, exist_ok=True)
    local = CACHE / "hurdat2.txt"
    if not local.exists():
        with urllib.request.urlopen(HURDAT2_URL, timeout=TIMEOUT_S) as response:
            local.write_bytes(response.read())
    lines = local.read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith(storm_id))
    count = int(lines[start].split(",")[2])
    points = []
    for line in lines[start + 1 : start + 1 + count]:
        f = [part.strip() for part in line.split(",")]
        when = datetime.strptime(f[0] + f[1], "%Y%m%d%H%M").replace(tzinfo=UTC)
        lat = float(f[4][:-1]) * (1 if f[4].endswith("N") else -1)
        lon = float(f[5][:-1]) * (-1 if f[5].endswith("W") else 1)
        radii = [int(x) if x not in ("", "-999") else 0 for x in f[8:20]]
        points.append({
            "t": when.isoformat().replace("+00:00", "Z"),
            "lat": lat,
            "lon": lon,
            "windKt": int(f[6]),
            "pressureMb": int(f[7]),
            "status": f[3],
            "landfall": f[2] == "L",
            "r34": radii[0:4],
            "r50": radii[4:8],
            "r64": radii[8:12],
        })
    inside = [i for i, p in enumerate(points) if event.start <= datetime.fromisoformat(p["t"].replace("Z", "+00:00")) <= event.end]
    first, last = max(0, inside[0] - 1), min(len(points) - 1, inside[-1] + 1)
    return points[first : last + 1]


def storm_reports(event: Event) -> list[dict]:
    """The NWS Local Storm Reports in the event's box and hours.

    Args:
        event: The event.

    Returns:
        Reports: time, lat, lon, type, magnitude and unit, whether measured, city, state, and the verbatim remark.
    """
    query = {
        "sts": event.start.strftime("%Y%m%d%H%M"),
        "ets": event.end.strftime("%Y%m%d%H%M"),
        "states": ",".join(event.states),
    }
    reply = get_json(f"{IEM_LSR}?{urllib.parse.urlencode(query)}")
    south, north, west, east = event.box
    reports = []
    for feature in reply["features"]:
        p = feature["properties"]
        lat, lon = float(p["lat"]), float(p["lon"])
        if not (south <= lat <= north and west <= lon <= east):
            continue
        magnitude = p.get("magnitude")
        reports.append({
            "t": p["valid"] if "valid" in p else None,
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "type": p["typetext"],
            "mag": float(magnitude) if magnitude not in (None, "", "None") else None,
            "unit": p.get("unit") or "",
            "measured": p.get("qualifier") == "M",
            "city": p.get("city") or "",
            "state": p.get("state") or p.get("st") or "",
            "remark": p.get("remark") or "",
        })
    return [r for r in reports if r["t"]]


def build(event: Event) -> Path:
    """Builds and writes one event's package.

    Args:
        event: The event.

    Returns:
        The written file.
    """
    LOG.info("%s: %s", event.id, event.title)
    package = {
        "id": event.id,
        "title": event.title,
        "startUtc": event.start.isoformat().replace("+00:00", "Z"),
        "endUtc": event.end.isoformat().replace("+00:00", "Z"),
        "box": list(event.box),
        "built": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "wind": wind(event),
        "track": hurdat2_track(event.hurricane, event) if event.hurricane else None,
        "trackSource": "NOAA National Hurricane Center best track (HURDAT2)" if event.hurricane else None,
        "reports": storm_reports(event),
        "reportsSource": "National Weather Service Local Storm Reports, through Iowa State University's IEM",
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{event.id}.json"
    path.write_text(json.dumps(package, separators=(",", ":")), encoding="utf-8")
    LOG.info("  wrote %s: %d hours, %d points, %d reports%s", path.relative_to(ROOT), len(package["wind"]["hours"]), len(package["wind"]["speed"][0]), len(package["reports"]), f", {len(package['track'])} track points" if package["track"] else "")
    return path


def main() -> None:
    """Builds every event, or the one named with --only."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--only")
    args = parser.parse_args()
    for event in EVENTS:
        if args.only and event.id != args.only:
            continue
        build(event)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
