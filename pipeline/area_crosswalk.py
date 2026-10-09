"""County -> overlapping area codes (counties and NWS public forecast zones, including retired zone numbers).

Source: the IEM UGC database (https://mesonet.agron.iastate.edu/api/1/nws/ugcs.geojson?state=XX&valid=T). It keeps UGC codes
with begin/end dates and (simplified) geometries, so a snapshot at time T returns the zone polygons in force then. IEM says it has
tracked the database "since 2007"; zone codes retired before that are present too (named "Unknown WAZ007") with their geometry.

For every zone code in a state's events we take the zone polygon from the snapshot of each year it has events in (years before
2007 use the 2007 snapshot) and intersect it with that snapshot's county polygons. Overlap is estimated by sampling points inside
each polygon (numpy even-odd point-in-polygon, no GIS libraries). A zone maps to a county when the overlap is at least
MIN_FRAC of the zone or of the county; this drops the slivers that the simplified boundaries create along shared edges.

A zone whose polygon passes MIN_FRAC with no county (thin coastal or island strips against simplified county outlines) goes to
the county it overlaps most, or failing any overlap the nearest one, marked low confidence.
Fallback: a zone code with no IEM geometry at all is matched by name (its Storm Events CZ_NAME naming a county) and logged
as low confidence in the provenance file (pipeline/out/crosswalk/<ST>.json, not shipped).

Snapshots are cached in pipeline/cache/iem_ugc/<ST>.json.gz as {"geoms": {hash: geometry}, "snaps": {date: {ugc: hash}}}.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import time
from collections import defaultdict

import numpy as np
import requests

from common import CACHE_DIR, OUT

IEM_UGCS = "https://mesonet.agron.iastate.edu/api/1/nws/ugcs.geojson"
FIRST_SNAPSHOT_YEAR = 2007  # IEM history starts here; earlier event years use this snapshot
MIN_FRAC = 0.05  # simplified-boundary slivers measured up to ~2% in WA; real partial overlaps start ~5%
SAMPLES = 40  # grid side per polygon bbox (up to 1600 points before the inside test)
UA = {"User-Agent": "climate-rewind/0.1 (forgehacks)"}
UGC_CACHE = os.path.join(CACHE_DIR, "iem_ugc")


def snapshot_date(year: int) -> str:
    return f"{max(year, FIRST_SNAPSHOT_YEAR)}-07-01T00:00Z"


# ---------------------------------------------------------------- fetching (cached)

def _ghash(geom) -> str:
    return hashlib.sha1(json.dumps(geom, separators=(",", ":")).encode()).hexdigest()[:12]


def load_ugc_cache(st: str) -> dict:
    path = os.path.join(UGC_CACHE, f"{st}.json.gz")
    if os.path.exists(path):
        with gzip.open(path, "rt") as fh:
            return json.load(fh)
    return {"geoms": {}, "snaps": {}, "names": {}}


def save_ugc_cache(st: str, cache: dict) -> None:
    os.makedirs(UGC_CACHE, exist_ok=True)
    path = os.path.join(UGC_CACHE, f"{st}.json.gz")
    with gzip.open(path + ".tmp", "wt") as fh:
        json.dump(cache, fh, separators=(",", ":"))
    os.replace(path + ".tmp", path)


def fetch_snapshots(st: str, dates: list[str], session=None, offline: bool = False) -> dict:
    cache = load_ugc_cache(st)
    missing = [d for d in dates if d not in cache["snaps"]]
    if missing and offline:
        raise SystemExit(f"{st}: snapshots {missing} not cached (offline)")
    s = session or requests.Session()
    for d in missing:
        for attempt in range(4):
            try:
                r = s.get(IEM_UGCS, params={"state": st, "valid": d}, headers=UA, timeout=120)
                r.raise_for_status()
                feats = r.json()["features"]
                break
            except (requests.RequestException, ValueError):
                if attempt == 3:
                    raise
                time.sleep(3 * (attempt + 1))
        snap = {}
        for f in feats:
            ugc, g = f["properties"]["ugc"], f.get("geometry")
            if not g:
                continue
            h = _ghash(g)
            cache["geoms"].setdefault(h, g)
            cache["names"][ugc] = f["properties"].get("name") or ""
            snap[ugc] = h
        cache["snaps"][d] = snap
        save_ugc_cache(st, cache)
    return cache


# ---------------------------------------------------------------- geometry (pure numpy)

class Poly:
    """A (Multi)Polygon as one edge list; the even-odd rule handles holes and multiple parts."""

    def __init__(self, geom: dict):
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        x1, y1, x2, y2 = [], [], [], []
        self.area = 0.0
        for poly in polys:
            for k, ring in enumerate(poly):
                a = np.asarray(ring, dtype=float)
                if len(a) < 3:
                    continue
                if not np.array_equal(a[0], a[-1]):
                    a = np.vstack([a, a[:1]])
                x1.append(a[:-1, 0]); y1.append(a[:-1, 1]); x2.append(a[1:, 0]); y2.append(a[1:, 1])
                coslat = np.cos(np.radians(a[:, 1].mean()))
                ring_area = 0.5 * abs(np.dot(a[:-1, 0], a[1:, 1]) - np.dot(a[1:, 0], a[:-1, 1])) * coslat
                self.area += -ring_area if k > 0 else ring_area  # holes subtract (deg^2, latitude-scaled)
        self.x1, self.y1 = np.concatenate(x1), np.concatenate(y1)
        self.x2, self.y2 = np.concatenate(x2), np.concatenate(y2)
        self.bbox = (min(self.x1.min(), self.x2.min()), min(self.y1.min(), self.y2.min()),
                     max(self.x1.max(), self.x2.max()), max(self.y1.max(), self.y2.max()))
        self._samples = None

    def contains(self, px: np.ndarray, py: np.ndarray) -> np.ndarray:
        out = np.zeros(len(px), dtype=bool)
        if not len(px):
            return out
        b = self.bbox
        cand = np.nonzero((px >= b[0]) & (px <= b[2]) & (py >= b[1]) & (py <= b[3]))[0]
        step = max(1, 4_000_000 // max(1, len(self.x1)))
        for i in range(0, len(cand), step):
            idx = cand[i:i + step]
            X, Y = px[idx, None], py[idx, None]
            straddle = (self.y1 > Y) != (self.y2 > Y)
            with np.errstate(divide="ignore", invalid="ignore"):
                xint = (self.x2 - self.x1) * (Y - self.y1) / (self.y2 - self.y1) + self.x1
            out[idx] = ((straddle & (X < xint)).sum(axis=1) % 2) == 1
        return out

    def samples(self) -> tuple[np.ndarray, np.ndarray]:
        """Points on a regular grid inside the polygon; the grid is refined for thin or tiny shapes."""
        if self._samples is None:
            n = SAMPLES
            for _ in range(4):
                b = self.bbox
                xs = b[0] + (np.arange(n) + 0.5) * (b[2] - b[0]) / n
                ys = b[1] + (np.arange(n) + 0.5) * (b[3] - b[1]) / n
                gx, gy = (a.ravel() for a in np.meshgrid(xs, ys))
                m = self.contains(gx, gy)
                if m.sum() >= 200 or n >= SAMPLES * 4:
                    break
                n *= 2
            self._samples = (gx[m], gy[m])
        return self._samples


def bbox_overlap(a, b) -> bool:
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def nearest_gap(a: Poly, b: Poly) -> float:
    """Smallest vertex-to-vertex distance (degrees) between two polygons; a coarse 'which county is closest'."""
    av = np.column_stack([a.x1, a.y1])[:: max(1, len(a.x1) // 500)]
    bv = np.column_stack([b.x1, b.y1])[:: max(1, len(b.x1) // 500)]
    return float(np.sqrt(((av[:, None, :] - bv[None, :, :]) ** 2).sum(axis=2)).min())


def overlap_fracs(zone: Poly, county: Poly) -> tuple[float, float]:
    """(share of the zone inside the county, share of the county inside the zone), by point sampling."""
    if not bbox_overlap(zone.bbox, county.bbox):
        return 0.0, 0.0
    zx, zy = zone.samples()
    cx, cy = county.samples()
    fz = county.contains(zx, zy).mean() if len(zx) else 0.0
    fc = zone.contains(cx, cy).mean() if len(cx) else 0.0
    return float(fz), float(fc)


# ---------------------------------------------------------------- name fallback

_SUFFIX = re.compile(r"\s+(COUNTY|PARISH|BOROUGH|CENSUS AREA|MUNICIPALITY|CITY AND BOROUGH)$")


def name_match_counties(zone_name: str, county_names: dict[str, str]) -> list[str]:
    """County codes whose name appears as a whole word in a Storm Events zone name,
    e.g. 'W KITTITAS/W YAKIMA/W KLICKITAT T X SW' -> Kittitas, Yakima, Klickitat. Low confidence."""
    text = " " + re.sub(r"[^A-Z ]+", " ", zone_name.upper()) + " "
    hits = []
    for c, n in sorted(county_names.items()):
        base = _SUFFIX.sub("", n.upper()).strip()
        if base and f" {base} " in text:
            hits.append(c)
    return hits


# ---------------------------------------------------------------- the crosswalk

def build_crosswalk(st: str, area_years: dict[str, set[int]], area_names: dict[str, str], cache: dict,
                    min_frac: float = MIN_FRAC) -> tuple[dict[str, list[str]], dict]:
    """area_years: every area code with events -> the years it has events in. Returns (crosswalk, provenance)."""
    polys: dict[str, Poly] = {}

    def poly(h):
        if h not in polys:
            polys[h] = Poly(cache["geoms"][h])
        return polys[h]

    snaps = cache["snaps"]
    years_avail = sorted(int(d[:4]) for d in snaps)
    counties = set()
    for snap in snaps.values():
        counties |= {u for u in snap if u[2] == "C"}
    counties |= {c for c in area_years if c[2] == "C"}
    xw = {c: ({c} if c in area_years else set()) for c in counties}
    prov = {"source": f"IEM UGC database ({IEM_UGCS}), snapshots {snapshot_date(years_avail[0])[:10]}.."
                      f"{snapshot_date(years_avail[-1])[:10]}" if years_avail else "none",
            "min_frac": min_frac, "zones": {}}
    pair_memo: dict[tuple[str, str], tuple[float, float]] = {}
    county_names = {u: n for u, n in cache["names"].items() if u[2] == "C"}

    for z in sorted(c for c in area_years if c[2] == "Z"):
        info = {"method": None, "counties": {}, "years": sorted(area_years[z])}
        flags = set()
        best = None  # (score, county): most overlap, else smallest gap; used when no county passes MIN_FRAC
        for y in sorted(area_years[z]):
            d = snapshot_date(y)
            used = d
            if d not in snaps or z not in snaps[d]:
                # nearest snapshot that has the code (zone created/retired mid-year, or snapshot missing)
                have = [dd for dd in snaps if z in snaps[dd]]
                if not have:
                    continue
                used = min(have, key=lambda dd: abs(int(dd[:4]) - max(y, FIRST_SNAPSHOT_YEAR)))
            snap = snaps[used]
            zp = poly(snap[z])
            for c in (u for u in snap if u[2] == "C"):
                key = (snap[z], snap[c])
                if key not in pair_memo:
                    pair_memo[key] = overlap_fracs(zp, poly(snap[c]))
                fz, fc = pair_memo[key]
                score = fz + fc if fz + fc > 0 else -nearest_gap(zp, poly(snap[c]))
                if best is None or score > best[0]:
                    best = (score, c)
                if fz >= min_frac or fc >= min_frac:
                    prev = info["counties"].get(c, (0.0, 0.0))
                    info["counties"][c] = (max(prev[0], round(fz, 3)), max(prev[1], round(fc, 3)))
            flags.add("pre2007" if y < FIRST_SNAPSHOT_YEAR else ("same-year" if used == d else "nearest-year"))
        if flags:
            # high: every event year matched to that year's IEM polygon. medium: some years used the 2007 polygon
            # (IEM back-filled retired codes) or the nearest year that still had the code.
            info["method"] = "geometry:" + "+".join(sorted(flags))
            info["confidence"] = "high" if flags == {"same-year"} else "medium"
            if not info["counties"] and best is not None:
                # thin coastal/island zones (Florida Keys, Outer Banks, Maui sub-zones) vs simplified county outlines
                info["method"] += "+best-county"
                info["confidence"] = "low"
                info["counties"] = {best[1]: None}
        else:
            hits = name_match_counties(area_names.get(z, ""), county_names)
            info["method"] = "name-match" if hits else "unmapped"
            info["confidence"] = "low" if hits else "none"
            info["counties"] = {c: None for c in hits}
        for c in info["counties"]:
            xw.setdefault(c, set()).add(z)
        prov["zones"][z] = info
    out = {c: sorted(v) for c, v in sorted(xw.items()) if v}
    return out, prov


def load_crosswalk(path: str) -> dict[str, list[str]]:
    """Read and validate a county-areas.json file."""
    with open(path, encoding="utf-8") as fh:
        d = json.load(fh)
    code = re.compile(r"^[A-Z]{2}[CZ]\d{3}$")
    if not isinstance(d, dict):
        raise ValueError("county-areas.json must be an object")
    for k, v in d.items():
        if not re.fullmatch(r"[A-Z]{2}C\d{3}", k) or not isinstance(v, list) or not all(code.fullmatch(x) for x in v):
            raise ValueError(f"bad crosswalk entry {k!r}: {v!r}")
    return d


def write_crosswalk(st: str, xw: dict, prov: dict, events_dir: str) -> str:
    path = os.path.join(events_dir, st, "county-areas.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as fh:
        json.dump(xw, fh, separators=(",", ":"), sort_keys=True)
    os.replace(path + ".tmp", path)
    pdir = os.path.join(OUT, "crosswalk")
    os.makedirs(pdir, exist_ok=True)
    with open(os.path.join(pdir, f"{st}.json"), "w", encoding="utf-8") as fh:
        json.dump(prov, fh, indent=1, sort_keys=True)
    return path


def area_index(events: list[dict]) -> tuple[dict[str, set[int]], dict[str, str]]:
    years: dict[str, set[int]] = defaultdict(set)
    names: dict[str, list[str]] = defaultdict(list)
    for e in events:
        c = e["area"]["code"]
        years[c].add(int(e["start"][:4]))
        if e["area"]["name"] not in names[c]:
            names[c].append(e["area"]["name"])
    return years, {c: " / ".join(v) for c, v in names.items()}


# ---------------------------------------------------------------- zones.json (per-address precision)

def _dp(pts: np.ndarray, tol: float) -> np.ndarray:
    """Douglas-Peucker on an (n, 2) array; keeps the end points."""
    keep = np.zeros(len(pts), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = pts[i], pts[j]
        seg = pts[i + 1:j]
        d = b - a
        n = np.hypot(*d)
        dist = (np.abs(d[0] * (seg[:, 1] - a[1]) - d[1] * (seg[:, 0] - a[0])) / n) if n else np.hypot(*(seg - a).T)
        k = int(np.argmax(dist))
        if dist[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack += [(i, m), (m, j)]
    return pts[keep]


def simplify_geometry(geom: dict, tol: float = 0.01, ndigits: int = 3) -> dict | None:
    """Simplified MultiPolygon (rings that collapse are dropped; a collapsed outer ring drops its holes)."""
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    out = []
    for poly in polys:
        rings = []
        for k, ring in enumerate(poly):
            a = np.asarray(ring, dtype=float)
            if len(a) < 4:
                continue
            if not np.array_equal(a[0], a[-1]):
                a = np.vstack([a, a[:1]])
            # split the closed ring at its farthest vertex so both halves have distinct end points
            far = int(np.argmax(np.hypot(*(a - a[0]).T)))
            s = np.vstack([_dp(a[:far + 1], tol)[:-1], _dp(a[far:], tol)])
            s = np.round(s, ndigits)
            s = s[np.r_[True, np.any(np.diff(s, axis=0) != 0, axis=1)]]
            if len(s) < 4:
                if k == 0:
                    break
                continue
            rings.append(s.tolist())
        if rings:
            out.append(rings)
    return {"type": "MultiPolygon", "coordinates": out} if out else None


def _bbox(p: Poly, nd: int = 3) -> list[float]:
    return [round(float(v), nd) for v in p.bbox]


def build_zones(area_years: dict[str, set[int]], area_dates: dict[str, tuple[str, str]], area_names: dict[str, str],
                cache: dict, prov: dict, tol: float = 0.01) -> dict:
    """{zone: {name, validFrom, validTo, bbox, polygon}} for every zone code with events.
    validFrom/validTo are the first/last Storm Events dates filed under the code (IEM's API does not expose NWS effective
    dates). The polygon is the IEM version in force for most of the code's event years; a code whose boundary changed
    while in use also lists every version under "versions" (each with the event years it covers).
    No IEM geometry: {"approx": true, "bbox": ...} from the name-matched counties, or the whole state if none matched."""
    snaps = cache["snaps"]
    state_bbox = None
    for snap in snaps.values():
        for u, h in snap.items():
            if u[2] == "C":
                b = Poly(cache["geoms"][h]).bbox
                state_bbox = list(b) if state_bbox is None else [min(state_bbox[0], b[0]), min(state_bbox[1], b[1]),
                                                                  max(state_bbox[2], b[2]), max(state_bbox[3], b[3])]
        break
    out = {}
    for z in sorted(c for c in area_years if c[2] == "Z"):
        name = cache["names"].get(z, "")
        se_name = area_names.get(z, "").split(" / ")[0]
        if not name or name.startswith("Unknown"):
            name = se_name.title()
        f, t = area_dates[z]
        entry = {"name": name, "validFrom": f, "validTo": t}
        by_hash: dict[str, list[int]] = defaultdict(list)
        for y in sorted(area_years[z]):
            d = snapshot_date(y)
            if d not in snaps or z not in snaps[d]:
                have = [dd for dd in snaps if z in snaps[dd]]
                if not have:
                    continue
                d = min(have, key=lambda dd: abs(int(dd[:4]) - max(y, FIRST_SNAPSHOT_YEAR)))
            by_hash[snaps[d][z]].append(y)
        versions = []
        for h, ys in by_hash.items():
            g = simplify_geometry(cache["geoms"][h], tol)
            if g:
                versions.append((len(ys), ys, g, _bbox(Poly(g))))
        if versions:
            versions.sort(key=lambda v: (-v[0], -v[1][-1]))
            versions = _merge_same(versions)
            entry.update(bbox=versions[0][3], polygon=versions[0][2])
            distinct = {json.dumps(v[2]) for v in versions}
            if len(distinct) > 1:
                entry["versions"] = [{"years": v[1], "bbox": v[3], "polygon": v[2]} for v in
                                     sorted(versions, key=lambda v: v[1][0])]
        else:
            hits = [c for c in prov["zones"].get(z, {}).get("counties", {})]
            boxes = []
            for c in hits:
                hh = next((s[c] for s in snaps.values() if c in s), None)
                if hh:
                    boxes.append(Poly(cache["geoms"][hh]).bbox)
            if boxes:
                b = [min(x[0] for x in boxes), min(x[1] for x in boxes), max(x[2] for x in boxes), max(x[3] for x in boxes)]
                basis = "counties named in the zone name"
            else:
                b, basis = state_bbox, "whole state"
            entry.update(approx=True, approxBasis=basis, bbox=[round(float(v), 3) for v in b] if b else None)
        out[z] = entry
    return out


def _merge_same(versions: list) -> list:
    """Fold versions that differ only by re-digitizing (bbox within 0.02 deg, area within 3%) into the most-used one."""
    kept = []
    for n, ys, g, b in versions:
        a = Poly(g).area
        for k in kept:
            if max(abs(x - y) for x, y in zip(b, k[3])) <= 0.02 and abs(a - k[4]) <= 0.03 * max(a, k[4]):
                k[0] += n
                k[1] = sorted(k[1] + ys)
                break
        else:
            kept.append([n, list(ys), g, b, a])
    return [tuple(k[:4]) for k in kept]


def area_dates(events: list[dict]) -> dict[str, tuple[str, str]]:
    span: dict[str, list[str]] = {}
    for e in events:
        d = e["start"][:10]
        s = span.setdefault(e["area"]["code"], [d, d])
        s[0], s[1] = min(s[0], d), max(s[1], d)
    return {c: (a, b) for c, (a, b) in span.items()}


def write_zones(st: str, zones: dict, events_dir: str) -> str:
    path = os.path.join(events_dir, st, "zones.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as fh:
        json.dump(zones, fh, separators=(",", ":"), sort_keys=True)
    os.replace(path + ".tmp", path)
    return path


def zones_containing(zones: dict, lat: float, lon: float, year: int | None = None) -> list[str]:
    """Zone codes whose polygon (the version in force in `year`, if given) contains the point. Reference for the app."""
    hits = []
    for z, e in zones.items():
        geom = e.get("polygon")
        if not geom:
            continue
        if year is not None and e.get("versions"):
            v = min(e["versions"], key=lambda v: min(abs(y - year) for y in v["years"]))
            geom = v["polygon"]
        if Poly(geom).contains(np.array([lon]), np.array([lat]))[0]:
            hits.append(z)
    return sorted(hits)
