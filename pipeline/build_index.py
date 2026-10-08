"""Build per-state flood + tornado index files in the CONTRACT shape (memoria/CONTRACT.md).

usage: build_index.py --states TN,TX,NC,MO,AZ,GA [--years 2015-2025] [--offline] [--verify N]

Sources
- NCEI Storm Events bulk details CSVs (Flood, Flash Flood, Tornado). Local copies are reused from
  raw/stormevents/, then /tmp/memoria/raw (copied into raw/stormevents/), else downloaded from NCEI.
- IEM Local Storm Reports (lsr.geojson), fetched per WFO per year, raw responses cached gzipped in raw/lsr/.
  One call silently caps at 10,000 features, so every response count is asserted < 10,000 (a year that hits the
  cap is re-fetched month by month, and each month is asserted too).
Cached detective results (out/detective/<ST>.jsonl) are merged into the rows on every build.
"""
from __future__ import annotations

import argparse
import glob
import gzip
import json
import os
import random
import re
import shutil
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pandas as pd
import requests

from common import (DEFAULT_TZ, DETECTIVE_DIR, INDEX_DIR, RAW, STATE_NAMES, hav_km, iso, lsr_precision, lsr_time,
                    parse_cz_offset, iana_for, se_precision, se_time, write_index)

SE_DIR = os.path.join(RAW, "stormevents")
LSR_DIR = os.path.join(RAW, "lsr")
NCEI = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
IEM = "https://mesonet.agron.iastate.edu/geojson/lsr.geojson"
IEM_CAP = 10000
LSR_FLOOD_TYPES = {"FLOOD", "FLASH FLOOD"}  # coastal/lakeshore/tidal flooding is out of scope (no SE coordinates)
# Other typetexts (TROPICAL CYCLONE, HEAVY RAIN, TSTM WND DMG, ...) are kept only when the remark describes flooding.
# Helene's Asheville-area reports were filed as TROPICAL CYCLONE. Coastal/ocean types stay out, whatever the remark says.
LSR_NEVER_TYPES = {"COASTAL FLOOD", "LAKESHORE FLOOD", "TIDAL FLOOD", "HIGH ASTR TIDES", "STORM SURGE", "RIP CURRENTS",
                   "HIGH SURF", "SNEAKER WAVE"}
FLOOD_WORDS = re.compile(r"flood|water rescue|high water|submerged|inundat|washed out|swept away", re.I)
# a keyword hit inside one of these phrases is not a flooding description (agency names, gauge/forecast terms, tidal datum)
NOT_FLOODING = re.compile(r"flood\s*(?:control|commission|district|stage|watch|warning|advisory)|high(?:er)?\s+high\s+water", re.I)
NEGATION = re.compile(r"\b(?:no|not|without|never)\b[^.;!?]{0,15}$", re.I)  # "no flooding", "No reports of flooding"
DUP_KM, DUP_HOURS = 2.0, 3.0
SE_COLS = ["EVENT_ID", "EPISODE_ID", "STATE", "EVENT_TYPE", "CZ_TYPE", "CZ_NAME", "WFO", "BEGIN_DATE_TIME", "END_DATE_TIME",
           "CZ_TIMEZONE", "BEGIN_LOCATION", "BEGIN_LAT", "BEGIN_LON", "END_LAT", "END_LON", "TOR_F_SCALE", "TOR_LENGTH",
           "TOR_WIDTH", "DEATHS_DIRECT", "INJURIES_DIRECT", "EVENT_NARRATIVE", "EPISODE_NARRATIVE",
           "BEGIN_RANGE", "BEGIN_YEARMONTH", "BEGIN_DAY"]


# ---------------------------------------------------------------- Storm Events
def se_files(years: list[int]) -> list[str]:
    os.makedirs(SE_DIR, exist_ok=True)
    out, listing = [], None
    for y in years:
        pat = f"StormEvents_details-ftp_v1.0_d{y}_c*.csv.gz"
        hit = sorted(glob.glob(os.path.join(SE_DIR, pat)))
        if not hit:
            tmp = sorted(glob.glob(os.path.join("/tmp/memoria/raw", pat)))
            if tmp:
                shutil.copy2(tmp[-1], SE_DIR)
                hit = [os.path.join(SE_DIR, os.path.basename(tmp[-1]))]
        if not hit:
            if listing is None:
                listing = requests.get(NCEI, timeout=60).text
            names = sorted(set(re.findall(rf"StormEvents_details-ftp_v1\.0_d{y}_c\d+\.csv\.gz", listing)))
            if not names:
                raise SystemExit(f"Storm Events file for {y} not found on NCEI")
            dst = os.path.join(SE_DIR, names[-1])
            print(f"downloading {names[-1]}", file=sys.stderr)
            with requests.get(NCEI + names[-1], timeout=300, stream=True) as r:
                r.raise_for_status()
                with open(dst + ".part", "wb") as fh:
                    shutil.copyfileobj(r.raw, fh)
            os.replace(dst + ".part", dst)
            hit = [dst]
        out.append(hit[-1])
    return out


