import json
from types import SimpleNamespace

import pytest

import damage_mapper as M
from conftest import FakeClient, FakeGeo, resp, tool

# Shortened from the real SE-882999 narrative (Davidson segment of the Mar 3, 2020 EF3). Coordinates below are test values.
TEXT = ("The tornado strengthened significantly as it crossed the Cumberland River into the John C. Tune Airport area, "
        "causing strong EF-2 damage to numerous planes. The tornado intensified further as it tracked through East Nashville, "
        "with EF-3 damage to businesses and other buildings in the Five Points area and EF-2 damage to homes in the "
        "Lockeland Springs and Barclay Drive neighborhoods. One elderly couple was killed on Catalpa Drive at Dogwood Drive.")
TOR = dict(id="SE-882999", start="2020-03-03T00:32:00-06:00", ef="EF3", begin=[36.1717, -86.9562], end=[36.1767, -86.5717],
           narrative=TEXT, episodeNarrative="Supercells spawned tornadoes across Tennessee.")
ON_TRACK = (36.1760, -86.7480)      # ~0.1 km from the segment line
OFF_TRACK = (36.1000, -86.7480)     # ~8 km south of it


def grp(tor, county="Davidson"):
    """A one-segment tornado group (what tornado_groups returns for a single-county track)."""
    return dict(id=tor["id"], rep=tor, segments=[dict(id=tor["id"], county=county, begin=tor["begin"], end=tor["end"])],
                counties=[county], members=[tor["id"]], selected=[tor["id"]])


def submit(**kw):
    base = dict(verdict="placed", clues=[], candidate_id=None, lat=None, lon=None, confidence="high", reason="r")
    base.update(kw)
    return base


def last_candidates(messages):
    for m in reversed(messages):
        if m["role"] == "user" and isinstance(m["content"], list):
            return json.loads(m["content"][0]["content"]).get("candidates", [])
    return []


def pin(place, phrase, query, hit, clues, tool_name="census_geocode", county="Davidson"):
    """Run the geocode loop once: one tool call for `query` returning `hit`, then a verdict on the first candidate."""
    geo = FakeGeo(census={query: [hit]} if tool_name == "census_geocode" else {}, nominatim={query: [hit]} if tool_name != "census_geocode" else {})

    def final(msgs):
        c = last_candidates(msgs)[0]
        return resp(tool("submit_verdict", submit(clues=clues, candidate_id=c["candidate_id"], lat=c["lat"], lon=c["lon"]), "t2"))
    client = FakeClient([resp(tool(tool_name, {"query": query}, "t1")), final])
    rec = M.geocode_rec(grp(TOR, county), "TN", dict(place=place, phrase=phrase))
    return M.DamageGeocoder(client, geo).run(rec), client


# ---------------------------------------------------------------- extraction: substring rule
def test_extraction_keeps_verbatim_places_and_drops_invented_ones():
    places = [
        dict(place="Five Points", phrase="EF-3 damage to businesses and other buildings in the Five Points area", ef="EF3"),
        dict(place="Five Points Pizza", phrase="EF-3 damage to businesses", ef="EF3"),                     # place not in text
        dict(place="Lockeland Springs", phrase="EF-2 damage to homes in Lockeland Springs", ef="EF2"),     # phrase reworded
        dict(place="Barclay Drive", phrase="Lockeland Springs and Barclay Drive neighborhoods", ef="EF3"), # EF3 not in that sentence for it? it is (same sentence)
        dict(place="John C. Tune Airport", phrase="causing strong EF-2 damage to numerous planes", ef="EF4"), # EF4 never stated
        dict(place="Catalpa Drive at Dogwood Drive", phrase="One elderly couple was killed on Catalpa Drive at Dogwood Drive", ef=None),
    ]
    client = FakeClient([resp(tool("submit_places", {"places": places}, "x1"))])
    out = M.extract(client, TOR)
    kept = {p["place"]: p for p in out["places"]}
    reasons = {d["place"]: d["reason"] for d in out["dropped"]}
    assert reasons == {"Five Points Pizza": "place_not_substring", "Lockeland Springs": "phrase_not_substring"}
    assert kept["Five Points"]["ef"] == "EF3"
    assert kept["John C. Tune Airport"]["ef"] is None and kept["John C. Tune Airport"]["ef_note"] == "ef_EF4_not_stated_in_sentence"
    assert kept["Catalpa Drive at Dogwood Drive"]["ef"] is None
    assert "<narrative>" in client.calls[0]["messages"][0]["content"]


