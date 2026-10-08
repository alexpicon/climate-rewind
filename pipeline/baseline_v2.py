"""Baseline v2 (no AI), ported from research/memoria-ai-spike/scripts/{regex_baseline,harness,baseline_v2}.py.

Logic is unchanged (scoring_v2.md): round-1 regex + one landmark pattern; Census for intersections/addresses with the
name-consistency check; Nominatim for street/landmark mentions ('mention, town, County County, ST', then without town),
first result inside the county; fixed tiers intersection > address > mention+town > mention alone.
Refactored only: geocoder calls go through an injected client (geo.Geo or a test fake), no module-level paths.
"""
from __future__ import annotations

import re

# ---- regex_baseline.py (unchanged patterns)
SUF = r"(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Highway|Hwy|Parkway|Pkwy|Court|Ct|Circle|Cir|Trail|Trl|Way|Place|Pl|Pike|Freeway|Fwy|Terrace|Ter)\b\.?"
ROUTE = r"(?:(?:US|U\.S\.|State|Missouri|North Carolina|NC|TX|SR|State Route|Route|Rte|Highway|Hwy|FM|CR|County Road|Interstate|I)[- ]?(?:Highway |Hwy |Route )?-?(?:\d{1,4}[A-Z]?|[A-Z]{1,2})\b)"
NAME = r"(?:(?:[NSEW]\.? |North |South |East |West )?(?:[A-Z0-9][\w'.]*(?: [A-Z0-9][\w'.]*){0,3}) " + SUF + r"|" + ROUTE + ")"
LOOSE = r"(?:" + NAME + r"|[A-Z0-9][\w']*(?: [A-Z][\w']*){0,2})"
PATS = [("intersection", re.compile(r"(" + NAME + r") (?:and|at|&) (" + LOOSE + r")")),
        ("intersection", re.compile(r"(" + LOOSE + r") (?:and|at|&) (" + NAME + r")")),
        ("address", re.compile(r"\b(\d{2,5})(?:-\d{2,5})?(?: block of)? (" + NAME + r")")),
        ("street", re.compile(r"(?:\b(?:on|along|of) (?:the )?)?(" + NAME + r")"))]
CITY = re.compile(r"\bin (?:the city of )?([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b(?! County)")


def rb_extract(t):
    out, seen = [], set()
    for typ, p in PATS:
        for m in p.finditer(t):
            if typ == "intersection":
                q = f"{m.group(1)} & {m.group(2)}"
            elif typ == "address":
                q = f"{m.group(1)} {m.group(2)}"
            else:
                q = m.group(1)
            q = q.strip(" .,;")
            if q.lower() in seen:
                continue
            seen.add(q.lower())
            out.append(dict(text=m.group(0), type=typ, query=q))
    c = CITY.search(t)
    city = c.group(1) if c else None
    for o in out:
        o["city"] = city
    return out


# ---- harness.py (unchanged rules)
ABBR = set('st street rd road ave av avenue blvd boulevard dr drive ln lane hwy highway hy pkwy parkway ct court cir circle trl trail way pl place pike fwy freeway expy expressway ter terrace loop spur us u.s sr state route rte rt fm farm to market cr co county road interstate i ih n s e w ne nw se sw north south east west and at & of the block mt mount saint ft fort rm ranch nc tx tn mo ga az bus business old new frontage service svc'.split())


def tok(s):
    return re.findall(r"[a-z0-9]+", s.lower())


def norm(s):
    return re.sub(r"\s+", " ", s).strip().lower()


def validate(place, narr):
    nt = set(tok(narr)); n = norm(narr); why = []
    if not isinstance(place.get('text'), str) or norm(place['text']) not in n:
        why.append('text_not_substring')
    c = place.get('city')
    if c and norm(c) not in n:
        why.append('city_not_in_narrative')
    q = place.get('query') or ''

    def ok(t):
        if t in nt or t in ABBR or (len(t) == 1 and t.isalpha()):
            return True
        m = re.fullmatch(r'(\d+)(st|nd|rd|th)', t)
        if m:
            return m.group(1) in nt or any(m.group(1) in x for x in nt)
        if t.isdigit():
            return any(t in x for x in nt)
        return False
    bad = [t for t in tok(q) if not ok(t)]
    if bad:
        why.append('query_invented:' + ','.join(bad))
    return why


def qform(q):
    q = re.sub(r"\s+(?:and|at|@|/)\s+", " & ", q.strip()) if re.search(r"\s(?:and|at|&|@|/)\s", q) else q.strip()
    if '&' in q:
        return 'intersection', q
    if re.match(r"\d+\s+\S", q):
        return 'address', q
    return None, q


def sides_ok(q, ma):
    mt = set(tok(ma.split(',')[0]))
    for side in q.split(',')[0].split('&'):
        d = [t for t in tok(side) if t not in ABBR]
        if d and not any(t in mt for t in d):
            return False
    return True