def load_storm_events(years: list[int]) -> pd.DataFrame:
    frames = [pd.read_csv(f, dtype=str, keep_default_na=False, usecols=SE_COLS) for f in se_files(years)]
    return pd.concat(frames, ignore_index=True)


def shared_counts(se: pd.DataFrame) -> Counter:
    """How many rows (nationwide, all event types, in the build years) sit on the exact same filed BEGIN point."""
    has = se[(se.BEGIN_LAT.str.strip() != "") & (se.BEGIN_LON.str.strip() != "")]
    return Counter((has.BEGIN_LAT.str.strip() + "," + has.BEGIN_LON.str.strip()).tolist())


def fnum(s: str):
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def inum(s: str) -> int:
    v = fnum(s)
    return int(v) if v is not None else 0


def se_floods(se_st: pd.DataFrame, st: str, share: Counter) -> list[dict]:
    rows = []
    for r in se_st[se_st.EVENT_TYPE.isin(["Flood", "Flash Flood"])].itertuples(index=False):
        lat_s, lon_s = r.BEGIN_LAT.strip(), r.BEGIN_LON.strip()
        start = se_time(r.BEGIN_DATE_TIME, r.CZ_TIMEZONE, st)
        end = se_time(r.END_DATE_TIME, r.CZ_TIMEZONE, st)
        filed = [float(lat_s), float(lon_s)] if lat_s and lon_s else None
        rows.append(dict(
            id=f"SE-{r.EVENT_ID}", source="StormEvents", type=r.EVENT_TYPE, start=iso(start),
            county=r.CZ_NAME.title(), wfo=r.WFO, city=r.BEGIN_LOCATION or None,
            quote=r.EVENT_NARRATIVE, filed=filed,
            coordPrecision=se_precision(lat_s, lon_s, share.get(f"{lat_s},{lon_s}", 0)),
            placed=None, detective=None, dupOf=None,
            _end=end, _endpt=(fnum(r.END_LAT), fnum(r.END_LON)), _start=start))
    return rows


def se_tornadoes(se_st: pd.DataFrame, st: str) -> list[dict]:
    rows = []
    for r in se_st[se_st.EVENT_TYPE == "Tornado"].itertuples(index=False):
        b = [fnum(r.BEGIN_LAT), fnum(r.BEGIN_LON)]
        e = [fnum(r.END_LAT), fnum(r.END_LON)]
        rows.append(dict(
            id=f"SE-{r.EVENT_ID}", start=iso(se_time(r.BEGIN_DATE_TIME, r.CZ_TIMEZONE, st)),
            ef=r.TOR_F_SCALE or None, begin=b if None not in b else None, end=e if None not in e else None,
            widthYd=inum(r.TOR_WIDTH), lengthMi=fnum(r.TOR_LENGTH),
            deaths=inum(r.DEATHS_DIRECT), injuries=inum(r.INJURIES_DIRECT),
            narrative=r.EVENT_NARRATIVE, episodeNarrative=r.EPISODE_NARRATIVE))
    rows.sort(key=lambda x: x["start"])
    return rows


# ---------------------------------------------------------------- IEM LSR
def _get(params: dict) -> dict:
    last = None
    for k in range(6):
        try:
            r = requests.get(IEM, params=params, timeout=180, headers={"User-Agent": "climate-rewind/0.1 (forgehacks)"})
            if r.status_code == 200:
                return r.json()
            last = f"HTTP {r.status_code}"
        except Exception as e:  # network hiccup: back off and retry
            last = repr(e)
        time.sleep(5 * (k + 1))
    raise RuntimeError(f"IEM failed for {params}: {last}")


def _assert_cap(n: int, what: str) -> None:
    assert n < IEM_CAP, f"IEM response for {what} returned {n} features (cap {IEM_CAP}); data may be truncated"