def test_place_must_sit_next_to_its_damage_phrase():
    row, why = M.check_extracted(dict(place="Catalpa Drive", phrase="causing strong EF-2 damage to numerous planes", ef=None), TEXT)
    assert row is None and why == "place_not_near_phrase"


def test_abbreviation_period_does_not_split_a_sentence():
    row, why = M.check_extracted(dict(place="John C. Tune Airport", phrase="causing strong EF-2 damage", ef="EF2"), TEXT)
    assert why is None and row["ef"] == "EF2"


def test_substring_is_case_and_whitespace_insensitive_but_not_spelling_insensitive():
    assert M.check_extracted(dict(place="five  points", phrase="Five Points area", ef=None), TEXT)[1] is None
    assert M.check_extracted(dict(place="5 Points", phrase="Five Points area", ef=None), TEXT)[1] == "place_not_substring"


# ---------------------------------------------------------------- geocode: happy path, off-track, county
def test_on_track_intersection_in_county_is_placed():
    hit = dict(matched="CATALPA DR & DOGWOOD DR, NASHVILLE, TN, 37206", lat=ON_TRACK[0], lon=ON_TRACK[1], county="Davidson County", state="TN")
    out, _ = pin("Catalpa Drive at Dogwood Drive", "killed on Catalpa Drive at Dogwood Drive",
                 "Catalpa Drive & Dogwood Drive, Nashville, TN", hit, ["Catalpa Drive at Dogwood Drive"])
    assert out["placed"] == [ON_TRACK[0], ON_TRACK[1]]
    assert out["detective"]["matchType"] == "intersection"
    assert out["audit"]["kmFromTrack"] < 0.5


def test_off_track_point_is_rejected_even_when_every_other_rule_passes():
    hit = dict(matched="CATALPA DR & DOGWOOD DR, NASHVILLE, TN, 37211", lat=OFF_TRACK[0], lon=OFF_TRACK[1], county="Davidson County", state="TN")
    out, client = pin("Catalpa Drive at Dogwood Drive", "killed on Catalpa Drive at Dogwood Drive",
                      "Catalpa Drive & Dogwood Drive, Nashville, TN", hit, ["Catalpa Drive at Dogwood Drive"])
    assert out["placed"] is None and out["detective"]["verdict"] == "unknown"
    assert out["audit"]["rejected"] == "off_track" and out["audit"]["kmFromTrack"] > 2
    # the model was shown the distance too
    assert last_candidates(client.calls[1]["messages"])[0]["kmFromTrack"] > 2


def test_other_county_is_rejected_even_on_the_track_line():
    hit = dict(matched="CATALPA DR & DOGWOOD DR, MOUNT JULIET, TN, 37122", lat=ON_TRACK[0], lon=ON_TRACK[1], county="Wilson County", state="TN")
    out, _ = pin("Catalpa Drive at Dogwood Drive", "killed on Catalpa Drive at Dogwood Drive",
                 "Catalpa Drive & Dogwood Drive, Mount Juliet, TN", hit, ["Catalpa Drive at Dogwood Drive"])
    assert out["placed"] is None and out["audit"]["rejected"] == "out_of_county"


def test_pinning_a_different_place_from_the_narrative_is_rejected():
    # asked for Barclay Drive, the model geocodes the (real, in-text) Catalpa/Dogwood intersection instead
    hit = dict(matched="CATALPA DR & DOGWOOD DR, NASHVILLE, TN, 37206", lat=ON_TRACK[0], lon=ON_TRACK[1], county="Davidson County", state="TN")
    out, _ = pin("Barclay Drive", "Lockeland Springs and Barclay Drive neighborhoods",
                 "Catalpa Drive & Dogwood Drive, Nashville, TN", hit, ["Catalpa Drive at Dogwood Drive"])
    assert out["placed"] is None and out["audit"]["rejected"] == "query_not_this_place"


