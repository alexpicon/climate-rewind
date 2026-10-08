import json

import pytest

import baseline_v2 as B2
import eval_detective as E
from conftest import FakeClient, FakeGeo, resp, tool


def test_mcnemar_exact():
    assert E.mcnemar_exact(0, 0) == 1.0
    assert E.mcnemar_exact(10, 0) == pytest.approx(2 / 1024)
    assert E.mcnemar_exact(5, 5) == 1.0


@pytest.mark.parametrize("dW,dR,p,Wd,want", [
    (28, 3, 0.0001, 0.08, "FEWER WRONG PINS (supported)"),
    (28, -12, 0.0001, 0.08, "FEWER WRONG PINS, LESS REACH"),
    (10, 3, 0.01, 0.20, "NOT SUPPORTED"),
    (20, 0, 0.2, 0.10, "NOT SUPPORTED"),
    (-3, 0, 0.5, 0.40, "DETECTIVE WORSE"),
])
def test_decision_rule(dW, dR, p, Wd, want):
    assert E.verdict(dW, dR, p, Wd)["verdict"] == want


def test_score_end_to_end_synthetic(tmp_path):
    truth = {f"A-{i}": dict(id=f"A-{i}", set="A", truth_lat=36.0, truth_lon=-86.0) for i in range(20)}
    far, near = (36.1, -86.0), (36.001, -86.0)  # ~11 km and ~0.1 km
    base = tmp_path / "b.jsonl"
    det = tmp_path / "d.jsonl"
    with open(base, "w") as fb, open(det, "w") as fd:
        for i in range(20):
            pb = far if i < 10 else near                      # baseline: 10 wrong, 10 right
            pd_ = None if i < 10 else near                    # detective: abstains on the 10 the baseline got wrong
            fb.write(json.dumps(dict(id=f"A-{i}", lat=pb[0], lon=pb[1], confidence="high")) + "\n")
            fd.write(json.dumps(dict(id=f"A-{i}", lat=pd_[0] if pd_ else None, lon=pd_[1] if pd_ else None,
                                     confidence="high", rejected=None if pd_ else "model_unknown")) + "\n")
    res = E.score(truth, E.rows_for(str(base), truth), E.rows_for(str(det), truth))
    assert res["baseline"]["ALL"]["wrong5"] == 0.5 and res["detective"]["ALL"]["wrong5"] == 0.0
    assert res["detective"]["ALL"]["abstain"] == 0.5 and res["detective"]["ALL"]["w1"] == 0.5
    assert res["decision"]["verdict"] == "FEWER WRONG PINS (supported)"
    assert res["rejections"] == {"model_unknown": 10}


def test_baseline_v2_tiers_with_fake_geo():
    t = dict(id="A-1", state="TN", county="Davidson",
             narrative="Water covered Edmondson Pike at Blackman Rd in Nashville.")
    geo = FakeGeo(census={"Edmondson Pike & Blackman Rd, Nashville, TN": [dict(
        matched="EDMONDSON PIKE & BLACKMAN RD, NASHVILLE, TN, 37211", lat=36.06, lon=-86.74, county="Davidson County", state="TN")]})
    out = B2.place_record(geo, t)
    assert out["confidence"] == "high" and out["lat"] == 36.06 and "intersection" in out["rationale"]


def test_baseline_v2_nominatim_tier_rejects_other_county():
    t = dict(id="A-2", state="TN", county="Davidson", narrative="Flooding along Mill Creek.")
    geo = FakeGeo(nominatim={"Mill Creek, Davidson County, TN": [
        dict(lat="35.9", lon="-86.8", addresstype="stream", display_name="Mill Creek, Williamson",
             address={"county": "Williamson County", "ISO3166-2-lvl4": "US-TN"})]})
    out = B2.place_record(geo, t)
    assert out["lat"] is None