def fetch_lsr(wfo: str, year: int, offline: bool = False) -> list[dict]:
    """All LSRs for one WFO-year. Cached gzipped in raw/lsr/<WFO>_<YYYY>.json.gz with the call log."""
    os.makedirs(LSR_DIR, exist_ok=True)
    path = os.path.join(LSR_DIR, f"{wfo}_{year}.json.gz")
    if os.path.exists(path):
        with gzip.open(path, "rt") as fh:
            blob = json.load(fh)
        for c in blob["calls"]:
            _assert_cap(c["n"], f"{wfo} {c['sts']}..{c['ets']} (cached)")
        return blob["features"]
    if offline:
        raise SystemExit(f"--offline but {path} is not cached")
    sts, ets = f"{year}-01-01T00:00Z", f"{year + 1}-01-01T00:00Z"
    data = _get(dict(sts=sts, ets=ets, wfos=wfo))
    calls = [dict(sts=sts, ets=ets, n=len(data["features"]))]
    feats = data["features"]
    if len(feats) >= IEM_CAP:  # split by month and assert each piece
        feats, calls = [], []
        for m in range(1, 13):
            s = f"{year}-{m:02d}-01T00:00Z"
            e = f"{year + (m == 12)}-{(m % 12) + 1:02d}-01T00:00Z"
            d = _get(dict(sts=s, ets=e, wfos=wfo))
            calls.append(dict(sts=s, ets=e, n=len(d["features"])))
            feats += d["features"]
    for c in calls:
        _assert_cap(c["n"], f"{wfo} {c['sts']}..{c['ets']}")
    blob = dict(wfo=wfo, year=year, fetched=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                source=IEM, calls=calls, features=feats)
    with gzip.open(path + ".tmp", "wt") as fh:
        json.dump(blob, fh)
    os.replace(path + ".tmp", path)
    return feats


def county_zones(se_all: pd.DataFrame) -> tuple[dict, dict]:
    """(ST, COUNTY) -> IANA and (ST, WFO) -> IANA, majority vote over Storm Events county rows."""
    inv = {v: k for k, v in STATE_NAMES.items()}
    d = se_all[se_all.STATE.isin(inv) & (se_all.CZ_TYPE == "C")]
    by_c, by_w = defaultdict(Counter), defaultdict(Counter)
    for st_name, cz, wfo, tz in zip(d.STATE, d.CZ_NAME, d.WFO, d.CZ_TIMEZONE):
        st = inv[st_name]
        try:
            z = iana_for(st, parse_cz_offset(tz)[0])
        except ValueError:
            continue
        by_c[(st, norm_county(cz))][z] += 1
        by_w[(st, wfo)][z] += 1
    return ({k: c.most_common(1)[0][0] for k, c in by_c.items()}, {k: c.most_common(1)[0][0] for k, c in by_w.items()})


def norm_county(s: str) -> str:
    s = (s or "").upper().replace("SAINT ", "ST. ").replace("ST ", "ST. ")
    s = re.sub(r"\s+(COUNTY|PARISH)$", "", s.strip())
    return re.sub(r"[^A-Z]", "", s)


def remark_describes_flooding(remark: str) -> bool:
    """Conservative: some flood keyword that is not negated ("no flooding") and not part of an agency/gauge phrase."""
    remark = remark or ""
    spans = [m.span() for m in NOT_FLOODING.finditer(remark)]
    for m in FLOOD_WORDS.finditer(remark):
        if any(a <= m.start() < b for a, b in spans):
            continue
        if NEGATION.search(remark[:m.start()]):
            continue
        return True
    return False


def is_flood_lsr(p: dict) -> bool:
    tt = (p.get("typetext") or "").upper()
    if tt in LSR_FLOOD_TYPES:
        return True
    return tt not in LSR_NEVER_TYPES and remark_describes_flooding(p.get("remark"))


