import re

import pytest

import common as C
from build_areas import area_code, has_impact, parse_damage


def test_parse_damage():
    assert parse_damage("1.5M") == 1_500_000
    assert parse_damage("10.00K") == 10_000
    assert parse_damage("0.00K") == 0
    assert parse_damage("2B") == 2_000_000_000
    assert parse_damage("1.02B") == 1_020_000_000
    assert parse_damage("250") == 250          # bare dollars (a handful of rows)
    assert parse_damage("") == 0
    assert parse_damage("K") == 0              # suffix with no number
    assert parse_damage(" 3k ") == 3_000
    with pytest.raises(ValueError):
        parse_damage("lots")


def test_area_code_format():
    assert area_code("WA", "Z", "558") == "WAZ558"
    assert area_code("WA", "C", "33") == "WAC033"
    assert area_code("DC", "C", "1") == "DCC001"
    assert re.fullmatch(r"[A-Z]{2}[CZ]\d{3}", area_code("TX", "Z", "7"))
    with pytest.raises(ValueError):
        area_code("FL", "M", "650")  # marine zones are out of scope


def test_bare_and_alaska_time_zones():
    assert C.iso(C.se_time("14-DEC-06 20:00:00", "PST", "WA")) == "2006-12-14T20:00:00-08:00"
    assert C.iso(C.se_time("19-JAN-06 10:00:00", "CST", "IL")) == "2006-01-19T10:00:00-06:00"
    assert C.iso(C.se_time("01-JUL-04 12:00:00", "AST", "AK")) == "2004-07-01T13:00:00-08:00"  # Alaska, not Atlantic
    assert C.iso(C.se_time("01-JUL-15 12:00:00", "HST-10", "HI")) == "2015-07-01T12:00:00-10:00"
    assert C.iso(C.se_time("01-JUL-05 12:00:00", "EST", "IN")) == "2005-07-01T12:00:00-05:00"  # Indiana: no DST pre-2006


def test_prune_predicate():
    base = dict(narrative="", damageUsd=0, deaths=0, injuries=0)
    assert not has_impact(base)
    assert has_impact(dict(base, narrative="Tree down."))
    assert has_impact(dict(base, damageUsd=1000))
    assert has_impact(dict(base, injuries=1))


def test_lsr_states_are_protected():
    from build_areas import build_se_index
    with pytest.raises(SystemExit):
        build_se_index(["TN"], [2015])
