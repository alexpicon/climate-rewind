"""Geocoder clients used by the detective and the no-AI baseline: US Census (onelineaddress + coordinates)
and Nominatim, plus Census TIGERweb road geometry (damage mapper only: a lone street's line near a tornado track). Every response is cached on disk. Nominatim: identifying User-Agent, >= 1.1 s between calls,
stop on HTTP 403/429 (OSM usage policy)."""
from __future__ import annotations

import json
import os
import re
import threading
import time

import requests

from common import CACHE_DIR

UA = "climate-rewind/0.1 (forgehacks)"
CENSUS_ONELINE = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress"
CENSUS_COORDS = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
# TIGERweb Transportation layers: 2 = Primary Roads (S1100), 6 = Secondary Roads (S1200), 8 = Local Roads (S1400).
TIGER_ROADS = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/{layer}/query"
TIGER_LAYERS = (2, 6, 8)


class NominatimBlocked(RuntimeError):
    pass


class _JsonCache:
    def __init__(self, name: str):
        self.path = os.path.join(CACHE_DIR, name)
        self.lock = threading.Lock()
        self.data = json.load(open(self.path)) if os.path.exists(self.path) else {}

    def get(self, k):
        with self.lock:
            return self.data.get(k)

    def put(self, k, v):
        with self.lock:
            self.data[k] = v
            os.makedirs(CACHE_DIR, exist_ok=True)
            tmp = self.path + ".tmp"
            json.dump(self.data, open(tmp, "w"))
            os.replace(tmp, self.path)


class Geo:
    def __init__(self, nominatim_gap: float = 1.1, timeout: float = 20.0):
        assert nominatim_gap >= 1.1, "Nominatim policy: at most ~1 request per second"
        self.gap, self.timeout = nominatim_gap, timeout
        self.ccache, self.ncache, self.kcache = _JsonCache("census.json"), _JsonCache("nominatim.json"), _JsonCache("census_county.json")
        self.tcache = _JsonCache("tiger_roads.json")
        self._last = 0.0
        self._nlock = threading.Lock()
        self.calls = dict(census=0, nominatim=0, census_county=0, tiger=0, cached=0)

    def census(self, address: str) -> list[dict] | None:
        """[{matched, lat, lon, county, state}] or None on API error (errors are not cached)."""
        hit = self.ccache.get(address)
        if hit is not None:
            self.calls["cached"] += 1
            return hit
        for k in range(3):
            try:
                self.calls["census"] += 1
                r = requests.get(CENSUS_ONELINE, timeout=self.timeout, params=dict(
                    address=address, benchmark="Public_AR_Current", vintage="Current_Current", layers="Counties", format="json"))
                m = r.json()["result"]["addressMatches"]
                res = [dict(matched=x["matchedAddress"], lat=x["coordinates"]["y"], lon=x["coordinates"]["x"],
                            county=((x.get("geographies") or {}).get("Counties") or [{}])[0].get("NAME", ""),
                            state=(x.get("addressComponents") or {}).get("state", "")) for x in m]
                self.ccache.put(address, res)
                return res
            except Exception:
                time.sleep(2 * (k + 1))
        return None

    def county_at(self, lat: float, lon: float) -> str | None:
        key = f"{lat:.6f},{lon:.6f}"
        hit = self.kcache.get(key)
        if hit is not None:
            return hit
        for k in range(3):
            try:
                self.calls["census_county"] += 1
                r = requests.get(CENSUS_COORDS, timeout=self.timeout, params=dict(
                    x=lon, y=lat, benchmark="Public_AR_Current", vintage="Current_Current", layers="Counties", format="json"))
                c = r.json()["result"]["geographies"].get("Counties") or []
                name = c[0]["NAME"] if c else ""
                self.kcache.put(key, name)
                return name
            except Exception:
                time.sleep(2 * (k + 1))
        return None

    def nominatim(self, q: str, limit: int = 5) -> list[dict] | None:
        key = f"{limit}|{q}"
        hit = self.ncache.get(key)
        if hit is not None:
            self.calls["cached"] += 1
            return hit
        with self._nlock:
            for k in range(3):
                wait = self.gap - (time.time() - self._last)
                if wait > 0:
                    time.sleep(wait)
                self._last = time.time()
                self.calls["nominatim"] += 1
                try:
                    r = requests.get(NOMINATIM, headers={"User-Agent": UA}, timeout=self.timeout, params=dict(
                        q=q, format="jsonv2", countrycodes="us", limit=limit, addressdetails=1))
                except Exception:
                    time.sleep(5 * (k + 1))
                    continue
                if r.status_code in (403, 429):
                    raise NominatimBlocked(f"Nominatim HTTP {r.status_code}; stopping per usage policy")
                if r.status_code == 200:
                    res = r.json()
                    self.ncache.put(key, res)
                    return res
                time.sleep(5 * (k + 1))
        return None


    def tiger_roads(self, word: str, bbox: tuple[float, float, float, float]) -> list[dict] | None:
        """Census TIGERweb road segments whose NAME contains `word` (letters/digits only) and that cross bbox
        (west, south, east, north). [{name, mtfcc, rttyp, paths: [[[lon, lat], ...], ...]}], or None on API error."""
        word = re.sub(r"[^A-Z0-9]", "", (word or "").upper())
        if not word:
            return []
        box = ",".join(f"{v:.4f}" for v in bbox)
        key = f"{word}|{box}"
        hit = self.tcache.get(key)
        if hit is not None:
            self.calls["cached"] += 1
            return hit
        out = []
        for layer in TIGER_LAYERS:
            for k in range(3):
                try:
                    self.calls["tiger"] += 1
                    r = requests.get(TIGER_ROADS.format(layer=layer), timeout=60, params=dict(
                        where=f"UPPER(NAME) LIKE '%{word}%'", geometry=box, geometryType="esriGeometryEnvelope", inSR=4326,
                        outSR=4326, spatialRel="esriSpatialRelIntersects", outFields="NAME,MTFCC,RTTYP", returnGeometry="true", f="json"))
                    d = r.json()
                    if "error" in d:
                        raise RuntimeError(str(d["error"])[:200])
                    out += [dict(name=f["attributes"].get("NAME") or "", mtfcc=f["attributes"].get("MTFCC") or "",
                                 rttyp=f["attributes"].get("RTTYP") or "", paths=(f.get("geometry") or {}).get("paths") or [])
                            for f in d.get("features", [])]
                    break
                except Exception:
                    if k == 2:
                        return None
                    time.sleep(2 * (k + 1))
        self.tcache.put(key, out)
        return out