def lsr_floods(feats_by_wfo: dict, st: str, czone: dict, wzone: dict) -> list[dict]:
    seen, recs = set(), []
    for wfo, feats in feats_by_wfo.items():
        for f in feats:
            p = f["properties"]
            rst = (p.get("st") or p.get("state") or "").upper()
            if rst != st or not is_flood_lsr(p):
                continue
            if p.get("lat") is None or p.get("lon") is None:
                continue
            key = (p["wfo"], p["valid"], p["lat"], p["lon"], p["typetext"], p.get("remark"), p.get("city"))
            if key in seen:  # year-boundary overlap
                continue
            seen.add(key)
            recs.append(p)
    # stable ids: LSR-<wfo>-<valid yyyymmddhhmi UTC>-<n>
    groups = defaultdict(list)
    for p in recs:
        groups[(p["wfo"], p["valid"])].append(p)
    rows = []
    for (wfo, valid), ps in groups.items():
        ps.sort(key=lambda p: (p["lat"], p["lon"], p["typetext"], p.get("city") or "", p.get("remark") or ""))
        for n, p in enumerate(ps):
            cty = (p.get("county") or "").strip()
            zone = czone.get((st, norm_county(cty))) or wzone.get((st, wfo)) or DEFAULT_TZ[st]
            t = lsr_time(valid, zone)
            stamp = valid.replace("-", "").replace(":", "").replace("T", "")[:12]
            rows.append(dict(
                id=f"LSR-{wfo}-{stamp}-{n}", source="LSR", type=p["typetext"], start=iso(t),
                county=cty.title() or None, wfo=wfo, city=p.get("city") or None,
                quote=p.get("remark") or "", filed=[float(p["lat"]), float(p["lon"])],
                coordPrecision=lsr_precision(p.get("city")),
                placed=None, detective=None, dupOf=None, _start=t))
    return rows


