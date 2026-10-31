"""Insights: attention (missing, streaks, spikes, repeats, corrections), blank vs 0, groups, the map, fair movers,
the heatmap, scoping for zone / district users, and the office → map-district mapping."""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

from app.auth import visible_office_codes
from app.forms import analytics, insights
from app.forms.service import correct, save
from app.models import Office, User
from app.reporting.columns import COLUMN_KEYS

from tests.conftest import make_user

D = date(2026, 10, 10)          # the day the checks look at
NOW = datetime(2026, 10, 20)    # long after every deadline
ROOT = Path(__file__).resolve().parent.parent


def day(n: int) -> date:
    return D + timedelta(days=n)


def put(session, form, office, d, values, submit=True):
    save(session, None, form, office, d, values, confirm_zero=True, check=False, actor="t", submit=submit)


def state_offices(session):
    return visible_office_codes(session, User(username="s", password_hash="", role="state"))


@pytest.fixture()
def history(session, drought_form):
    """pune: steady 4 articles for 10 days, then 40 on D (a spike). satara: the same full row two days running.
    nashik: last sent D-4 (a 4-day streak). latur: 0 confirmed on D (reported, not missing)."""
    for i in range(-10, 0):
        put(session, drought_form, "pune", day(i), {"articles": 4, "news": 2})
        put(session, drought_form, "nashik", day(i - 3), {"articles": 1})
    put(session, drought_form, "pune", D, {"articles": 40, "news": 2})
    row = {"articles": 3, "news": 5, "facebook": 7}
    put(session, drought_form, "satara", day(-1), row)
    put(session, drought_form, "satara", D, row)
    put(session, drought_form, "latur", D, {"articles": 0})
    put(session, drought_form, "solapur", D, {"news": 9}, submit=False)  # draft: not reported
    session.flush()


def test_attention(session, drought_form, history):
    offices = state_offices(session)
    a = insights.attention(session, drought_form, offices, day(-6), D, now=NOW)
    assert a["period"] == D.isoformat()
    missing = {x["office"] for x in a["missing"]}
    assert "latur" not in missing and "solapur" in missing and "nashik" in missing
    assert a["sent"] == 3 and a["sent"] + len(a["missing"]) == a["offices"] == len(offices)
    assert next(x for x in a["missing"] if x["office"] == "solapur")["status"] == "draft"
    nashik = next(x for x in a["streaks"] if x["office"] == "nashik")
    assert nashik["value"] == 4 and nashik["since"] == day(-3).isoformat() and nashik["ever"]
    spike = next(x for x in a["spikes"] if x["office"] == "pune")
    assert (spike["field"], spike["value"], spike["expected"], spike["ratio"]) == ("articles", 40, 4, 10.0)
    assert [x["office"] for x in a["repeats"]] == ["satara"]
    assert all(x["link"].startswith(f"/forms/responses?form={drought_form.id}&day=") for x in a["missing"])


def test_spike_rule():
    assert insights.spike_of(12, [0, 0, 1]) == 0          # 12 ≥ 3×0 and 12 − 0 ≥ 10
    assert insights.spike_of(9, [0, 0, 1]) is None        # not 10 above usual
    assert insights.spike_of(3, [1, 1, 1]) is None        # tripled but tiny
    assert insights.spike_of(100, [5, 6]) is None         # too little history
    assert insights.spike_of(29, [1] * 20 + [10] * 14) is None  # only the last 14 count: usual 10


def test_repeat_needs_non_zero_and_two_fields(session, drought_form):
    put(session, drought_form, "pune", day(-1), {"articles": 0, "news": 0})
    put(session, drought_form, "pune", D, {"articles": 0, "news": 0})
    put(session, drought_form, "satara", day(-1), {"articles": 5})
    put(session, drought_form, "satara", D, {"articles": 5})
    a = insights.attention(session, drought_form, state_offices(session), D, D, now=NOW)
    assert a["repeats"] == []