def test_eval_run_detective_with_mocks(tmp_path, monkeypatch):
    monkeypatch.setattr(E, "EVAL", str(tmp_path))
    (tmp_path / "sample.jsonl").write_text(json.dumps(dict(id="A-9", set="A", state="TN", county="Davidson",
                                                           narrative="Flooding at 95 Wallace Road.")) + "\n")
    geo = FakeGeo(census={"95 Wallace Road, TN": [dict(matched="95 WALLACE RD, NASHVILLE, TN, 37211", lat=36.0841, lon=-86.7231,
                                                       county="Davidson County", state="TN")]})

    def final(msgs):
        c = json.loads(msgs[-1]["content"][0]["content"])["candidates"][0]
        return resp(tool("submit_verdict", dict(verdict="placed", clues=["95 Wallace Road"], candidate_id=c["candidate_id"],
                                                lat=c["lat"], lon=c["lon"], confidence="high", reason="r"), "t2"))
    client = FakeClient([resp(tool("census_geocode", {"query": "95 Wallace Road, TN"}, "t1")), final])
    E.cmd_run("detective", client=client, geo=geo)
    out = [json.loads(l) for l in open(tmp_path / "out_detective.jsonl")]
    assert out[0]["lat"] == 36.0841 and out[0]["verdict"] == "placed" and out[0]["tokens_in"] == 2000
    # the eval hides the NWS town field and never sends truth coordinates
    sent = client.calls[0]["messages"][0]["content"]
    assert "NWS town field: none" in sent


def test_eval_detective_dry_run_without_key(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(E, "EVAL", str(tmp_path))
    (tmp_path / "sample.jsonl").write_text(json.dumps(dict(id="A-9", set="A", state="TN", county="Davidson", narrative="x")) + "\n")
    E.cmd_run("detective", dry_run=True)
    assert "dry run" in capsys.readouterr().out
    with pytest.raises(SystemExit):
        E.cmd_run("detective")


def test_real_sample_is_fresh_and_hides_truth():
    import os
    if not os.path.exists(os.path.join(E.EVAL, "sample.jsonl")):
        pytest.skip("sample not drawn")
    sample = [json.loads(l) for l in open(os.path.join(E.EVAL, "sample.jsonl"))]
    assert len(sample) == 100 and all(set(s) == {"id", "set", "state", "county", "narrative"} for s in sample)
    if os.path.exists(E.SPIKE_TRUTH):
        old = {str(json.loads(l)["event_id"]) for l in open(E.SPIKE_TRUTH)}
        assert not old & {s["id"].split("-", 1)[1] for s in sample}


def test_missing_records_are_missing_not_abstain(tmp_path):
    # 10 records: the detective has output for 6 (3 placed near, 3 left unknown) and none at all for 4.
    truth = {f"A-{i}": dict(id=f"A-{i}", set="A", truth_lat=36.0, truth_lon=-86.0) for i in range(10)}
    near = (36.001, -86.0)
    base = tmp_path / "b.jsonl"
    det = tmp_path / "d.jsonl"
    with open(base, "w") as fb:
        for i in range(10):
            fb.write(json.dumps(dict(id=f"A-{i}", lat=near[0], lon=near[1], confidence="high")) + "\n")
    with open(det, "w") as fd:
        for i in range(6):
            placed = i < 3
            fd.write(json.dumps(dict(id=f"A-{i}", lat=near[0] if placed else None, lon=near[1] if placed else None,
                                     confidence="high", rejected=None if placed else "model_unknown")) + "\n")
    res = E.score(truth, E.rows_for(str(base), truth), E.rows_for(str(det), truth))
    a = res["detective"]["ALL"]
    assert a["placed"] == 0.3 and a["abstain"] == 0.3 and a["missing"] == 4 and a["missing_rate"] == 0.4
    assert a["placed"] + a["abstain"] + a["missing_rate"] == pytest.approx(1.0)
    assert res["baseline"]["ALL"]["missing"] == 0 and res["baseline"]["ALL"]["abstain"] == 0
    assert res["decision"]["complete"] is False and res["decision"]["missing_records"] == 4
    assert "INCOMPLETE" in res["decision"]["warning"]


def test_complete_run_has_no_warning():
    assert E.verdict(28, 3, 0.0001, 0.08)["complete"] is True
    assert "warning" not in E.verdict(28, 3, 0.0001, 0.08)
