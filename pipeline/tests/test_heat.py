import json

import heat_grid as H


def test_lattice_matches_prototype_grid():
    pts, b = H.lattice(36.168175, -86.777516, 6.0, 8.5, 0.5)
    assert b["rows"] == 25 and b["cols"] == 35 and len(pts) == 875
    assert (36.0, -87.0) in pts and all((p[0] * 2).is_integer() and (p[1] * 2).is_integer() for p in pts)


def test_summarize_hottest_week_and_by_year():
    days = [f"2012-06-{d:02d}" for d in range(20, 31)]
    vals = [90, 95, 99, 100, 101, 104, 108, 113.1, 109, 100, 98]
    s = H.summarize(dict(daily=dict(time=days, apparent_temperature_max=vals), timezone="America/Chicago", latitude=36.1, longitude=-86.8))
    assert s["hottest"] == {"date": "2012-06-27", "feelsF": 113.1}
    assert s["byYear"] == {"2012": 7}
    assert s["timezone"] == "America/Chicago"


def test_build_offline_with_fake_api(tmp_path, monkeypatch):
    monkeypatch.setattr(H, "HEAT_RAW", str(tmp_path / "raw"))
    monkeypatch.setattr(H, "HEAT_DIR", str(tmp_path / "out"))
    monkeypatch.setattr(H, "PROTO_CACHE", str(tmp_path / "none.json"))
    monkeypatch.setattr(H.time, "sleep", lambda s: None)

    def fake(params, **k):
        if "," not in str(params["latitude"]) and params["start_date"].endswith("01-01"):
            days = ["2020-07-0%d" % d for d in range(1, 10)]
            return dict(timezone="America/Chicago", latitude=30.0, longitude=-99.1,
                        daily=dict(time=days, apparent_temperature_max=[95, 96, 97, 99, 110, 99, 98, 97, 96]))
        lats = str(params["latitude"]).split(",")
        return [dict(latitude=float(a), longitude=-99.0, daily=dict(apparent_temperature_max=[100.0] * 7)) for a in lats]
    monkeypatch.setattr(H, "_get", fake)
    path, out = H.build("kerrville", 30.047, -99.14, half_lat=1.0, half_lon=1.0)
    assert out["days"][0] == "2020-07-02" and out["days"][-1] == "2020-07-08"  # centred on Jul 5
    assert len(out["cells"]) == 25 and out["point"]["worstWeek"]["daily"][3] == {"date": "2020-07-05", "feelsF": 110}
    assert json.load(open(path))["slug"] == "kerrville"