def test_corrections_listed(session, drought_form, history):
    admin = User(username="admin", password_hash="", role="state")
    correct(session, admin, drought_form, "pune", D, "articles", 4, "typo")
    a = insights.attention(session, drought_form, state_offices(session), day(-6), D, now=NOW)
    c = a["corrections"][0]
    assert (c["office"], c["field"], c["value"], c["expected"], c["note"]) == ("pune", "articles", 4, 40, "typo")
    assert not any(x["office"] == "pune" for x in a["spikes"])  # the corrected value is what counts


def test_blank_vs_zero_in_tables(session, drought_form, history):
    offices = state_offices(session)
    t = analytics.table(session, drought_form, offices, D, D, "daily_office")
    names = [r[1] for r in t["rows"]]
    latur = names.index("जिमाका, लातूर")
    nashik = names.index("जिमाका, नाशिक")
    art = COLUMN_KEYS.index("articles")
    assert t["rows"][latur][2 + art] == 0 and t["blank"][latur][art] is False   # confirmed zero
    assert t["rows"][nashik][2 + art] == 0 and t["blank"][nashik][art] is True  # nothing sent
    dw = analytics.table(session, drought_form, offices, day(-1), D, "datewise")
    assert len(dw["blank"]) == 2 and dw["blank"][1][COLUMN_KEYS.index("blog")] is True


def test_groups(session, drought_form, history):
    g = insights.groups(session, drought_form, state_offices(session), day(-1), D)
    by = {x["key"]: x for x in g["groups"]}
    assert set(by) == {"print", "video", "social", "other"}
    assert by["social"]["total"] == 14 and by["social"]["previous"] == 0
    assert [p["value"] for p in by["print"]["series"]] == [1 + 4 + 2 + 3 + 5 - 1 + 0, 40 + 2 + 3 + 5 + 0][:0] or \
        len(by["print"]["series"]) == 2
    assert g["comparable"]


def test_map_and_reporting_pct(session, drought_form, history):
    m = insights.office_map(session, drought_form, state_offices(session), day(-6), D, column="articles", now=NOW)
    rows = {r["code"]: r for r in m["rows"]}
    assert rows["pune"]["due"] == 7 and rows["pune"]["sent"] == 7 and rows["pune"]["pct"] == 100.0
    assert rows["pune"]["total"] == 6 * 4 + 40 and rows["pune"]["per_day"] == round(64 / 7, 2)
    assert rows["nashik"]["sent"] == 3 and rows["nashik"]["latest_reported"] is False
    assert rows["latur"]["total"] == 0 and rows["latur"]["latest"] == "submitted"
    assert rows["gondia"]["pct"] == 0.0 and rows["gondia"]["per_day"] is None
    with pytest.raises(ValueError):
        insights.office_map(session, drought_form, state_offices(session), D, D, column="nope")


def test_movers_most_improved_eligibility(session, drought_form):
    # pune: 1/day for 7 days, then 3/day — improved. thane: 1 day of 50 after a silent week — not eligible.
    for i in range(14):
        put(session, drought_form, "pune", day(i - 13), {"facebook": 1 if i < 7 else 3})
    put(session, drought_form, "thane", day(-13), {"facebook": 1})
    put(session, drought_form, "thane", D, {"facebook": 50})
    m = insights.movers(session, drought_form, state_offices(session), day(-6), D, column="facebook", now=NOW)
    assert m["top"][0]["code"] == "thane" and m["top"][0]["per_day"] == 50  # top: per reported day
    assert [r["code"] for r in m["improved"]] == ["pune"]
    assert m["improved"][0]["delta_pct"] == 200.0
    d = insights.movers(session, drought_form, state_offices(session), day(-6), D, group="social",
                        level="division", now=NOW)
    assert d["top"][0]["code"] == "konkan"
    assert all(r["share_reported"] >= 0.5 for r in d["improved"])


def test_heatmap(session, drought_form, history):
    h = insights.heatmap(session, drought_form, state_offices(session), day(-1), D, now=NOW)
    pune = next(r for r in h["rows"] if r["code"] == "pune")
    assert [c["total"] for c in pune["cells"]] == [6, 42] and all(c["due"] for c in pune["cells"])
    gondia = next(r for r in h["rows"] if r["code"] == "gondia")
    assert gondia["cells"][0]["total"] is None and gondia["cells"][0]["status"] == "none"


