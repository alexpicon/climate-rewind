import gzip
import json
import os
from datetime import datetime

import pytest

import build_index as B
import common as C


def test_storm_events_standard_time_becomes_civil_local_with_offset():
    # NWS Storm Data uses local standard time: 21:55 CST on Mar 27 2021 = 22:55 CDT
    assert C.iso(C.se_time("27-MAR-21 21:55:00", "CST-6", "TN")) == "2021-03-27T22:55:00-05:00"
    assert C.iso(C.se_time("03-MAR-20 00:32:00", "CST-6", "TN")) == "2020-03-03T00:32:00-06:00"
    assert C.iso(C.se_time("13-OCT-18 13:00:00", "MST-7", "AZ")) == "2018-10-13T13:00:00-07:00"  # Arizona: no DST
    assert C.iso(C.se_time("04-JUL-25 03:00:00", "MST-7", "TX")) == "2025-07-04T04:00:00-06:00"  # El Paso: MDT
    assert C.iso(C.se_time("14-JUN-23 16:40:00", "EST-5", "GA")) == "2023-06-14T17:40:00-04:00"


def test_lsr_utc_to_local():
    # the Rosa Parks LSR: 03:55Z on Mar 28 is the evening of Mar 27 in Nashville
    assert C.iso(C.lsr_time("2021-03-28T03:55:00Z", "America/Chicago")) == "2021-03-27T22:55:00-05:00"


@pytest.mark.parametrize("city,want", [("NASHVILLE", "placeholder"), ("Linden", "placeholder"), ("5 S THOMPSON'S STATION", "rounded"),
                                       ("0.5 NNE NASHVILLE", "rounded"), ("", "rounded"), (None, "rounded")])
def test_lsr_precision(city, want):
    assert C.lsr_precision(city) == want


@pytest.mark.parametrize("lat,lon,shared,want", [("36.1717", "-86.9562", 1, "precise"), ("36.183", "-86.6027", 2, "precise"),
                                                 ("36.17", "-86.7811", 1, "rounded"), ("36.1717", "-86.9562", 3, "placeholder"),
                                                 ("", "", 0, "none")])
def test_se_precision(lat, lon, shared, want):
    assert C.se_precision(lat, lon, shared) == want


def _se(id_, lat, lon, start, end):
    return dict(id=id_, filed=[lat, lon], _endpt=(None, None), _start=start, _end=end)


def _lsr(id_, lat, lon, t):
    return dict(id=id_, filed=[lat, lon], _start=t, dupOf=None)


def test_mark_dups_2km_3h():
    t = lambda s: datetime.fromisoformat(s)
    se = [_se("SE-1", 36.17, -86.78, t("2021-03-27T21:00:00-05:00"), t("2021-03-27T23:00:00-05:00"))]
    lsrs = [_lsr("in", 36.18, -86.78, t("2021-03-28T01:30:00-05:00")),      # 1.1 km, 2.5 h after end -> dup
            _lsr("far", 36.20, -86.78, t("2021-03-27T22:00:00-05:00")),     # 3.3 km -> not dup
            _lsr("late", 36.17, -86.78, t("2021-03-28T02:30:00-05:00"))]    # 3.5 h after end -> not dup
    assert B.mark_dups(lsrs, se) == 1
    assert [x["dupOf"] for x in lsrs] == ["SE-1", None, None]


def _feat(**p):
    base = dict(wfo="OHX", type="F", typetext="FLASH FLOOD", st="TN", state="TN", county="DAVIDSON", city="NASHVILLE",
                remark="R", valid="2021-03-28T03:55:00Z", lat=36.17, lon=-86.78)
    base.update(p)
    return {"properties": base}


def test_lsr_rows_state_from_report_types_ids_and_dedupe():
    feats = {"OHX": [_feat(), _feat(remark="B"), _feat(),  # exact repeat (year-boundary overlap) dropped
                     _feat(st="KY", state="KY"),          # cross-state WFO: KY report is not TN
                     _feat(typetext="HAIL"), _feat(typetext="FLOOD", valid="2021-03-28T05:00:00Z")]}
    rows = B.lsr_floods(feats, "TN", {("TN", "DAVIDSON"): "America/Chicago"}, {})
    assert [r["id"] for r in rows] == ["LSR-OHX-202103280355-0", "LSR-OHX-202103280355-1", "LSR-OHX-202103280500-0"]
    r = rows[0]
    assert r["start"] == "2021-03-27T22:55:00-05:00" and r["coordPrecision"] == "placeholder" and r["county"] == "Davidson"
    assert r["quote"] == "B" and rows[1]["quote"] == "R"  # sorted within the same minute; text verbatim


