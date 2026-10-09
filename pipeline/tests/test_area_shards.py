"""Shard writer (data/events/<ST>/<CODE>.json.gz) and the county -> area crosswalk (county-areas.json)."""
import gzip
import json
import os

import pytest

import area_crosswalk as X
from build_areas import read_shards, shard_legacy, slim_existing, write_shards


def ev(i, code, ep, kind=None, start="2010-01-01T00:00:00-08:00", **kw):
    e = dict(id=f"SE-{i}", episodeId=ep, type="High Wind", start=start, end=start,
             area=dict(kind=kind or code[2], code=code, name="X"), deaths=0, injuries=0, damageUsd=0,
             magnitude=None, magnitudeType=None, narrative="n")
    e.update(kw)
    return e


def load(path):
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def test_write_shards_one_file_per_code_with_only_its_episodes(tmp_path):
    evs = [ev(1, "WAZ508", "E-1", narrative=""), ev(2, "WAC033", "E-1", narrative=""), ev(3, "WAC033", "E-2", narrative=" "),
           ev(4, "WAC033", None, narrative="", episodeNarrative="inline")]
    eps = {"E-1": "storm one", "E-2": "storm two", "E-9": "unused"}
    st = write_shards("WA", evs, eps, str(tmp_path))
    assert sorted(os.listdir(tmp_path / "WA")) == ["WAC033.json.gz", "WAZ508.json.gz"]
    z = load(tmp_path / "WA" / "WAZ508.json.gz")
    assert set(z) == {"events", "episodes"}
    assert [e["id"] for e in z["events"]] == ["SE-1"] and z["episodes"] == {"E-1": "storm one"}
    c = load(tmp_path / "WA" / "WAC033.json.gz")
    assert [e["id"] for e in c["events"]] == ["SE-2", "SE-3", "SE-4"]  # input order kept (already time-sorted)
    assert c["episodes"] == {"E-1": "storm one", "E-2": "storm two"}  # whitespace-only narrative counts as empty
    assert c["events"][2]["episodeNarrative"] == "inline"
    assert st["files"] == 2 and st["largest"] in ("WAC033", "WAZ508")


def test_write_shards_keeps_episode_text_only_for_events_without_their_own_narrative(tmp_path):
    evs = [ev(1, "WAC033", "E-1", narrative="own words"),                       # narrated: E-1 not stored for it
           ev(2, "WAC033", "E-2", narrative="own", episodeNarrative="edited"),  # narrated: inline conflict text dropped
           ev(3, "WAC033", "E-3", narrative=""),                                # empty: episode kept in the map
           ev(4, "WAC033", "E-3", narrative="has text"),                        # shares E-3, keeps its own narrative
           ev(5, "WAC033", "E-4", narrative="", episodeNarrative="verbatim conflict"),  # empty + conflict: inline kept
           ev(6, "WAZ508", "E-1", narrative="")]                                # other shard still needs E-1
    eps = {"E-1": "one", "E-2": "two", "E-3": "three", "E-4": "four"}
    write_shards("WA", evs, eps, str(tmp_path))
    c = load(tmp_path / "WA" / "WAC033.json.gz")
    assert c["episodes"] == {"E-3": "three"}
    by = {e["id"]: e for e in c["events"]}
    assert [by[f"SE-{i}"]["narrative"] for i in (1, 2, 3, 4)] == ["own words", "own", "", "has text"]  # verbatim
    assert "episodeNarrative" not in by["SE-2"] and "episodeNarrative" not in by["SE-1"]
    assert by["SE-5"]["episodeNarrative"] == "verbatim conflict"
    assert load(tmp_path / "WA" / "WAZ508.json.gz")["episodes"] == {"E-1": "one"}
    assert evs[1]["episodeNarrative"] == "edited"  # caller's rows are not mutated


def test_write_shards_removes_stale_and_rejects_foreign_codes(tmp_path):
    write_shards("WA", [ev(1, "WAZ007", "E-1")], {"E-1": "a"}, str(tmp_path))
    write_shards("WA", [ev(2, "WAZ508", "E-1")], {"E-1": "a"}, str(tmp_path))
    assert os.listdir(tmp_path / "WA") == ["WAZ508.json.gz"]
    with pytest.raises(ValueError):
        write_shards("WA", [ev(3, "ORZ006", "E-1")], {"E-1": "a"}, str(tmp_path))