# ---------------------------------------------------------------- duplicates
def mark_dups(lsr_rows: list[dict], se_rows: list[dict]) -> int:
    """LSR.dupOf = nearest Storm Events flood within DUP_KM whose [begin, end] is within DUP_HOURS of the LSR time."""
    cell = lambda lat, lon: (int(lat // 0.05), int(lon // 0.05))
    grid = defaultdict(list)
    for s in se_rows:
        pts = [tuple(s["filed"])] if s["filed"] else []
        if s["_endpt"][0] is not None and s["_endpt"][1] is not None:
            pts.append(s["_endpt"])
        for lat, lon in pts:
            grid[cell(lat, lon)].append((s, lat, lon))
    n = 0
    for r in lsr_rows:
        lat, lon = r["filed"]
        cy, cx = cell(lat, lon)
        best = None
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for s, slat, slon in grid.get((cy + dy, cx + dx), ()):
                    t = r["_start"]
                    gap = max(0.0, (s["_start"] - t).total_seconds(), (t - s["_end"]).total_seconds()) / 3600
                    if gap > DUP_HOURS:
                        continue
                    d = hav_km(lat, lon, slat, slon)
                    if d <= DUP_KM and (best is None or d < best[0]):
                        best = (d, s["id"])
        if best:
            r["dupOf"] = best[1]
            n += 1
    return n


# ---------------------------------------------------------------- detective merge
def load_detective(st: str) -> dict:
    path = os.path.join(DETECTIVE_DIR, f"{st}.jsonl")
    out = {}
    if os.path.exists(path):
        for line in open(path):
            if line.strip():
                x = json.loads(line)
                out[x["id"]] = x  # last line wins (latest run)
    return out


def apply_detective(rows: list[dict], det: dict) -> int:
    n = 0
    for r in rows:
        x = det.get(r["id"])
        if x:
            r["detective"] = x["detective"]
            r["placed"] = x.get("placed")
            n += 1
    return n


# ---------------------------------------------------------------- main
def build_state(st, se_all, share, czone, wzone, years, offline, workers=4):
    se_st = se_all[se_all.STATE == STATE_NAMES[st]]
    se_rows = se_floods(se_st, st, share)
    tors = se_tornadoes(se_st, st)
    wfos = sorted(set(se_st.WFO) - {""})
    jobs = [(w, y) for w in wfos for y in years]
    with ThreadPoolExecutor(workers) as ex:
        res = list(ex.map(lambda j: (j[0], fetch_lsr(j[0], j[1], offline)), jobs))
    by_wfo = defaultdict(list)
    for w, feats in res:
        by_wfo[w] += feats
    lsr_rows = lsr_floods(by_wfo, st, czone, wzone)
    ndup = mark_dups(lsr_rows, se_rows)
    floods = se_rows + lsr_rows
    floods.sort(key=lambda r: (r["_start"], r["id"]))
    ndet = apply_detective(floods, load_detective(st))
    clean = [{k: v for k, v in r.items() if not k.startswith("_")} for r in floods]
    data = dict(state=st, built=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                sources=[f"NCEI Storm Events {years[0]}-{years[-1]}", f"IEM LSR {years[0]}-{years[-1]}"],
                floods=clean, tornadoes=tors)
    path = write_index(st, data)
    prec = Counter(r["coordPrecision"] for r in clean)
    by_remark = Counter(r["type"].upper() for r in lsr_rows if r["type"].upper() not in LSR_FLOOD_TYPES)
    stats = dict(state=st, wfos=len(wfos), se_floods=len(se_rows), lsr_floods=len(lsr_rows), lsr_dups=ndup,
                 lsr_by_remark=sum(by_remark.values()), lsr_tropical_cyclone=by_remark.get("TROPICAL CYCLONE", 0),
                 lsr_by_remark_types=dict(by_remark.most_common()),
                 tornadoes=len(tors), detective_rows=ndet, precision=dict(prec), bytes=os.path.getsize(path))
    return stats, data


def spot_check(datas: dict, se_all: pd.DataFrame, n: int, seed: int = 11) -> list[str]:
    """Re-read n random rows from the raw sources and compare verbatim text, coordinates and times."""
    rng = random.Random(seed)
    pool = [(st, r) for st, d in datas.items() for r in d["floods"]] + \
           [(st, dict(r, source="Tornado")) for st, d in datas.items() for r in d["tornadoes"][:]]
    picks = rng.sample(pool, min(n, len(pool)))
    # always include at least one LSR and one tornado
    if not any(r["source"] == "LSR" for _, r in picks):
        picks[0] = rng.choice([(st, r) for st, r in pool if r["source"] == "LSR"])
    if not any(r["source"] == "Tornado" for _, r in picks):
        picks[1] = rng.choice([(st, r) for st, r in pool if r["source"] == "Tornado"])
    lines = []
    for st, r in picks:
        if r["source"] in ("StormEvents", "Tornado"):
            src = se_all[se_all.EVENT_ID == r["id"][3:]].iloc[0]
            t = iso(se_time(src.BEGIN_DATE_TIME, src.CZ_TIMEZONE, st))
            text_ok = (r.get("quote", r.get("narrative")) == src.EVENT_NARRATIVE)
            pt = r.get("filed") or r.get("begin")
            pt_ok = pt is None or (pt[0] == float(src.BEGIN_LAT) and pt[1] == float(src.BEGIN_LON))
            ok = text_ok and pt_ok and t == r["start"]
            lines.append(f"{'OK ' if ok else 'BAD'} {st} {r['id']} src='{src.BEGIN_DATE_TIME} {src.CZ_TIMEZONE}' -> {r['start']} "
                         f"pt={pt} text_verbatim={text_ok} | {(src.EVENT_NARRATIVE or '')[:90]!r}")
        else:
            wfo, stamp = r["id"].split("-")[1:3]
            year = int(stamp[:4])
            feats = fetch_lsr(wfo, year, offline=True)
            valid = f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]}T{stamp[8:10]}:{stamp[10:12]}:00Z"
            cand = [f["properties"] for f in feats if f["properties"]["valid"] == valid
                    and (f["properties"].get("remark") or "") == r["quote"]]
            ok = bool(cand) and [cand[0]["lat"], cand[0]["lon"]] == r["filed"]
            lines.append(f"{'OK ' if ok else 'BAD'} {st} {r['id']} src valid={valid} UTC -> {r['start']} pt={r['filed']} "
                         f"city={r['city']!r} prec={r['coordPrecision']} remark_verbatim={bool(cand)} | {r['quote'][:90]!r}")
    return lines


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--states", default="TN,TX,NC,MO,AZ,GA")
    ap.add_argument("--years", default="2015-2025")
    ap.add_argument("--offline", action="store_true", help="fail instead of fetching uncached LSR files")
    ap.add_argument("--verify", type=int, default=5, help="spot-check N random rows against source")
    a = ap.parse_args(argv)
    y0, y1 = (int(x) for x in a.years.split("-"))
    years = list(range(y0, y1 + 1))
    states = [s.strip().upper() for s in a.states.split(",") if s.strip()]
    for s in states:
        if s not in STATE_NAMES:
            raise SystemExit(f"unsupported state {s}; supported: {','.join(STATE_NAMES)}")
    t0 = time.time()
    se_all = load_storm_events(years)
    share = shared_counts(se_all)
    czone, wzone = county_zones(se_all)
    allstats, datas = [], {}
    for st in states:
        stats, data = build_state(st, se_all, share, czone, wzone, years, a.offline)
        allstats.append(stats)
        datas[st] = data
        print(json.dumps(stats), flush=True)
    os.makedirs(INDEX_DIR, exist_ok=True)
    json.dump(allstats, open(os.path.join(INDEX_DIR, "_stats.json"), "w"), indent=1)
    if a.verify:
        print("\nSpot-check against source:")
        for line in spot_check(datas, se_all, a.verify):
            print(" ", line)
    print(f"\ndone in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