# real IEM remarks (verbatim). Helene was filed as TROPICAL CYCLONE, so the remark decides whether it is a flood report.
@pytest.mark.parametrize("remark,want", [
    ("Several trees down across South Asheville. South Hendersonville Road is flooded.", True),       # GSP 2024-09-27 14:00Z
    ("Dorchester County reported that Seven Mile Road was flooded and impassable near Lebby Drive.", True),  # CHS 2023-08-31
    ("Multiple trees down on cars and homes. Northern part of the county.", False),                   # GSP 2024-09-27 11:27Z
])
def test_tropical_cyclone_lsr_kept_only_when_remark_describes_flooding(remark, want):
    assert B.is_flood_lsr(dict(typetext="TROPICAL CYCLONE", remark=remark)) is want


def test_flood_keyword_guards_negation_agency_names_and_coastal_types():
    # RAH 2023-09-23 and VEF 2025-05-07, verbatim
    assert not B.remark_describes_flooding("Scattered trees down across the county from wind gusts of 35 to 45 mph. "
                                           "No reports of flooding at this time.")
    assert not B.remark_describes_flooding("Mohave County Flood Control webcam at Valle Vista showed a wall of dust "
                                           "to the northeast off of Red Lake.")
    assert B.remark_describes_flooding("Road is not passable due to flooding.")
    assert not B.is_flood_lsr(dict(typetext="COASTAL FLOOD", remark="Street flooding downtown."))
    assert B.is_flood_lsr(dict(typetext="FLASH FLOOD", remark=""))  # flood typetexts need no keyword


def test_lsr_rows_keep_original_typetext_for_remark_qualified_reports():
    feats = {"GSP": [_feat(wfo="GSP", st="NC", state="NC", county="BUNCOMBE", city="1 SE Biltmore Forest",
                           typetext="TROPICAL CYCLONE", valid="2024-09-27T14:00:00Z",
                           remark="Several trees down across South Asheville. South Hendersonville Road is flooded."),
                     _feat(wfo="GSP", st="NC", state="NC", typetext="TROPICAL CYCLONE",
                           remark="Multiple trees down on cars and homes. Northern part of the county.")]}
    rows = B.lsr_floods(feats, "NC", {}, {("NC", "GSP"): "America/New_York"})
    assert len(rows) == 1 and rows[0]["type"] == "TROPICAL CYCLONE" and rows[0]["start"] == "2024-09-27T10:00:00-04:00"


def test_fetch_lsr_asserts_cap(tmp_path, monkeypatch):
    monkeypatch.setattr(B, "LSR_DIR", str(tmp_path))
    monkeypatch.setattr(B, "_get", lambda params: {"features": [{}] * 10000})
    with pytest.raises(AssertionError):
        B.fetch_lsr("XXX", 2020)


def test_fetch_lsr_splits_by_month_when_year_hits_cap(tmp_path, monkeypatch):
    monkeypatch.setattr(B, "LSR_DIR", str(tmp_path))
    seen = []

    def fake(params):
        seen.append(params)
        return {"features": [{}] * (10000 if len(seen) == 1 else 5)}
    monkeypatch.setattr(B, "_get", fake)
    feats = B.fetch_lsr("XXX", 2020)
    assert len(feats) == 60 and len(seen) == 13
    blob = json.load(gzip.open(tmp_path / "XXX_2020.json.gz", "rt"))
    assert [c["n"] for c in blob["calls"]] == [5] * 12 and blob["calls"][-1]["ets"] == "2021-01-01T00:00Z"


# ---- acceptance against the built files (skipped if the build has not been run)
IDX = os.path.join(C.INDEX_DIR, "TN.json.gz")


@pytest.mark.skipif(not os.path.exists(IDX), reason="run build_index.py first")
def test_built_index_has_contract_shape_and_nashville_rows():
    d = C.read_index("TN")
    assert set(d) == {"state", "built", "sources", "floods", "tornadoes"}
    keys = {"id", "source", "type", "start", "county", "wfo", "city", "quote", "filed", "coordPrecision", "placed", "detective", "dupOf"}
    assert all(set(r) == keys for r in d["floods"])
    assert all(r["start"][-6] in "+-" for r in d["floods"])  # every timestamp carries an offset
    rosa = [r for r in d["floods"] if r["quote"] == "ROSA PARKS BLVD UNDERWATER NEAR THE FARMERS MARKET WITH CARS STALLED"]
    assert len(rosa) == 1 and rosa[0]["start"] == "2021-03-27T22:55:00-05:00" and rosa[0]["coordPrecision"] == "placeholder"
    tor = [t for t in d["tornadoes"] if t["id"] == "SE-882999"]
    assert len(tor) == 1 and tor[0]["ef"] == "EF3" and tor[0]["start"].startswith("2020-03-03T00:32:00-06:00")
    assert tor[0]["widthYd"] == 1150 and tor[0]["lengthMi"] == 21.49


@pytest.mark.skipif(not os.path.exists(IDX), reason="run build_index.py first")
def test_all_six_states_built():
    for st in ("TN", "TX", "NC", "MO", "AZ", "GA"):
        d = C.read_index(st)
        assert d["state"] == st and len(d["floods"]) > 1000 and len(d["tornadoes"]) > 30