def test_shard_legacy_round_trip_deletes_state_file(tmp_path):
    evs = [ev(1, "WAZ508", "E-1", narrative=""), ev(2, "WAC033", "E-1", narrative="", episodeNarrative="edited by NWS"),
           ev(3, "WAC033", "E-1", episodeNarrative="dropped: has own narrative")]
    legacy = tmp_path / "WA.json.gz"
    with gzip.open(legacy, "wt", encoding="utf-8") as fh:
        json.dump(dict(state="WA", events=evs, episodes={"E-1": "orig"}), fh)
    shard_legacy(["WA"], str(tmp_path))
    assert not legacy.exists()
    got, eps = read_shards("WA", str(tmp_path))
    assert sorted(e["id"] for e in got) == ["SE-1", "SE-2", "SE-3"]
    by = {e["id"]: e for e in got}
    assert by["SE-2"]["episodeNarrative"] == "edited by NWS" and eps["E-1"] == "orig"
    assert "episodeNarrative" not in by["SE-3"] and by["SE-3"]["narrative"] == "n"


def test_slim_existing_rewrites_shards_under_the_rule(tmp_path):
    d = tmp_path / "WA"
    d.mkdir()
    with gzip.open(d / "WAC033.json.gz", "wt", encoding="utf-8") as fh:
        json.dump(dict(events=[ev(1, "WAC033", "E-1"), ev(2, "WAC033", "E-2", narrative="")],
                       episodes={"E-1": "one", "E-2": "two"}), fh)
    (d / "zones.json").write_text("{}")
    slim_existing(["WA"], str(tmp_path))
    c = load(d / "WAC033.json.gz")
    assert c["episodes"] == {"E-2": "two"} and [e["narrative"] for e in c["events"]] == ["n", ""]
    assert (d / "zones.json").read_text() == "{}"


# ---------------------------------------------------------------- crosswalk

def sq(x0, y0, x1, y1):
    return {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}


def fake_cache():
    """Two counties side by side; zone Z001 sits inside county 1, Z002 straddles both, Z003 lies in county 1 and grazes county 2
    (2% sliver), and Z009 (retired, used before 2007) exists only in the 2007 snapshot."""
    g = {"c1": sq(0, 0, 1, 1), "c2": sq(1, 0, 2, 1), "z1": sq(0.1, 0.1, 0.4, 0.4), "z2": sq(0.5, 0, 1.5, 1),
         "z3": sq(0.5, 0, 1.01, 0.5), "z9": sq(0.6, 0.6, 0.9, 0.9)}
    base = {"XXC001": "c1", "XXC003": "c2", "XXZ001": "z1", "XXZ002": "z2", "XXZ003": "z3"}
    return {"geoms": g, "names": {"XXC001": "Alpha", "XXC003": "Beta County"},
            "snaps": {X.snapshot_date(2007): {**base, "XXZ009": "z9"}, X.snapshot_date(2015): base}}


def test_poly_contains_handles_holes_and_multipart():
    p = X.Poly({"type": "MultiPolygon", "coordinates": [
        [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]],
        [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]]]})
    import numpy as np
    m = p.contains(np.array([0.5, 2.0, 10.5, 5.0]), np.array([0.5, 2.0, 10.5, 5.0]))
    assert m.tolist() == [True, False, True, False]


def test_build_crosswalk_overlap_slivers_and_history():
    years = {"XXC001": {2015}, "XXZ001": {2015}, "XXZ002": {2015}, "XXZ003": {2015}, "XXZ009": {2003},
             "XXZ077": {2001}}
    names = {"XXZ077": "W ALPHA/E BETA", "XXZ009": "OLD ZONE"}
    xw, prov = X.build_crosswalk("XX", years, names, fake_cache())
    assert xw["XXC001"] == ["XXC001", "XXZ001", "XXZ002", "XXZ003", "XXZ009", "XXZ077"]
    assert xw["XXC003"] == ["XXZ002", "XXZ077"]           # no county events -> no XXC003 entry; Z003 sliver dropped
    assert prov["zones"]["XXZ001"]["confidence"] == "high"
    assert prov["zones"]["XXZ009"]["confidence"] == "medium"  # pre-2007 code, IEM 2007 polygon
    assert prov["zones"]["XXZ077"]["method"] == "name-match" and prov["zones"]["XXZ077"]["confidence"] == "low"


def test_name_match_counties():
    names = {"WAC037": "Kittitas", "WAC077": "Yakima", "WAC039": "Klickitat", "WAC033": "King"}
    assert X.name_match_counties("W KITTITAS/W YAKIMA/W KLICKITAT T X SW", names) == ["WAC037", "WAC039", "WAC077"]
    assert X.name_match_counties("SEATTLE METROPOLITAN AREA", names) == []