def test_coordinates_must_come_from_a_tool_result():
    geo = FakeGeo()
    client = FakeClient([resp(tool("submit_verdict", submit(clues=["Five Points"], candidate_id="c1", lat=ON_TRACK[0], lon=ON_TRACK[1]), "t1"))])
    out = M.DamageGeocoder(client, geo).run(M.geocode_rec(grp(TOR), "TN", dict(place="Five Points", phrase="Five Points area")))
    assert out["placed"] is None and out["audit"]["rejected"] == "coords_not_from_tool"


def test_named_area_neighbourhood_on_track_is_placed_but_a_street_alone_is_not():
    nb = {"name": "Five Points", "display_name": "Five Points, Nashville, Davidson County, Tennessee", "lat": str(ON_TRACK[0]),
          "lon": str(ON_TRACK[1]), "category": "place", "type": "neighbourhood", "addresstype": "neighbourhood",
          "address": {"county": "Davidson County", "ISO3166-2-lvl4": "US-TN"}}
    out, _ = pin("Five Points", "Five Points area", "Five Points, Nashville, TN", nb, ["Five Points"], tool_name="nominatim_search")
    assert out["placed"] is not None and out["detective"]["matchType"] == "named_area"
    road = dict(nb, name="Barclay Drive", category="highway", type="residential", addresstype="road")
    out, _ = pin("Barclay Drive", "Barclay Drive neighborhoods", "Barclay Drive, Nashville, TN", road, ["Barclay Drive"], tool_name="nominatim_search")
    assert out["placed"] is None and out["audit"]["rejected"] == "match_type_not_allowed"


# ---------------------------------------------------------------- geometry + output
def test_km_to_segment():
    assert M.km_to_segment(36.1717, -86.9562, TOR["begin"], TOR["end"]) == pytest.approx(0, abs=1e-6)
    assert M.km_to_segment(*OFF_TRACK, TOR["begin"], TOR["end"]) == pytest.approx(8.4, abs=0.3)
    # beyond the end point the distance is to the end point, not to the infinite line
    assert M.km_to_segment(36.1767, -86.45, TOR["begin"], TOR["end"]) == pytest.approx(10.9, abs=0.3)
    assert M.km_to_segment(36.0, -86.0, [36.0, -86.0], None) == 0


def test_build_output_writes_only_placed_rows_in_the_contract_shape(tmp_path, monkeypatch):
    monkeypatch.setattr(M, "AUDIT_DIR", str(tmp_path / "audit"))
    monkeypatch.setattr(M, "DAMAGE_DIR", str(tmp_path / "damage"))
    det = dict(verdict="placed", clues=["Five Points"], match="FIVE POINTS", matchType="named_area", confidence="low", model="m", ranAt="t")
    M._append(str(tmp_path / "audit" / "TN.jsonl"), dict(tornadoId="SE-1", place="Five Points", phrase="p", ef="EF3", placed=[36.1, -86.7], detective=det))
    M._append(str(tmp_path / "audit" / "TN.jsonl"), dict(tornadoId="SE-1", place="Barclay Drive", phrase="q", ef=None, placed=None,
                                                         detective=dict(det, verdict="unknown", matchType=None)))
    rows = M.build_output("TN")
    assert rows == [dict(tornadoId="SE-1", place="Five Points", phrase="p", ef="EF3", lat=36.1, lon=-86.7, matchType="named_area", confidence="low")]
    assert json.load(open(tmp_path / "damage" / "TN.json")) == rows


def test_dry_run_makes_no_calls(monkeypatch, capsys):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(M, "read_index", lambda st: dict(state="TN", floods=[], tornadoes=[TOR]))
    M.main(["--state", "TN", "--near", "36.168,-86.778", "--km", "15", "--dry-run"])
    out = capsys.readouterr().out
    assert "SE-882999" in out and "dry run: no API calls made" in out


