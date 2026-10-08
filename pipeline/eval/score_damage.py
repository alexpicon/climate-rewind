"""Score the damage mapper against the hand labels in eval/damage_gold.json (no network, no API).

usage: python eval/score_damage.py [--audit out/damage]   (run from pipeline/)

- Extraction P/R: gold places vs extracted places, matched one-to-one after case and suffix normalization
  (Road=Rd, ...), exact matches first, then containment ("Dogwood Drive" ~ "Catalpa Drive at Dogwood Drive").
- Pin rate: of the gold places, how many were matched to an extracted place that ended up placed
  (reported for the whole narrative and for the row's own county segment).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SUF = {"road": "rd", "street": "st", "drive": "dr", "avenue": "ave", "boulevard": "blvd", "lane": "ln", "parkway": "pkwy",
        "highway": "hwy", "court": "ct", "circle": "cir", "place": "pl", "north": "n", "south": "s", "east": "e", "west": "w",
        "fort": "ft", "the": ""}


def key(s: str) -> str:
    return " ".join(w for w in (_SUF.get(t, t) for t in re.findall(r"[a-z0-9]+", s.lower())) if w)


def match(gold: list[str], pred: list[str]) -> list[tuple[str, str]]:
    """One-to-one (gold, pred) pairs: exact normalized matches first, then containment either way."""
    pairs, used_g, used_p = [], set(), set()
    for g in gold:
        for p in pred:
            if p not in used_p and g not in used_g and key(g) == key(p):
                pairs.append((g, p)); used_g.add(g); used_p.add(p)
    for g in gold:
        for p in pred:
            if p in used_p or g in used_g:
                continue
            kg, kp = f" {key(g)} ", f" {key(p)} "
            if kg in kp or kp in kg:
                pairs.append((g, p)); used_g.add(g); used_p.add(p)
    return pairs


def _jsonl(path):
    return [json.loads(x) for x in open(path) if x.strip()] if os.path.exists(path) else []


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--audit", default=os.path.join(HERE, "out", "damage"))
    a = ap.parse_args(argv)
    gold = json.load(open(os.path.join(HERE, "eval", "damage_gold.json")))["narratives"]
    extracted, placed = {}, {}
    for st in ("TN", "TX"):
        for r in _jsonl(os.path.join(a.audit, f"extract_{st}.jsonl")):
            extracted[r["tornadoId"]] = [p["place"] for p in r["places"]]
        for r in _jsonl(os.path.join(a.audit, f"{st}.jsonl")):
            placed[(r["tornadoId"], r["place"])] = r.get("placed") is not None
    tot = dict(gold=0, pred=0, tp=0, pinned=0, seg_gold=0, seg_pinned=0)
    for tid, g in gold.items():
        allg = g["inSegment"] + g["otherCounty"]
        pred = extracted.get(tid, [])
        pairs = match(allg, pred)
        pinned = [gp for gp, pp in pairs if placed.get((tid, pp))]
        seg_pinned = [x for x in pinned if x in g["inSegment"]]
        missed = [x for x in allg if x not in {gp for gp, _ in pairs}]
        print(f"{tid}: gold {len(allg)} pred {len(pred)} tp {len(pairs)} P {len(pairs) / max(1, len(pred)):.2f} "
              f"R {len(pairs) / max(1, len(allg)):.2f} | pinned {len(pinned)}/{len(allg)} "
              f"(own segment {len(seg_pinned)}/{len(g['inSegment'])}) | missed {missed}")
        for k, v in (("gold", len(allg)), ("pred", len(pred)), ("tp", len(pairs)), ("pinned", len(pinned)),
                     ("seg_gold", len(g["inSegment"])), ("seg_pinned", len(seg_pinned))):
            tot[k] += v
    print(f"TOTAL: P {tot['tp'] / tot['pred']:.2f} R {tot['tp'] / tot['gold']:.2f} ({tot['tp']}/{tot['gold']}, {tot['pred']} predicted) | "
          f"pin rate {tot['pinned']}/{tot['gold']} = {tot['pinned'] / tot['gold']:.2f}; "
          f"own segment {tot['seg_pinned']}/{tot['seg_gold']} = {tot['seg_pinned'] / tot['seg_gold']:.2f}")
    return tot


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
