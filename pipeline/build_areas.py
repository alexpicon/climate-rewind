"""Area events (all EVENT_TYPEs, county/zone rows) for every state + DC, and the Storm-Events-only point index.

usage:
  build_areas.py events [--states ALL|WA,OR] [--years 2000-2025] [--prune]
  build_areas.py index  [--states REST|ID,OR] [--years 2015-2025]
  build_areas.py shard  [--states ALL|WA,OR]   (split legacy <ST>.json.gz files into shards, then delete them)
  build_areas.py slim   [--states ALL|WA,OR]   (re-write existing shards under the episode-text rule below)
  build_areas.py crosswalk [--states ALL|WA,OR] [--offline] [--workers 4]
  build_areas.py verify   (3 random rows in 3 random states, re-read from the raw CSVs)

events -> <EVENTS_DIR>/<ST>/<CODE>.json.gz, one shard per area code (WAC033, WAZ508...), each {"events": [...], "episodes": {...}}
  in the CONTRACT "area events" row shape (episode narratives stored once per shard in "episodes"; an event whose own
  EPISODE_NARRATIVE differs from the stored one carries it inline as "episodeNarrative").
  Size rule (2026-10-08, Vercel bundle): episode text is kept ONLY for events whose own narrative is empty. An event with
  a narrative of its own carries no episode text (no "episodeNarrative", and its episode is not in "episodes" for its sake).
  --prune drops events with no event narrative AND no damage, deaths or injuries (size control).
index  -> <INDEX_DIR>/<ST>.json.gz in the CONTRACT index shape, Storm Events only (no LSR, placed/detective null).
  Refuses the LSR states (common.LSR_STATES): their index carries LSRs + detective results and is built by build_index.py.
crosswalk -> <EVENTS_DIR>/<ST>/county-areas.json {county code: [every county/zone code overlapping it]} and
  <EVENTS_DIR>/<ST>/zones.json {zone: {name, validFrom, validTo, bbox, polygon[, versions][, approx]}}; see area_crosswalk.py.
Set MEMORIA_DATA_DIR=../data to write into the web app's data folder.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone

import pandas as pd

from build_index import se_files, se_floods, se_tornadoes, shared_counts, SE_COLS
from common import EVENTS_DIR, LSR_STATES, STATE_NAMES, iso, se_time, write_index

EV_COLS = ["EVENT_ID", "EPISODE_ID", "STATE", "EVENT_TYPE", "CZ_TYPE", "CZ_FIPS", "CZ_NAME", "BEGIN_DATE_TIME",
           "END_DATE_TIME", "CZ_TIMEZONE", "DEATHS_DIRECT", "DEATHS_INDIRECT", "INJURIES_DIRECT", "INJURIES_INDIRECT",
           "DAMAGE_PROPERTY", "DAMAGE_CROPS", "MAGNITUDE", "MAGNITUDE_TYPE", "EVENT_NARRATIVE", "EPISODE_NARRATIVE"]
_DMG = re.compile(r"^\s*(\d*\.?\d*)\s*([HKMB]?)\s*$", re.I)
_MULT = {"": 1, "H": 100, "K": 1_000, "M": 1_000_000, "B": 1_000_000_000}


def parse_damage(s: str) -> int:
    """Storm Events damage string -> whole dollars. '1.5M' -> 1500000, '10.00K' -> 10000, '' / 'K' / '0' -> 0."""
    m = _DMG.match(s or "")
    if not m:
        raise ValueError(f"unparseable damage {s!r}")
    num, suf = m.groups()
    if not num or num == ".":
        return 0
    return int(round(float(num) * _MULT[suf.upper()]))


def area_code(st: str, cz_type: str, cz_fips: str) -> str:
    """CONTRACT: zone = ST + 'Z' + 3-digit CZ_FIPS (api.weather.gov forecastZone id); county = ST + 'C' + 3 digits."""
    kind = cz_type.strip().upper()
    if kind not in ("C", "Z"):
        raise ValueError(f"not a county/zone row: {cz_type!r}")
    return f"{st}{kind}{int(cz_fips):03d}"


def _int(s: str) -> int:
    s = (s or "").strip()
    return int(float(s)) if s else 0


def _mag(s: str):
    s = (s or "").strip()
    if not s:
        return None
    v = float(s)
    return int(v) if v.is_integer() else v


def has_impact(ev: dict) -> bool:
    return bool(ev["narrative"].strip()) or ev["damageUsd"] > 0 or ev["deaths"] > 0 or ev["injuries"] > 0


SHARD_RE = re.compile(r"^[A-Z]{2}[CZ]\d{3}\.json\.gz$")


def needs_episode(e: dict) -> bool:
    """Size rule: episode text is kept only for an event whose own narrative is empty (whitespace counts as empty)."""
    return not (e.get("narrative") or "").strip()


def slim_events(events: list[dict]) -> list[dict]:
    """Events with a narrative of their own lose any inline episodeNarrative; event narratives are never touched."""
    return [e if needs_episode(e) or "episodeNarrative" not in e
            else {k: v for k, v in e.items() if k != "episodeNarrative"} for e in events]


def write_shards(st: str, events: list[dict], episodes: dict[str, str], events_dir: str = EVENTS_DIR) -> dict:
    """One gzip file per area code under <events_dir>/<ST>/, each with only the episodes its narrative-less events need
    (see the size rule above). Stale shards are removed."""
    events = slim_events(events)
    by_code: dict[str, list[dict]] = defaultdict(list)
    for e in events:
        by_code[e["area"]["code"]].append(e)
    d = os.path.join(events_dir, st)
    os.makedirs(d, exist_ok=True)
    sizes = {}
    for code, evs in by_code.items():
        if not code.startswith(st):
            raise ValueError(f"{st}: area code {code} belongs to another state")
        used = {e["episodeId"] for e in evs if e["episodeId"] and needs_episode(e) and "episodeNarrative" not in e}
        eps = {k: episodes[k] for k in sorted(used) if k in episodes}
        path = os.path.join(d, f"{code}.json.gz")
        write_index(st, dict(events=evs, episodes=eps), path)
        sizes[code] = os.path.getsize(path)
    for f in os.listdir(d):
        if SHARD_RE.match(f) and f[:-8] not in sizes:
            os.remove(os.path.join(d, f))
    big = max(sizes, key=sizes.get) if sizes else None
    return dict(files=len(sizes), bytes=sum(sizes.values()), largest=big, largest_bytes=sizes.get(big, 0))


def read_shards(st: str, events_dir: str = EVENTS_DIR) -> tuple[list[dict], dict[str, str]]:
    """Every event and episode of a state, read back from its shards."""
    d = os.path.join(events_dir, st)
    events, episodes = [], {}
    for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if SHARD_RE.match(f):
            with gzip.open(os.path.join(d, f), "rt", encoding="utf-8") as fh:
                x = json.load(fh)
            events += x["events"]
            episodes.update(x["episodes"])
    return events, episodes


def build_events(states: list[str], years: list[int], prune: bool) -> list[dict]:
    want = {STATE_NAMES[s]: s for s in states}
    per = {s: {"events": [], "episodes": {}, "conflicts": 0} for s in states}
    for f in se_files(years):
        d = pd.read_csv(f, dtype=str, keep_default_na=False, usecols=EV_COLS)
        d = d[d.STATE.isin(want) & d.CZ_TYPE.isin(["C", "Z"])]
        for r in d.itertuples(index=False):
            st = want[r.STATE]
            b = se_time(r.BEGIN_DATE_TIME, r.CZ_TIMEZONE, st)
            e = se_time(r.END_DATE_TIME, r.CZ_TIMEZONE, st)
            ep = f"E-{r.EPISODE_ID}" if r.EPISODE_ID.strip() else None
            ev = dict(id=f"SE-{r.EVENT_ID}", episodeId=ep, type=r.EVENT_TYPE, start=iso(b), end=iso(e),
                      area=dict(kind=r.CZ_TYPE, code=area_code(st, r.CZ_TYPE, r.CZ_FIPS), name=r.CZ_NAME),
                      deaths=_int(r.DEATHS_DIRECT) + _int(r.DEATHS_INDIRECT),
                      injuries=_int(r.INJURIES_DIRECT) + _int(r.INJURIES_INDIRECT),
                      damageUsd=parse_damage(r.DAMAGE_PROPERTY) + parse_damage(r.DAMAGE_CROPS),
                      magnitude=_mag(r.MAGNITUDE), magnitudeType=r.MAGNITUDE_TYPE.strip() or None,
                      narrative=r.EVENT_NARRATIVE)
            P = per[st]
            if ep is None:
                ev["episodeNarrative"] = r.EPISODE_NARRATIVE  # no episode id to key on: keep it inline
            elif ep not in P["episodes"] or (not P["episodes"][ep] and r.EPISODE_NARRATIVE):
                P["episodes"][ep] = r.EPISODE_NARRATIVE
            elif r.EPISODE_NARRATIVE and P["episodes"][ep] != r.EPISODE_NARRATIVE:
                # NWS sometimes files different episode text on events of the same episode: keep this row's verbatim
                ev["episodeNarrative"] = r.EPISODE_NARRATIVE
                P["conflicts"] += 1
            ev["_t"] = b.timestamp()
            P["events"].append(ev)
        print(f"read {os.path.basename(f)}", file=sys.stderr, flush=True)
    stats = []
    for st in states:
        P = per[st]
        evs = P["events"]
        total = len(evs)
        if prune:
            evs = [e for e in evs if has_impact(e)]
        evs.sort(key=lambda e: (e["_t"], e["id"]))
        for e in evs:
            del e["_t"]
        used = {e["episodeId"] for e in evs if e["episodeId"]}
        episodes = {k: v for k, v in P["episodes"].items() if k in used}
        sh = write_shards(st, evs, P["episodes"])
        stats.append(dict(state=st, events=len(evs), dropped=total - len(evs), episodes=len(episodes),
                          episode_text_conflicts=P["conflicts"],
                          zones=sum(e["area"]["kind"] == "Z" for e in evs), **sh))
        print(json.dumps(stats[-1]), flush=True)
    return stats


def build_se_index(states: list[str], years: list[int]) -> list[dict]:
    bad = [s for s in states if s in LSR_STATES]
    if bad:
        raise SystemExit(f"refusing to rebuild LSR states {bad}: use build_index.py")
    se_all = pd.concat([pd.read_csv(f, dtype=str, keep_default_na=False, usecols=SE_COLS) for f in se_files(years)],
                       ignore_index=True)
    share = shared_counts(se_all)  # nationwide, all types, same rule as build_index.py
    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    stats = []
    for st in states:
        se_st = se_all[se_all.STATE == STATE_NAMES[st]]
        rows = se_floods(se_st, st, share)
        rows.sort(key=lambda r: (r["_start"], r["id"]))
        floods = [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows]
        tors = se_tornadoes(se_st, st)
        data = dict(state=st, built=built, sources=[f"NCEI Storm Events {years[0]}-{years[-1]}"],
                    floods=floods, tornadoes=tors)
        path = write_index(st, data)
        stats.append(dict(state=st, floods=len(floods), tornadoes=len(tors),
                          precision=dict(Counter(r["coordPrecision"] for r in floods)), bytes=os.path.getsize(path)))
        print(json.dumps(stats[-1]), flush=True)
    return stats


def verify(n_states: int = 3, per_state: int = 3, seed: int = 8) -> list[str]:
    """Re-read random event rows from the raw CSVs: times, area code, impacts and verbatim narratives must match."""
    import random
    rng = random.Random(seed)
    states = rng.sample(sorted(STATE_NAMES), n_states)
    lines = []
    for st in states:
        events, episodes = read_shards(st)
        for ev in rng.sample(events, per_state):
            year = int(ev["start"][:4])
            src = None
            for y in (year, year - 1, year + 1):  # BEGIN year can differ from the file year near Jan 1 in local time
                f = pd.read_csv(se_files([y])[0], dtype=str, keep_default_na=False, usecols=EV_COLS)
                hit = f[f.EVENT_ID == ev["id"][3:]]
                if len(hit):
                    src = hit.iloc[0]
                    break
            # size rule: an event with its own narrative carries no episode text
            want_ep = src.EPISODE_NARRATIVE if needs_episode(ev) else None
            ep_text = ev.get("episodeNarrative", episodes.get(ev["episodeId"])) if needs_episode(ev) else (
                ev.get("episodeNarrative"))
            checks = dict(
                time=ev["start"] == iso(se_time(src.BEGIN_DATE_TIME, src.CZ_TIMEZONE, st)),
                code=ev["area"]["code"] == area_code(st, src.CZ_TYPE, src.CZ_FIPS),
                impacts=(ev["deaths"], ev["injuries"], ev["damageUsd"]) == (
                    _int(src.DEATHS_DIRECT) + _int(src.DEATHS_INDIRECT), _int(src.INJURIES_DIRECT) + _int(src.INJURIES_INDIRECT),
                    parse_damage(src.DAMAGE_PROPERTY) + parse_damage(src.DAMAGE_CROPS)),
                narrative=ev["narrative"] == src.EVENT_NARRATIVE, episode=(ep_text or None) == (want_ep or None))
            ok = all(checks.values())
            lines.append(f"{'OK ' if ok else 'BAD'} {st} {ev['id']} {ev['type']} {ev['area']['code']} "
                         f"src='{src.BEGIN_DATE_TIME} {src.CZ_TIMEZONE}' -> {ev['start']} dmg='{src.DAMAGE_PROPERTY}'+'{src.DAMAGE_CROPS}'"
                         f" -> {ev['damageUsd']} {'' if ok else checks}")
    return lines


def shard_legacy(states: list[str], events_dir: str = EVENTS_DIR) -> list[dict]:
    """Split <ST>.json.gz into shards, check the round trip, then delete the state file."""
    stats = []
    for st in states:
        src = os.path.join(events_dir, f"{st}.json.gz")
        if not os.path.exists(src):
            continue
        with gzip.open(src, "rt", encoding="utf-8") as fh:
            d = json.load(fh)
        sh = write_shards(st, d["events"], d["episodes"], events_dir)
        evs, eps = read_shards(st, events_dir)
        ids = sorted(e["id"] for e in d["events"])
        if sorted(e["id"] for e in evs) != ids or len(ids) != len(set(ids)):
            raise SystemExit(f"{st}: shard round trip lost or duplicated events; {src} kept")
        src_by_id = {e["id"]: e for e in d["events"]}
        for e in evs:  # every narrative-less event still resolves to its verbatim episode text (size rule)
            if not needs_episode(e):
                if "episodeNarrative" in e:
                    raise SystemExit(f"{st}: {e['id']} has its own narrative but kept episode text; {src} kept")
                continue
            o = src_by_id[e["id"]]
            want = d["episodes"].get(o["episodeId"], "") if "episodeNarrative" not in o else o["episodeNarrative"]
            got = e.get("episodeNarrative", eps.get(e["episodeId"], ""))
            if want != got:
                raise SystemExit(f"{st}: episode text mismatch on {e['id']}; {src} kept")
        os.remove(src)
        stats.append(dict(state=st, events=len(evs), **sh))
        print(json.dumps(stats[-1]), flush=True)
    return stats


def slim_existing(states: list[str], events_dir: str = EVENTS_DIR) -> list[dict]:
    """Re-write a state's shards under the size rule; event narratives and ids must survive unchanged."""
    stats = []
    for st in states:
        if not os.path.isdir(os.path.join(events_dir, st)):
            continue
        evs, eps = read_shards(st, events_dir)
        before = {e["id"]: (e["narrative"], e.get("episodeNarrative", eps.get(e["episodeId"] or "", ""))) for e in evs}
        if len(before) != len(evs):
            raise SystemExit(f"{st}: duplicate event ids across shards")
        sh = write_shards(st, evs, eps, events_dir)
        got, n_eps = [], 0
        d = os.path.join(events_dir, st)
        for f in sorted(os.listdir(d)):  # check shard by shard: a state-wide episode map would hide a leak
            if not SHARD_RE.match(f):
                continue
            with gzip.open(os.path.join(d, f), "rt", encoding="utf-8") as fh:
                x = json.load(fh)
            n_eps += len(x["episodes"])
            needed = set()
            for e in x["events"]:
                narr, ep = before[e["id"]]
                if e["narrative"] != narr:
                    raise SystemExit(f"{st}: narrative changed on {e['id']}")
                if needs_episode(e):
                    if e.get("episodeNarrative", x["episodes"].get(e["episodeId"] or "", "")) != ep:
                        raise SystemExit(f"{st}: episode text lost on {e['id']}")
                    if "episodeNarrative" not in e and e["episodeId"]:
                        needed.add(e["episodeId"])
                elif "episodeNarrative" in e:
                    raise SystemExit(f"{st}: {e['id']} has its own narrative but kept episode text")
            if set(x["episodes"]) - needed:
                raise SystemExit(f"{st}/{f}: episodes stored that no narrative-less event needs")
            got += x["events"]
        if sorted(e["id"] for e in got) != sorted(before):
            raise SystemExit(f"{st}: slim lost or duplicated events")
        stats.append(dict(state=st, events=len(got), episodes=n_eps, **sh))
        print(json.dumps(stats[-1]), flush=True)
    return stats