def test_budget_meter_refuses_a_call_that_would_pass_the_cap():
    from budget import BudgetExceeded, Ledger, MeteredClient
    led = Ledger(None, 0.05, 3.0, 15.0)
    inner = FakeClient([resp(tool("submit_places", {"places": []}, "x"))] * 5)  # usage: 1000 in, 100 out = $0.0045 per call
    c = MeteredClient(inner, led)
    c.messages.create(model="m", max_tokens=1024, system="s", tools=[], messages=[{"role": "user", "content": "hi"}])
    assert led.summary()["input_tokens"] == 1000 and led.summary()["spent_usd"] == pytest.approx(0.0045)
    with pytest.raises(BudgetExceeded):
        c.messages.create(model="m", max_tokens=4096, system="s", tools=[], messages=[{"role": "user", "content": "hi"}])
    assert len(inner.calls) == 1  # the refused call never reached the API


# ---------------------------------------------------------------- v2 (after the first live run): which place a query is about
def test_cross_street_from_the_verbatim_phrase_is_allowed():
    assert M.query_is_this_place("Setters Rd & Drakes Branch Rd, Nashville, TN", "Setters Road",
                                 "damage on Setters Road just north of Drakes Branch Road")
    assert not M.query_is_this_place("Setters Rd & Drakes Branch Rd, Nashville, TN", "Setters Road", "damage on Setters Road")


def test_a_query_without_any_word_of_the_place_is_rejected_even_if_the_phrase_has_it():
    phrase = "EF-2 damage to homes in the Lockeland Springs and Barclay Drive neighborhoods"
    assert not M.query_is_this_place("Lockeland Springs, Nashville, TN", "Barclay Drive", phrase)
    assert M.query_is_this_place("Lockeland Springs, Nashville, TN", "Lockeland Springs", phrase)


def test_house_number_must_be_in_the_place_itself():
    assert M.query_is_this_place("133 Queens Lane, Nashville, TN", "133 Queens Lane", "a home at 133 Queens Lane")
    assert not M.query_is_this_place("133 Queens Lane, Nashville, TN", "Queens Lane", "the carport of a home was destroyed on Queens Lane")


def test_borrowed_house_number_is_rejected_in_the_loop():
    text = "The worst damage was to a home at 133 Queens Lane. Also the carport of a home was destroyed on Queens Lane."
    tor = dict(TOR, narrative=text)
    q = "133 Queens Lane, Nashville, TN"
    hit = dict(matched="133 QUEENS LN, NASHVILLE, TN, 37218", lat=ON_TRACK[0], lon=ON_TRACK[1], county="Davidson County", state="TN")
    geo = FakeGeo(census={q: [hit]})

    def final(msgs):
        c = last_candidates(msgs)[0]
        return resp(tool("submit_verdict", submit(clues=["133 Queens Lane", "Queens Lane"], candidate_id=c["candidate_id"], lat=c["lat"], lon=c["lon"]), "t2"))
    client = FakeClient([resp(tool("census_geocode", {"query": q}, "t1")), final])
    rec = M.geocode_rec(grp(tor), "TN", dict(place="Queens Lane", phrase="the carport of a home was destroyed on Queens Lane"))
    out = M.DamageGeocoder(client, geo).run(rec)
    assert out["placed"] is None and out["audit"]["rejected"] == "query_not_this_place"


# ---------------------------------------------------------------- round 2 (Claudio, Oct 8, 2026): lone streets, landmarks, episode track
def _street(name, *pts, rttyp="M"):
    """A TIGER road feature through the given (lat, lon) points."""
    return dict(name=name, mtfcc="S1400", rttyp=rttyp, paths=[[[lon, lat] for lat, lon in pts]])


def _street_run(tiger, place, phrase, query, clues, county_map=None, group=None):
    geo = FakeGeo(tiger=tiger, county=county_map or {})

    def final(msgs):
        cands = last_candidates(msgs)
        if not cands:
            return resp(tool("submit_verdict", submit(verdict="unknown", clues=clues), "t2"))
        c = cands[0]
        return resp(tool("submit_verdict", submit(clues=clues, candidate_id=c["candidate_id"], lat=c["lat"], lon=c["lon"]), "t2"))
    client = FakeClient([resp(tool("street_on_track", {"query": query}, "t1")), final])
    out = M.DamageGeocoder(client, geo).run(M.geocode_rec(group or grp(TOR), "TN", dict(place=place, phrase=phrase)))
    return out, client