def test_crosswalk_write_and_load(tmp_path, monkeypatch):
    monkeypatch.setattr(X, "OUT", str(tmp_path / "out"))
    path = X.write_crosswalk("WA", {"WAC033": ["WAC033", "WAZ508"]}, {"zones": {}}, str(tmp_path))
    assert path == str(tmp_path / "WA" / "county-areas.json")
    assert X.load_crosswalk(path) == {"WAC033": ["WAC033", "WAZ508"]}
    bad = tmp_path / "bad.json"
    for content in ({"WAZ508": ["WAC033"]}, {"WAC033": ["../etc"]}, ["WAC033"]):
        bad.write_text(json.dumps(content))
        with pytest.raises(ValueError):
            X.load_crosswalk(str(bad))


REAL = os.path.join(os.path.dirname(__file__), "..", "..", "data", "events", "WA", "county-areas.json")


@pytest.mark.skipif(not os.path.exists(REAL), reason="built crosswalk not present")
def test_real_king_county_carries_renumbered_zones():
    xw = X.load_crosswalk(REAL)
    for code in ("WAC033", "WAZ007", "WAZ508", "WAZ556", "WAZ558"):
        assert code in xw["WAC033"]


def test_thin_zone_with_no_qualifying_overlap_goes_to_nearest_county_low_confidence():
    c = fake_cache()
    c["geoms"]["zk"] = sq(2.05, 0.1, 2.3, 0.2)  # offshore strip next to county 2, touching nothing
    c["snaps"][X.snapshot_date(2015)]["XXZ050"] = "zk"
    xw, prov = X.build_crosswalk("XX", {"XXZ050": {2015}}, {}, c)
    assert xw == {"XXC003": ["XXZ050"]}
    assert prov["zones"]["XXZ050"]["confidence"] == "low" and prov["zones"]["XXZ050"]["method"].endswith("+best-county")


def test_build_zones_polygons_versions_and_approx():
    c = fake_cache()
    c["snaps"][X.snapshot_date(2015)]["XXZ001"] = "z1b"
    c["geoms"]["z1b"] = sq(0.1, 0.1, 0.8, 0.8)  # boundary moved by 2015
    years = {"XXZ001": {2008, 2015, 2016}, "XXZ002": {2015}, "XXZ077": {2001}}
    dates = {"XXZ001": ("2008-03-01", "2016-05-02"), "XXZ002": ("2015-01-01", "2015-01-01"), "XXZ077": ("2001-01-01", "2001-02-01")}
    c["snaps"][X.snapshot_date(2008)] = c["snaps"][X.snapshot_date(2007)]
    _, prov = X.build_crosswalk("XX", years, {"XXZ077": "W ALPHA"}, c)
    z = X.build_zones(years, dates, {"XXZ077": "W ALPHA"}, c, prov)
    assert z["XXZ001"]["validFrom"] == "2008-03-01" and z["XXZ001"]["validTo"] == "2016-05-02"
    assert z["XXZ001"]["bbox"] == [0.1, 0.1, 0.8, 0.8]          # the version used by most event years
    assert [v["years"] for v in z["XXZ001"]["versions"]] == [[2008], [2015, 2016]]
    assert "versions" not in z["XXZ002"] and z["XXZ002"]["polygon"]["type"] == "MultiPolygon"
    assert z["XXZ077"]["approx"] is True and z["XXZ077"]["bbox"] == [0.0, 0.0, 1.0, 1.0] and "polygon" not in z["XXZ077"]
    assert X.zones_containing(z, 0.6, 0.6) == ["XXZ001", "XXZ002"]
    assert X.zones_containing(z, 0.6, 0.6, year=2008) == ["XXZ002"]   # 2008 polygon of Z001 stops at 0.4


def test_simplify_geometry_drops_redundant_vertices():
    ring = [[0, 0], [0.5, 0.001], [1, 0], [1, 1], [0, 1], [0, 0]]
    g = X.simplify_geometry({"type": "Polygon", "coordinates": [ring]}, tol=0.01)
    assert g["type"] == "MultiPolygon" and len(g["coordinates"][0][0]) == 5
    assert X.simplify_geometry({"type": "Polygon", "coordinates": [[[0, 0], [0.001, 0], [0, 0.001], [0, 0]]]}) is None