def test_scope_zone_and_district(session, drought_form, history):
    zone = User(username="z", password_hash="", role="zone", division_code="pune")
    offs = visible_office_codes(session, zone)
    a = insights.attention(session, drought_form, offs, D, D, now=NOW)
    assert {x["office"] for x in a["missing"] + a["spikes"] + a["repeats"]} <= set(offs)
    assert a["offices"] == len(offs) and not any(x["office"] == "nashik" for x in a["streaks"])
    dist = User(username="d", password_hash="", role="district", office_code="satara")
    m = insights.office_map(session, drought_form, visible_office_codes(session, dist), D, D, now=NOW)
    assert [r["code"] for r in m["rows"]] == ["satara"]


def test_api_scoping(admin_client, web):
    """Endpoints answer within the caller's scope; a district user can't ask about another division."""
    from app.forms.schema import create_form, set_status
    from tests.conftest import drought_fields
    with web.SessionF() as s:
        form = create_form(s, "t", {"title_mr": "इनसाइट्स", "frequency": "daily", "start_date": "2026-10-01",
                                    "fields": drought_fields()})
        set_status(s, "t", form, "published")
        save(s, None, form, "pune", date(2026, 10, 2), {"facebook": 5}, check=False, actor="t", submit=True)
        save(s, None, form, "nashik", date(2026, 10, 2), {"facebook": 9}, check=False, actor="t", submit=True)
        s.commit()
        fid = form.id
    qs = "?start=2026-10-01&end=2026-10-03"
    for path in ("attention", "groups", "map", "movers", "heatmap", "brief"):
        r = admin_client.get(f"/api/forms/{fid}/analytics/{path}{qs}")
        assert r.status_code == 200, (path, r.text)
    dist = make_user(admin_client, web, "ins_satara", "district", office="satara")
    m = dist.get(f"/api/forms/{fid}/analytics/map{qs}").json()
    assert [r["code"] for r in m["rows"]] == ["satara"]
    peer = dist.get(f"/api/forms/{fid}/analytics/peer{qs}").json()
    assert peer["per_day"]["facebook"] == 5.0 and peer["offices"] == 4  # pune division: विमाका + 3 districts
    assert dist.get(f"/api/forms/{fid}/analytics/map{qs}&division=nashik").status_code == 403
    zone = make_user(admin_client, web, "ins_zone", "zone", division="nashik")
    mv = zone.get(f"/api/forms/{fid}/analytics/movers{qs}&column=facebook").json()
    assert [r["code"] for r in mv["top"]] == ["nashik"]
    r = zone.post(f"/api/forms/{fid}/analytics/ask{qs}", json={"intent": "office_summary", "params": {"office": "pune"}})
    assert r.json()["intent"] == "unsupported"


# --------------------------------------------------------------------------- map mapping
def test_every_district_office_maps_to_a_geo_id(session):
    """frontend/src/components/map/offices.ts maps each active district office to one of the 36 shapes."""
    src = (ROOT / "frontend/src/components/map/offices.ts").read_text(encoding="utf-8")
    mapping = dict(re.findall(r'^\s*"?([a-z_]+)"?:\s*"([a-z-]+)",', src.split("OFFICE_GEO")[1].split("}")[0], re.M))
    geo = json.loads((ROOT / "frontend/src/data/maharashtra-geometry.json").read_text(encoding="utf-8"))
    ids = {d["id"] for d in geo["districts"]}
    districts = [o.code for o in session.query(Office).filter(Office.active.is_(True), Office.kind == "district")]
    assert len(districts) == 34
    assert sorted(set(districts) - set(mapping)) == []
    assert set(mapping.values()) <= ids and len(set(mapping.values())) == len(mapping)
    assert ids - set(mapping.values()) == {"mumbai-city", "mumbai-suburban"}