def cty2(s):  # round-2 bug fix: "St. Louis (C)" vs Census "St. Louis city"
    s = s.lower().strip(); s = s.replace('(c)', 'city'); s = re.sub(r'\bsaint\b', 'st', s)
    if s.startswith('city of '):
        s = s[8:] + ' city'
    return re.sub(r'[^a-z]', '', s.replace(' county', ''))


def geocode_place(geo, p, st, county):
    form, q = qform(p.get('query') or '')
    if not form:
        return dict(status='not_sent_by_rule')
    q = re.sub(r",?\s*\b" + st + r"\b\.?\s*$", "", q).rstrip(', ')
    tries = ([f"{q}, {p['city']}, {st}"] if p.get('city') else []) + [f"{q}, {st}"]
    for a in tries:
        res = geo.census(a)
        if res is None:
            return dict(status='api_error', addr=a)
        for x in res:
            ma = x['matched']
            parts = ma.split(',')
            if len(parts) < 2 or parts[-2].strip() != st or cty2(x.get('county', '')) != cty2(county):
                continue
            if form == 'intersection' and ('&' not in ma or not sides_ok(q, ma)):
                continue
            if form == 'address' and not ma.startswith(q.split()[0] + ' '):
                continue
            return dict(status='hit', form=form, addr=a, matched=ma, lat=x['lat'], lon=x['lon'], n_cand=len(res))
    return dict(status='no_match', form=form, addr=tries[-1])


# ---- baseline_v2.py (unchanged tiers)
FEAT = r"(?:Creek|Branch|Bayou|River|Fork|Run|Wash|Draw|Slough|Canal|Lake|Pond|Dam|Bridge|Park|School|Church|Cemetery|Airport|Hospital|Mall|Center|Plaza|Subdivision|Estates|Apartments|Campground)"
LANDMARK = re.compile(r"\b((?:[A-Z][\w'.-]*\s){1,4}" + FEAT + r")\b")


def extract(narr):
    places = rb_extract(narr); seen = {p['query'].lower() for p in places}
    city = places[0]['city'] if places else (CITY.search(narr).group(1) if CITY.search(narr) else None)
    for m in LANDMARK.finditer(narr):
        q = m.group(1).strip(' .,;')
        if q.lower() in seen:
            continue
        seen.add(q.lower()); places.append(dict(text=m.group(0), type='landmark', query=q, city=city))
    return places


def county_q(county):
    return 'City of St. Louis' if '(C)' in county else f'{county} County'


def nom_place(geo, mention, town, st, county):
    q = ', '.join([mention] + ([town] if town else []) + [county_q(county), st])
    res = geo.nominatim(q, limit=10)
    if res is None:
        return None, q, 'api_error'
    for x in res:
        a = x.get('address', {})
        if x.get('addresstype') in ('county', 'state', 'country'):
            continue
        if a.get('ISO3166-2-lvl4') != f'US-{st}':
            continue
        if a.get('county'):
            ok = cty2(a['county']) == cty2(county); how = 'nominatim county field'
        else:
            c = geo.county_at(float(x['lat']), float(x['lon'])); ok = c is not None and cty2(c) == cty2(county); how = 'census coords check'
        if ok:
            return dict(lat=float(x['lat']), lon=float(x['lon']), name=x.get('display_name', ''), how=how), q, 'hit'
    return None, q, 'no_match'


def place_record(geo, t):
    """t: {id, state, county, narrative}. Returns {id, lat, lon, confidence, clues_used, rationale, api_errors}."""
    narr, st, county = t['narrative'], t['state'], t['county']
    places = [p for p in extract(narr) if not validate(p, narr)]
    pos = lambda p: (narr.find(p['text']) if p['text'] in narr else 10 ** 6)
    places.sort(key=pos)
    out = dict(id=t['id'], lat=None, lon=None, confidence=None, clues_used=[], rationale='no placeable mention', api_errors=0)
    cen = []
    for p in places:
        form, _ = qform(p['query'])
        if form:
            cen.append((form, p, geocode_place(geo, p, st, county)))
    out['api_errors'] += sum(1 for _, _, g in cen if g['status'] == 'api_error')
    done = False
    for want in ('intersection', 'address'):
        for form, p, g in cen:
            if form == want and g['status'] == 'hit':
                out.update(lat=g['lat'], lon=g['lon'], confidence='high', clues_used=[p['query']],
                           rationale=f"tier {want} (Census): '{g['addr']}' -> {g['matched']}"); done = True; break
        if done:
            break
    noms = [p for p in places if not qform(p['query'])[0]]
    for tier in ('town', 'alone'):
        if done:
            break
        for p in noms:
            town = p.get('city') if tier == 'town' else None
            if tier == 'town' and not town:
                continue
            hit, q, status = nom_place(geo, p['query'], town, st, county)
            out['api_errors'] += status == 'api_error'
            if hit:
                out.update(lat=hit['lat'], lon=hit['lon'], confidence='medium' if tier == 'town' else 'low',
                           clues_used=[p['query']] + ([town] if town else []),
                           rationale=f"tier {p['type']}+{tier} (Nominatim, {hit['how']}): '{q}' -> {hit['name']}"); done = True; break
    return out
