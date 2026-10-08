import os
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def text(t):
    return SimpleNamespace(type="text", text=t)


def tool(name, inp, id_):
    return SimpleNamespace(type="tool_use", name=name, input=inp, id=id_)


def resp(*blocks, stop="tool_use"):
    return SimpleNamespace(content=list(blocks), stop_reason=stop, usage=SimpleNamespace(input_tokens=1000, output_tokens=100))


class FakeClient:
    """Scripted Anthropic client: each messages.create() returns the next scripted response.
    A script entry may be a callable(messages) -> response, to read earlier tool results."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []
        self.messages = self

    def create(self, **kw):
        self.calls.append(kw)
        if not self.script:
            raise AssertionError("FakeClient ran out of scripted responses")
        nxt = self.script.pop(0)
        return nxt(kw["messages"]) if callable(nxt) else nxt


class FakeGeo:
    """No network. census/nominatim answers keyed by exact query; unknown queries return []."""

    def __init__(self, census=None, nominatim=None, county=None, tiger=None):
        self.census_map, self.nom_map, self.county_map = census or {}, nominatim or {}, county or {}
        self.tiger_map = tiger or {}  # {"BARCLAY": [{name, mtfcc, rttyp, paths}]}, keyed by the search word
        self.census_calls, self.nom_calls, self.tiger_calls = [], [], []

    def census(self, q):
        self.census_calls.append(q)
        return self.census_map.get(q, [])

    def nominatim(self, q, limit=5):
        self.nom_calls.append(q)
        return self.nom_map.get(q, [])

    def tiger_roads(self, word, bbox):
        self.tiger_calls.append((word, bbox))
        return self.tiger_map.get(word.upper(), [])

    def county_at(self, lat, lon):
        return self.county_map.get((round(lat, 4), round(lon, 4)), "")


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    import requests

    def boom(*a, **k):
        raise AssertionError("tests must not hit the network")
    monkeypatch.setattr(requests, "get", boom)
    monkeypatch.setattr(requests.Session, "request", boom)