def _crosswalk_one(args) -> dict:
    st, offline, events_dir = args
    import area_crosswalk as X
    events, _ = read_shards(st, events_dir)
    years, names = X.area_index(events)
    dates = sorted({X.snapshot_date(y) for ys in years.values() for y in ys})
    cache = X.fetch_snapshots(st, dates, offline=offline)
    xw, prov = X.build_crosswalk(st, years, names, cache)
    path = X.write_crosswalk(st, xw, prov, events_dir)
    zones = X.build_zones(years, X.area_dates(events), names, cache, prov)
    zpath = X.write_zones(st, zones, events_dir)
    conf = Counter(z["confidence"] for z in prov["zones"].values())
    return dict(state=st, counties=len(xw), zones=len(prov["zones"]), confidence=dict(conf),
                approx=sum(bool(z.get("approx")) for z in zones.values()), zones_bytes=os.path.getsize(zpath),
                bytes=os.path.getsize(path) + os.path.getsize(zpath))


def build_crosswalks(states: list[str], offline: bool, workers: int, events_dir: str = EVENTS_DIR) -> list[dict]:
    from concurrent.futures import ProcessPoolExecutor
    stats = []
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for r in ex.map(_crosswalk_one, [(st, offline, events_dir) for st in states]):
            stats.append(r)
            print(json.dumps(r), flush=True)
    return stats


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["events", "index", "verify", "shard", "slim", "crosswalk"])
    ap.add_argument("--states", default=None)
    ap.add_argument("--years", default=None)
    ap.add_argument("--prune", action="store_true")
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args(argv)
    if a.mode == "verify":
        for line in verify():
            print(line)
        return
    if a.mode in ("shard", "slim", "crosswalk"):
        sel = (a.states or "").upper()
        states = list(STATE_NAMES) if sel in ("", "ALL") else [s.strip() for s in sel.split(",") if s.strip()]
        t0 = time.time()
        if a.mode == "shard":
            stats = shard_legacy(states)
        elif a.mode == "slim":
            stats = slim_existing(states)
        else:
            stats = build_crosswalks(states, a.offline, a.workers)
        print(f"total bytes {sum(s['bytes'] for s in stats):,} in {time.time() - t0:.0f}s")
        return
    if a.mode == "events":
        default_states, default_years = list(STATE_NAMES), "2000-2025"
    else:
        default_states, default_years = [s for s in STATE_NAMES if s not in LSR_STATES], "2015-2025"
    sel = (a.states or "").upper()
    states = default_states if sel in ("", "ALL", "REST") else [s.strip() for s in sel.split(",") if s.strip()]
    for s in states:
        if s not in STATE_NAMES:
            raise SystemExit(f"unknown state {s}")
    y0, y1 = (int(x) for x in (a.years or default_years).split("-"))
    t0 = time.time()
    if a.mode == "events":
        stats = build_events(states, list(range(y0, y1 + 1)), a.prune)
    else:
        stats = build_se_index(states, list(range(y0, y1 + 1)))
    print(f"total bytes {sum(s['bytes'] for s in stats):,} in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