def test_lone_street_crossing_the_track_is_pinned_where_it_crosses():
    # a north-south Barclay Dr crossing the (west-east) track at lon -86.7480
    road = _street("Barclay Dr", (36.150, -86.7480), (36.200, -86.7480))
    lat_x = 36.1717 + (36.1767 - 36.1717) * (-86.7480 + 86.9562) / (-86.5717 + 86.9562)
    county = {(round(lat_x, 4), -86.748): "Davidson County"}
    out, client = _street_run({"BARCLAY": [road]}, "Barclay Drive", "Lockeland Springs and Barclay Drive neighborhoods",
                              "Barclay Drive, Nashville, TN", ["Barclay Drive"], county)
    assert out["detective"]["matchType"] == "street", out["audit"]
    assert out["placed"][0] == pytest.approx(lat_x, abs=1e-4) and out["placed"][1] == pytest.approx(-86.7480, abs=1e-6)
    assert out["audit"]["kmFromTrack"] < 0.01 and out["audit"]["segmentId"] == "SE-882999"
    assert "street_on_track" in {t["name"] for t in client.calls[0]["tools"]}


def test_lone_street_too_far_from_the_track_is_rejected():
    # Barclay Dr exists, but its nearest point is ~5 km south of the track
    road = _street("Barclay Dr", (36.110, -86.760), (36.120, -86.740))
    out, client = _street_run({"BARCLAY": [road]}, "Barclay Drive", "Lockeland Springs and Barclay Drive neighborhoods",
                              "Barclay Drive, Nashville, TN", ["Barclay Drive"], {(36.12, -86.74): "Davidson County"})
    seen = last_candidates(client.calls[1]["messages"])[0]
    assert seen["matchType"] == "not_acceptable" and seen["kmFromTrack"] > 4
    assert out["placed"] is None and out["audit"]["rejected"] == "match_type_not_allowed"


def test_lone_street_must_be_the_same_street_name():
    # only "Barclay Ct" and "Barclay Hills Dr" are near the track: neither is Barclay Drive
    roads = [_street("Barclay Ct", (36.150, -86.7480), (36.200, -86.7480)), _street("Barclay Hills Dr", (36.150, -86.70), (36.200, -86.70))]
    out, client = _street_run({"BARCLAY": roads}, "Barclay Drive", "Barclay Drive neighborhoods", "Barclay Drive, Nashville, TN", ["Barclay Drive"])
    assert last_candidates(client.calls[1]["messages"]) == [] and out["placed"] is None
    assert M.street_name_matches("Barclay Drive", "Barclay Dr") and not M.street_name_matches("Barclay Drive", "Barclay Ct")
    assert M.street_name_matches("I-40", "I- 40", "I") and not M.street_name_matches("I-40", "I- 440", "I")
    assert not M.street_name_matches("I-40", "State Rte 40", "S") and M.street_name_matches("Highway 281", "US Hwy 281", "U")
    assert M.street_name_matches("E. Commerce St", "E Commerce St") and not M.street_name_matches("E. Commerce St", "W Commerce St")


def test_lone_street_query_with_a_cross_street_or_house_number_is_refused_by_the_tool():
    out, client = _street_run({}, "Barclay Drive", "Barclay Drive neighborhoods", "100 Barclay Drive, Nashville, TN", ["Barclay Drive"])
    assert "error" in json.loads(client.calls[1]["messages"][2]["content"][0]["content"]) and out["placed"] is None


def _nom(name, cls, typ, lat, lon, county="Davidson County", addresstype=None):
    return {"name": name, "display_name": f"{name}, Nashville, {county}, Tennessee", "lat": str(lat), "lon": str(lon),
            "category": cls, "type": typ, "addresstype": addresstype or typ, "address": {"county": county, "ISO3166-2-lvl4": "US-TN"}}


def test_landmark_whose_name_matches_the_text_is_placed():
    hit = _nom("John C. Tune Airport", "aeroway", "aerodrome", ON_TRACK[0], ON_TRACK[1])
    out, _ = pin("John C. Tune Airport", "John C. Tune Airport area, causing strong EF-2 damage to numerous planes",
                 "John C. Tune Airport, Nashville, TN", hit, ["John C. Tune Airport"], tool_name="nominatim_search")
    assert out["placed"] == [ON_TRACK[0], ON_TRACK[1]] and out["detective"]["matchType"] == "landmark"


