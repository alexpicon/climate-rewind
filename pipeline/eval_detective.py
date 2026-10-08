"""Pre-registered re-test of the detective vs no-AI baseline v2 (see eval/PREREG.md; do not edit it after a run).

usage: eval_detective.py sample                       # draw the fresh 100-record sample once (seeds 20261009/20261010)
       eval_detective.py run --method baseline        # no AI, free (Census + Nominatim, 2.0 s gap)
       eval_detective.py run --method detective [--dry-run] [--max-records 100]
       eval_detective.py score
Primary metric: wrong-pin rate = records placed > 5 km from the hidden NWS point / n.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys

import numpy as np
import pandas as pd

from common import HERE, hav_km

EVAL = os.path.join(HERE, "eval")
SPIKE_TRUTH = os.path.normpath(os.path.join(HERE, "..", "..", "research", "memoria-ai-spike", "data", "truth.jsonl"))
SEED_A, SEED_B = 20261009, 20261010
ST = {'TEXAS': 'TX', 'TENNESSEE': 'TN', 'NORTH CAROLINA': 'NC', 'MISSOURI': 'MO', 'ARIZONA': 'AZ', 'GEORGIA': 'GA'}
P = lambda name: os.path.join(EVAL, name)


# ---------------------------------------------------------------- sample (ported from build_sets.py, unchanged rules)
W = r"(?:[A-Z0-9][\w'.-]*\s){1,3}"
STREET = r"(?i:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Highway|Hwy|Parkway|Pkwy|Court|Ct|Circle|Cir|Trail|Trl|Way|Place|Pl|Pike|Freeway|Fwy|Expressway|Terrace|Ter)\b\.?"
LAND = r"(?i:Park|School|Church|Bridge|Mall|Market|Center|Plaza|Apartments|Cemetery|Airport|Hospital|Stadium|Campus|Subdivision|Mobile Home Park|Shopping Center)\b"
CREEK = r"(?i:Creek|Branch|Bayou|Draw|Wash|Fork)\b"
ROUTE = r"\b(?:FM|F\.M\.|Farm to Market Road|Highway|Hwy|US|U\.S\.|State Route|SR|Route|Interstate|I-|County Road|CR|Loop|Spur|RM|Ranch Road|NC|TN|MO|GA|TX|AZ)\s?-?\d{1,4}[A-Z]?\b"
RIVER = r"(?i:River|Lake)\b"
REL = r"(?i:\bnear the\b|\bbetween\b|\balong\b|\bacross from\b|\bbehind\b|\bnorth of\b|\bsouth of\b|\beast of\b|\bwest of\b|\bmiles? (?:north|south|east|west)|\bupstream|\bdownstream)"
STOP = {'a', 'an', 'the', 'significant', 'nearby', 'local', 'small', 'several', 'many', 'multiple', 'some', 'area', 'of', 'and', 'at', 'on', 'in', 'flooding', 'flooded', 'major', 'minor', 'high', 'water', 'one', 'two', 'this', 'that', 'city', 'county', 'state', 'road', 'roads', 'low', 'heavy', 'rain', 'from', 'by', 'to', 'its', 'their', 'his', 'her', 'into', 'over', 'along', 'near', 'numerous', 'various', 'other', 'both', 'all', 'each', 'swift', 'unnamed', 'creeks', 'large'}


def mentions(t):
    s = set()
    for pat, k in [(W + STREET, 'street'), (ROUTE, 'street'), (W + LAND, 'landmark'), (W + CREEK, 'creek'), (W + RIVER, 'river')]:
        for m in re.finditer(pat, t):
            g = re.sub(r'\s+', ' ', m.group(0).strip()).lower(); w = g.split()[:-1]
            if k != 'street' or not pat.startswith('\\b'):
                if all(x.strip('.,') in STOP for x in w):
                    continue
            s.add((k, g))
    return s


def hav_np(a, b, c, e):
    p = np.pi / 180; x = np.sin((c - a) * p / 2) ** 2 + np.cos(a * p) * np.cos(c * p) * np.sin((e - b) * p / 2) ** 2
    return 2 * 6371.0088 * np.arcsin(np.sqrt(x))


def pools(d: pd.DataFrame, exclude: set):
    d = d.copy()
    d['coord'] = d.BEGIN_LAT + ',' + d.BEGIN_LON
    share = d[d.BEGIN_LAT != ''].groupby('coord').EVENT_ID.nunique()
    f = d[d.EVENT_TYPE.isin(['Flood', 'Flash Flood']) & d.STATE.isin(ST) & (d.CZ_TYPE == 'C')].copy()
    dec = lambda s: len(s.split('.')[1]) if isinstance(s, str) and '.' in s else 0
    f['dmin'] = np.minimum(f.BEGIN_LAT.map(dec), f.BEGIN_LON.map(dec)); f['dmax'] = np.maximum(f.BEGIN_LAT.map(dec), f.BEGIN_LON.map(dec))
    for c in ['BEGIN_LAT', 'BEGIN_LON', 'END_LAT', 'END_LON', 'BEGIN_RANGE']:
        f[c + '_n'] = pd.to_numeric(f[c], errors='coerce')
    f['be_km'] = hav_np(f.BEGIN_LAT_n, f.BEGIN_LON_n, f.END_LAT_n.fillna(f.BEGIN_LAT_n), f.END_LON_n.fillna(f.BEGIN_LON_n))
    f['shared'] = f.coord.map(share).fillna(0)
    f['narr'] = f.EVENT_NARRATIVE.fillna('').str.strip()
    precise = (f.dmax >= 4) & (f.dmin >= 3) & (f.shared == 1) & (f.BEGIN_RANGE_n > 0) & f.narr.str.len().between(40, 900)
    f['m'] = f.narr.map(mentions)
    f['n_place'] = f.m.map(lambda s: len([x for x in s if x[0] != 'river']))
    f['n_river'] = f.m.map(lambda s: len([x for x in s if x[0] == 'river']))
    f['rel'] = f.narr.str.contains(REL)
    f = f[~f.EVENT_ID.isin(exclude)]
    A_pool = f[precise & (f.be_km <= 1.5) & f.n_place.between(1, 2) & (f.n_river == 0) & ~f.rel & (f.narr.str.len() <= 350)]
    B_pool = f[precise & (f.be_km <= 2.0) & ((f.n_place >= 3) | ((f.n_place >= 1) & f.rel)) & ~f.EVENT_ID.isin(A_pool.EVENT_ID)]
    return A_pool, B_pool


def strat(pool, n, seed):
    states = list(ST); per = {s: n // 6 + (1 if i < n % 6 else 0) for i, s in enumerate(states)}
    parts = [pool[pool.STATE == s].sample(min(per[s], int((pool.STATE == s).sum())), random_state=seed) for s in states]
    out = pd.concat(parts)
    if len(out) < n:
        out = pd.concat([out, pool.drop(out.index).sample(n - len(out), random_state=seed)])
    return out.sample(frac=1, random_state=seed)


def cmd_sample(force=False):
    if os.path.exists(P('sample.jsonl')) and not force:
        raise SystemExit("eval/sample.jsonl exists; the sample is drawn once (PREREG). Use --force only before any run.")
    if not os.path.exists(SPIKE_TRUTH):
        raise SystemExit(f"need {SPIKE_TRUTH} to exclude the round-1/2 ids")
    exclude = {str(json.loads(l)['event_id']) for l in open(SPIKE_TRUTH)}
    import build_index
    d = build_index.load_storm_events(list(range(2015, 2026)))
    A_pool, B_pool = pools(d, exclude)
    A, B = strat(A_pool, 60, SEED_A), strat(B_pool, 40, SEED_B)
    os.makedirs(EVAL, exist_ok=True)
    with open(P('sample.jsonl'), 'w') as fs, open(P('truth.jsonl'), 'w') as ft:
        for name, s in [('A', A), ('B', B)]:
            for _, r in s.iterrows():
                i = f"{name}-{r.EVENT_ID}"
                fs.write(json.dumps(dict(id=i, set=name, state=ST[r.STATE], county=r.CZ_NAME.title(), narrative=r.narr)) + '\n')
                ft.write(json.dumps(dict(id=i, set=name, event_id=r.EVENT_ID, truth_lat=float(r.BEGIN_LAT_n), truth_lon=float(r.BEGIN_LON_n),
                                         event_type=r.EVENT_TYPE, date=r.BEGIN_YEARMONTH + r.BEGIN_DAY.zfill(2))) + '\n')
    sha = hashlib.sha256(open(P('sample.jsonl'), 'rb').read()).hexdigest()
    man = dict(sha256=sha, n=len(A) + len(B), pool_A=len(A_pool), pool_B=len(B_pool), seeds=[SEED_A, SEED_B],
               excluded_ids=len(exclude), overlap_with_spike=int(len(set(A.EVENT_ID) | set(B.EVENT_ID)) - len((set(A.EVENT_ID) | set(B.EVENT_ID)) - exclude)),
               states_A=A.STATE.map(ST).value_counts().to_dict(), states_B=B.STATE.map(ST).value_counts().to_dict())
    json.dump(man, open(P('sample_manifest.json'), 'w'), indent=1)
    print(json.dumps(man))


# ---------------------------------------------------------------- run
def load_jsonl(path):
    return [json.loads(l) for l in open(path) if l.strip()] if os.path.exists(path) else []


def cmd_run(method, dry_run=False, max_records=100, max_tools=8, client=None, geo=None):
    sample = load_jsonl(P('sample.jsonl'))
    if not sample:
        raise SystemExit("no eval/sample.jsonl; run `eval_detective.py sample` first")
    out_path = P(f'out_{method}.jsonl')
    done = {x['id'] for x in load_jsonl(out_path)}
    todo = [t for t in sample if t['id'] not in done][:max_records]
    if method == 'detective':
        import detective as dmod
        recs = [_as_record(t) for t in todo]
        est = dmod.estimate(recs, max_tools)
        print(f"{len(todo)} records to run; estimate {json.dumps(est)}")
        if dry_run:
            print("dry run: no API calls made")
            return
        client = client or dmod.make_client()
    elif dry_run:
        print(f"{len(todo)} records to run (baseline, no AI, $0). dry run: no calls made")
        return
    if geo is None:
        from geo import Geo
        geo = Geo(nominatim_gap=2.0)
    if method == 'baseline':
        import baseline_v2 as b2
        for t in todo:
            res = b2.place_record(geo, t)
            _append(out_path, res)
    elif method == 'detective':
        det = dmod.Detective(client, geo, max_tools=max_tools)
        for t in todo:
            r = det.run(_as_record(t))
            d = r['detective']
            _append(out_path, dict(id=t['id'], lat=(r['placed'] or [None, None])[0], lon=(r['placed'] or [None, None])[1],
                                   confidence=d['confidence'], clues_used=d['clues'], rationale=d.get('match'),
                                   verdict=d['verdict'], matchType=d['matchType'], rejected=r['audit']['rejected'],
                                   tokens_in=r['audit']['input_tokens'], tokens_out=r['audit']['output_tokens'],
                                   tool_calls=r['audit']['tool_calls']))
    else:
        raise SystemExit(f"unknown method {method}")
    print(f"wrote {out_path}")


def _as_record(t):
    # the NWS town field is withheld in the eval (it is derived from the hidden point)
    return dict(id=t['id'], source='StormEvents', type='', start='', state=t['state'], county=t['county'], city=None, quote=t['narrative'])


def _append(path, obj):
    with open(path, 'a') as fh:
        fh.write(json.dumps(obj) + '\n')


# ---------------------------------------------------------------- score
def num(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def rows_for(path, truth):
    recs = {}
    for x in load_jsonl(path):
        if isinstance(x, dict) and x.get('id') in truth and x['id'] not in recs:
            recs[x['id']] = x
    out = {}
    for i, t in truth.items():
        x = recs.get(i) or {}
        lat, lon = num(x.get('lat')), num(x.get('lon'))
        placed = lat is not None and lon is not None and abs(lat) <= 90 and abs(lon) <= 180
        out[i] = dict(id=i, set=t['set'], missing=not recs.get(i), placed=placed, conf=x.get('confidence'),
                      err=hav_km(t['truth_lat'], t['truth_lon'], lat, lon) if placed else None,
                      rejected=x.get('rejected'), tokens_in=x.get('tokens_in', 0), tokens_out=x.get('tokens_out', 0))
    return out


def metrics(rows):
    out = {}
    for s in ('A', 'B', 'ALL'):
        R = [r for r in rows.values() if s == 'ALL' or r['set'] == s]
        n = len(R)
        e = np.array([r['err'] for r in R if r['placed']])
        missing = sum(r['missing'] for r in R)
        # A record with no output line at all is MISSING (the run did not finish for it); it is not an abstain.
        # Abstain = the method ran on the record and left it unplaced. placed + abstain + missing_rate = 1.
        out[s] = dict(n=n, placed=len(e) / n if n else 0, abstain=(n - missing - len(e)) / n if n else 0, missing_rate=missing / n if n else 0,
                      w1=float((e <= 1).sum()) / n if n else 0, w2=float((e <= 2).sum()) / n if n else 0,
                      wrong5=float((e > 5).sum()) / n if n else 0, wrong5_of_placed=float((e > 5).mean()) if len(e) else None,
                      median=float(np.median(e)) if len(e) else None, p90=float(np.percentile(e, 90)) if len(e) else None,
                      missing=missing)
    return out


def mcnemar_exact(b: int, c: int) -> float:
    """Two-sided exact McNemar p on discordant counts b, c."""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    p = sum(math.comb(n, i) for i in range(0, k + 1)) / 2 ** n
    return min(1.0, 2 * p)


def decide(base, det):
    Wb, Wd = base['ALL']['wrong5'], det['ALL']['wrong5']
    dW, dR = 100 * (Wb - Wd), 100 * (det['ALL']['w1'] - base['ALL']['w1'])
    return dW, dR


def verdict(dW, dR, p, Wd, missing=0):
    if dW < 0:
        v = 'DETECTIVE WORSE'
    elif dW >= 15 and p < 0.05:
        v = 'FEWER WRONG PINS (supported)' if dR >= -5 else 'FEWER WRONG PINS, LESS REACH'
    else:
        v = 'NOT SUPPORTED'
    out = dict(delta_wrong_pp=round(dW, 1), delta_reach_pp=round(dR, 1), mcnemar_p=round(p, 5), verdict=v,
               headline_bar_wrong_le_10pct=Wd <= 0.10, missing_records=missing, complete=missing == 0)
    if missing:
        out['warning'] = f"INCOMPLETE: {missing} record(s) have no output (missing, not abstained). Finish the run before reporting."
    return out


def score(truth, base_rows, det_rows):
    mb, md = metrics(base_rows), metrics(det_rows)
    wb = {i: bool(r['placed'] and r['err'] > 5) for i, r in base_rows.items()}
    wd = {i: bool(r['placed'] and r['err'] > 5) for i, r in det_rows.items()}
    b = sum(1 for i in truth if wb[i] and not wd[i])  # baseline wrong, detective not
    c = sum(1 for i in truth if wd[i] and not wb[i])
    p = mcnemar_exact(b, c)
    dW, dR = decide(mb, md)
    v = verdict(dW, dR, p, md['ALL']['wrong5'], mb['ALL']['missing'] + md['ALL']['missing'])
    calib = {}
    for lvl in ('high', 'medium', 'low'):
        R = [r for r in det_rows.values() if r['placed'] and r['conf'] == lvl]
        calib[lvl] = dict(n=len(R), w1=sum(r['err'] <= 1 for r in R), wrong5=sum(r['err'] > 5 for r in R))
    rej = {}
    for r in det_rows.values():
        if r['rejected']:
            rej[r['rejected']] = rej.get(r['rejected'], 0) + 1
    tok_in = sum(r['tokens_in'] or 0 for r in det_rows.values()); tok_out = sum(r['tokens_out'] or 0 for r in det_rows.values())
    return dict(baseline=mb, detective=md, discordant=dict(baseline_only_wrong=b, detective_only_wrong=c), decision=v,
                calibration=calib, confidently_wrong=calib['high']['wrong5'], rejections=rej,
                tokens=dict(input=tok_in, output=tok_out))


def cmd_score():
    truth = {x['id']: x for x in load_jsonl(P('truth.jsonl'))}
    if not truth:
        raise SystemExit("no eval/truth.jsonl")
    for m in ('baseline', 'detective'):
        if not os.path.exists(P(f'out_{m}.jsonl')):
            raise SystemExit(f"missing eval/out_{m}.jsonl; run it first")
    res = score(truth, rows_for(P('out_baseline.jsonl'), truth), rows_for(P('out_detective.jsonl'), truth))
    json.dump(res, open(P('score.json'), 'w'), indent=1)
    print(json.dumps(res['decision']))
    for name in ('baseline', 'detective'):
        a = res[name]['ALL']
        print(f"{name:<9} wrong>5km {a['wrong5']:.0%}  <=1km {a['w1']:.0%}  abstain {a['abstain']:.0%}  "
              f"missing {a['missing']} ({a['missing_rate']:.0%})  median {a['median']}")
    if not res['decision']['complete']:
        print("WARNING: " + res['decision']['warning'])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('sample'); s.add_argument('--force', action='store_true')
    r = sub.add_parser('run'); r.add_argument('--method', required=True, choices=['baseline', 'detective'])
    r.add_argument('--dry-run', action='store_true'); r.add_argument('--max-records', type=int, default=100)
    r.add_argument('--max-tools', type=int, default=8)
    sub.add_parser('score')
    a = ap.parse_args(argv)
    if a.cmd == 'sample':
        cmd_sample(a.force)
    elif a.cmd == 'run':
        cmd_run(a.method, a.dry_run, a.max_records, a.max_tools)
    else:
        cmd_score()


if __name__ == '__main__':
    main()
