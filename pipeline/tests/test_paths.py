"""Output folders: default is out/, MEMORIA_DATA_DIR redirects index and heat output into the web app's data/ folder."""
import importlib
import os

import common


def test_default_output_is_out(monkeypatch):
    monkeypatch.delenv("MEMORIA_DATA_DIR", raising=False)
    c = importlib.reload(common)
    assert c.INDEX_DIR == os.path.join(c.HERE, "out", "index")
    assert c.HEAT_DIR == os.path.join(c.HERE, "out", "heat")


def test_data_dir_override_redirects_index_and_heat_only(monkeypatch):
    monkeypatch.setenv("MEMORIA_DATA_DIR", "/tmp/memoria-data")
    c = importlib.reload(common)
    assert c.INDEX_DIR == "/tmp/memoria-data/index"
    assert c.HEAT_DIR == "/tmp/memoria-data/heat"
    assert c.DETECTIVE_DIR == os.path.join(c.HERE, "out", "detective")  # detective cache stays local
    monkeypatch.delenv("MEMORIA_DATA_DIR")
    importlib.reload(common)


def test_sibling_project_paths_resolve_from_inside_the_web_repo():
    import eval_detective as E
    import heat_grid as H
    # pipeline/ sits in memoria/, so the prototype and spike folders are two levels up.
    assert H.PROTO_CACHE.endswith(os.path.join("mocks", "assets", "v3.3", "data", "heat_raw.json"))
    assert os.path.dirname(os.path.dirname(common.HERE)) in H.PROTO_CACHE
    assert os.path.dirname(os.path.dirname(common.HERE)) in E.SPIKE_TRUTH