def test_landmark_name_mismatch_is_rejected():
    # the place is "Tennessee State Prison"; Nominatim offers a different facility on the track
    text = TEXT + " The Tennessee State Prison sustained roof damage."
    tor = dict(TOR, narrative=text)
    hit = _nom("Tennessee Prison for Women", "amenity", "prison", ON_TRACK[0], ON_TRACK[1])
    q = "Tennessee State Prison, Nashville, TN"
    geo = FakeGeo(nominatim={q: [hit]})

    def final(msgs):
        c = last_candidates(msgs)[0]
        assert c["matchType"] == "not_acceptable"
        return resp(tool("submit_verdict", submit(clues=["Tennessee State Prison"], candidate_id=c["candidate_id"], lat=c["lat"], lon=c["lon"]), "t2"))
    client = FakeClient([resp(tool("nominatim_search", {"query": q}, "t1")), final])
    out = M.DamageGeocoder(client, geo).run(M.geocode_rec(grp(tor), "TN", dict(place="Tennessee State Prison", phrase="The Tennessee State Prison sustained roof damage")))
    assert out["placed"] is None and out["audit"]["rejected"] == "match_type_not_allowed"
    # the name rule itself
    assert not M.landmark_name_ok("Tennessee Prison for Women", "Tennessee State Prison", text)
    assert not M.landmark_name_ok("Five Points Pizza", "Five Points", text)
    assert M.landmark_name_ok("Fort Sam Houston", "Ft. Sam Houston", "damage at Ft. Sam Houston")
    # a named area whose name is in the text but is not this place is refused too
    assert not M.landmark_name_ok("Lockeland Springs", "Barclay Drive", text)


def test_landmark_off_track_is_rejected():
    hit = _nom("John C. Tune Airport", "aeroway", "aerodrome", *OFF_TRACK)
    out, _ = pin("John C. Tune Airport", "John C. Tune Airport area, causing strong EF-2 damage to numerous planes",
                 "John C. Tune Airport, Nashville, TN", hit, ["John C. Tune Airport"], tool_name="nominatim_search")
    assert out["placed"] is None and out["audit"]["rejected"] == "off_track"


# Davidson -> Wilson segments of the Mar 3, 2020 EF3 (real ids and end points); the narratives differ by one " C." in
# NCEI's data, so they are linked by TOR_OTHER_CZ_NAME + end point. The Putnam EF4 is the same episode, another tornado.
DAV = dict(episode=146901, county="Davidson", other_cz="Wilson", begin=[36.1717, -86.9562], end=[36.1767, -86.5717], narrative=TEXT)
WIL = dict(episode=146901, county="Wilson", other_cz="Smith", begin=[36.1767, -86.5717], end=[36.192, -86.0981], narrative=TEXT.replace(" C.", ""))
PUT = dict(episode=146901, county="Putnam", other_cz=None, begin=[36.1715, -85.6628], end=[36.1709, -85.5135], narrative="An historic, violent EF-4 tornado ...")
INDEX = dict(state="TN", tornadoes=[dict(TOR), dict(TOR, id="SE-883007", begin=WIL["begin"], end=WIL["end"], start="2020-03-03T00:54:00-06:00"),
                                     dict(TOR, id="SE-883016", begin=PUT["begin"], end=PUT["end"], narrative=PUT["narrative"], start="2020-03-03T01:48:00-06:00")])
META = {"SE-882999": DAV, "SE-883007": WIL, "SE-883016": PUT}


def test_episode_track_dedupes_county_rows_of_one_tornado():
    rows = INDEX["tornadoes"]
    groups = M.tornado_groups(rows, INDEX, META)
    assert [g["id"] for g in groups] == ["SE-882999", "SE-883016"]  # Davidson + Wilson rows -> one tornado, extracted once
    g = groups[0]
    assert g["selected"] == ["SE-882999", "SE-883007"] and [s["id"] for s in g["segments"]] == ["SE-882999", "SE-883007"]
    assert g["counties"] == ["Davidson", "Wilson"]
    assert [s["id"] for s in groups[1]["segments"]] == ["SE-883016"]  # same episode, different tornado: not merged
    # without raw Storm Events facts a row is its own tornado
    assert [g["id"] for g in M.tornado_groups(rows[:1], INDEX, {})] == ["SE-882999"]


def test_place_on_another_county_segment_is_tested_against_the_full_track():
    # Mount Juliet area: on the Wilson segment, ~25 km east of the Davidson segment's end
    mj = (36.1850, -86.3500)
    hit = dict(matched="CATALPA DR & DOGWOOD DR, MOUNT JULIET, TN, 37122", lat=mj[0], lon=mj[1], county="Wilson County", state="TN")
    q = "Catalpa Drive & Dogwood Drive, Mount Juliet, TN"

    def run(group):
        geo = FakeGeo(census={q: [hit]})

        def final(msgs):
            c = last_candidates(msgs)[0]
            return resp(tool("submit_verdict", submit(clues=["Catalpa Drive at Dogwood Drive"], candidate_id=c["candidate_id"], lat=c["lat"], lon=c["lon"]), "t2"))
        client = FakeClient([resp(tool("census_geocode", {"query": q}, "t1")), final])
        return M.DamageGeocoder(client, geo).run(M.geocode_rec(group, "TN", dict(place="Catalpa Drive at Dogwood Drive", phrase="killed on Catalpa Drive at Dogwood Drive")))
    full = M.tornado_groups(INDEX["tornadoes"][:2], INDEX, META)[0]
    out = run(full)
    assert out["placed"] == [mj[0], mj[1]] and out["audit"]["segmentId"] == "SE-883007"  # attributed to the Wilson row
    out = run(grp(TOR))  # the Davidson row alone: wrong county and far off its segment
    assert out["placed"] is None and out["audit"]["rejected"] == "out_of_county"


def test_nearest_point_on_street_to_a_multi_segment_track():
    segs = [dict(id="a", begin=[36.0, -86.0], end=[36.0, -85.9]), dict(id="b", begin=[36.0, -85.9], end=[36.1, -85.8])]
    lat, lon, km = M.nearest_on_street([[[-85.95, 36.05], [-85.95, 36.02]]], segs)  # a street ending 0.02 deg north of segment a
    assert (lat, lon) == (pytest.approx(36.02, abs=1e-6), pytest.approx(-85.95, abs=1e-6)) and km == pytest.approx(2.22, abs=0.02)
    assert M.km_to_track(36.05, -85.85, segs)[1] == "b"


def test_street_that_meets_the_track_in_two_separate_places_is_refused():
    # a ring road crossing the (west-east) track at lon -86.87 and again at -86.69, 16 km apart: "nearest" is arbitrary
    ring = [_street("Briley Pkwy", (36.150, -86.87), (36.200, -86.87)), _street("Briley Pkwy", (36.150, -86.69), (36.200, -86.69))]
    out, client = _street_run({"BRILEY": ring}, "Briley Parkway", "damage to numerous planes from Cockrill Bend Way to Briley Parkway",
                              "Briley Parkway, Nashville, TN", ["Briley Parkway"])
    res = json.loads(client.calls[1]["messages"][2]["content"][0]["content"])
    assert res["candidates"][0]["matchType"] == "not_acceptable" and "2 separate places" in res["note"]
    assert out["placed"] is None
    # one crossing, or a street running along the track, is a single approach
    segs = M.geocode_rec(grp(TOR), "TN", dict(place="x", phrase="x"))["segments"]
    assert len(M.street_approaches(ring[0]["paths"], segs, 0.0)) == 1
    along = _street("Lebanon Pike", (36.1745, -86.80), (36.1760, -86.70))  # ~5 km parallel to the track, <0.2 km off
    assert len(M.street_approaches(along["paths"], segs, 0.1)) == 1


def test_numbered_highway_query_is_about_the_place():
    # round-2 live run: "Highway 12" had no non-number word, so every query for it was refused
    assert M.query_is_this_place("Highway 12, Nashville, TN", "Highway 12", "crossed Highway 12")
    assert M.query_is_this_place("I-40", "I-40", "dozens of homes between I-40 and Buchanan Street")
    assert not M.query_is_this_place("Highway 109", "Highway 12", "crossed Highway 12")
    assert not M.query_is_this_place("12 Oaks Dr", "Highway 12", "crossed Highway 12")  # 12 as a house number is not the route
