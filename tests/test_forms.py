"""Report forms: definition and schema lock, periods, per-role access, the submit → return → resubmit cycle,
admin corrections, validation, and the Social Monitoring report reading submitted form values."""
from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.forms import periods as P
from app.forms.schema import FormError, create_form, duplicate_form, set_status, update_form
from app.forms.service import correct, return_, save, submit_
from app.models import AuditLog, Form, User
from app.reporting.aggregate import compute_report
from app.reporting.columns import COLUMN_KEYS
from app.timeutil import today_ist
from tests.conftest import make_user

TODAY = today_ist()
D = TODAY - timedelta(days=2)
ADMIN_U = User(id=None, username="admin_t", password_hash="", role="state")


# --------------------------------------------------------------------------- periods
def _f(freq, start, end=None, deadline_hours=None):
    return Form(slug="x", title_mr="x", frequency=freq, start_date=start, end_date=end, deadline_hours=deadline_hours)


def test_daily_weekly_once_periods():
    s0 = date(2026, 10, 1)
    daily = _f("daily", s0, date(2026, 10, 5))
    assert P.periods(daily, today=date(2026, 10, 3)) == [date(2026, 10, d) for d in (1, 2, 3)]
    assert P.periods(daily, today=date(2026, 12, 1))[-1] == date(2026, 10, 5)
    assert P.periods(daily, date(2026, 10, 2), date(2026, 10, 2), today=date(2026, 12, 1)) == [date(2026, 10, 2)]
    weekly = _f("weekly", s0)
    assert P.periods(weekly, today=date(2026, 10, 15)) == [date(2026, 10, 1), date(2026, 10, 8), date(2026, 10, 15)]
    assert P.periods(weekly, date(2026, 10, 9), date(2026, 10, 30), today=date(2026, 10, 30)) == \
        [date(2026, 10, 15), date(2026, 10, 22), date(2026, 10, 29)]
    assert P.period_containing(weekly, date(2026, 10, 10)) == date(2026, 10, 8)
    assert P.period_end(weekly, date(2026, 10, 8)) == date(2026, 10, 14)
    assert not P.is_period_start(weekly, date(2026, 10, 9))
    once = _f("once", s0, date(2026, 10, 31))
    assert P.periods(once, today=date(2026, 9, 30)) == []
    assert P.periods(once, today=date(2026, 10, 2)) == [s0] and P.period_end(once, s0) == date(2026, 10, 31)


def test_deadline_is_hours_after_the_period():
    f = _f("daily", date(2026, 10, 1), deadline_hours=18)
    # 18:00 IST on 2 Oct = 12:30 UTC
    assert P.deadline(f, date(2026, 10, 1)) == datetime(2026, 10, 2, 12, 30)
    assert P.deadline(_f("daily", date(2026, 10, 1)), date(2026, 10, 1)) is None


# --------------------------------------------------------------------------- definition + schema lock
def test_schema_lock(session, drought_form):
    form = drought_form
    save(session, None, form, "pune", D, {"articles": 3}, check=False, actor="t")
    session.commit()  # each rejected update below is rolled back to here
    fields =[{"id": f.id, "key": f.key, "label_mr": f.label_mr, "type": f.type} for f in form.fields]
    with pytest.raises(FormError, match="archive"):
        update_form(session, "t", form, {"fields": fields[1:]})          # delete an answered field
    session.rollback()
    form = session.get(Form, form.id)
    fields = [{"id": f.id, "key": f.key, "label_mr": f.label_mr, "type": f.type} for f in form.fields]
    with pytest.raises(FormError, match="type"):
        update_form(session, "t", form, {"fields": [{**fields[0], "type": "text"}, *fields[1:]]})
    session.rollback()
    form = session.get(Form, form.id)
    fields = [{"id": f.id, "key": f.key, "label_mr": f.label_mr, "type": f.type} for f in form.fields]
    # rename + archive + reorder + add a field and delete an unanswered one: all fine
    upd = [{**fields[0], "label_mr": "लेख (नवे)", "archived": True}, *reversed(fields[2:]),
           {"label_mr": "शेरा", "label_en": "Remarks", "type": "text"}]
    update_form(session, "t", form, {"fields": upd})
    session.flush()
    keys = [f.key for f in form.fields]
    assert keys[0] == "articles" and "news" not in keys and keys[-1] == "remarks" and form.fields[0].archived
    with pytest.raises(FormError, match="frequency"):
        update_form(session, "t", form, {"frequency": "weekly"})


def test_publish_needs_fields_and_recipients_and_duplicate(session, drought_form):
    empty = create_form(session, "t", {"title_mr": "रिकामा", "start_date": "2026-10-01", "recipients": []})
    with pytest.raises(FormError, match="field"):
        set_status(session, "t", empty, "published")
    copy = duplicate_form(session, "t", drought_form)
    assert copy.status == "draft" and copy.campaign_id is None and copy.slug != drought_form.slug
    assert [f.key for f in copy.fields] == list(COLUMN_KEYS) and len(copy.recipients) == 43


# --------------------------------------------------------------------------- web: setup
@pytest.fixture(scope="module")
def test_form(admin_client):
    body = {"title_mr": "चाचणी", "title_en": "Test", "frequency": "daily",
            "start_date": (TODAY - timedelta(days=20)).isoformat(), "deadline_hours": 18,
            "instructions_mr": "रोज भरा", "recipients": ["solapur", "satara"],
            "fields": [{"label_mr": "बैठका", "label_en": "Meetings", "type": "number", "required": True, "max_value": 50},
                       {"label_mr": "प्रकार", "label_en": "Kind", "type": "choice", "options": ["अ", "ब"]},
                       {"label_mr": "पूर्ण?", "label_en": "Done", "type": "yesno"}]}
    r = admin_client.post("/api/forms", json=body)
    assert r.status_code == 200, r.text
    f = r.json()
    assert [x["key"] for x in f["fields"]] == ["meetings", "kind", "done"] and f["status"] == "draft"
    assert admin_client.post(f"/api/forms/{f['id']}/publish").json()["status"] == "published"
    return f


@pytest.fixture(scope="module")
def solapur(web, admin_client):
    return make_user(admin_client, web, "frm_solapur", "district", office="solapur")


@pytest.fixture(scope="module")
def pune(web, admin_client):
    return make_user(admin_client, web, "frm_pune", "district", office="pune")


@pytest.fixture(scope="module")
def zone_pune(web, admin_client):
    return make_user(admin_client, web, "frm_zone_pune", "zone", division="pune")


@pytest.fixture(scope="module")
def zone_nashik(web, admin_client):
    return make_user(admin_client, web, "frm_zone_nashik", "zone", division="nashik")


@pytest.fixture
def entry_open(monkeypatch):
    """Keep past days open to offices, for tests about editing rather than the 11:59 PM cutoff."""
    from datetime import datetime
    from app.forms import service as svc
    monkeypatch.setattr(svc, "entry_closes", lambda form, ps: datetime.max)


def url(form, office, day, action=""):
    return f"/api/forms/{form['id']}/submissions/{office}/{day.isoformat()}" + (f"/{action}" if action else "")


# --------------------------------------------------------------------------- web: access
def test_recipients_see_the_form_others_dont(test_form, solapur, pune, zone_pune, zone_nashik):
    mine = solapur.get("/api/forms/mine").json()
    me = next(x for x in mine if x["id"] == test_form["id"])
    assert me["offices"] == ["solapur"] and me["pending"] >= 1 and me["instructions_mr"] == "रोज भरा"
    assert all(x["id"] != test_form["id"] for x in pune.get("/api/forms/mine").json())
    assert pune.get(f"/api/forms/{test_form['id']}").status_code == 404
    assert zone_nashik.get(f"/api/forms/{test_form['id']}").status_code == 404
    z = next(x for x in zone_pune.get("/api/forms/mine").json() if x["id"] == test_form["id"])
    assert z["offices"] == ["solapur", "satara"]


def test_only_state_defines_forms(solapur, zone_pune, test_form):
    assert solapur.post("/api/forms", json={"title_mr": "x"}).status_code == 403
    assert zone_pune.put(f"/api/forms/{test_form['id']}", json={"title_mr": "x"}).status_code == 403
    assert solapur.post(f"/api/forms/{test_form['id']}/close").status_code == 403


def test_district_writes_only_its_own_office(test_form, solapur, pune, zone_pune, entry_open):
    assert solapur.put(url(test_form, "solapur", D), json={"values": {"meetings": 4}}).status_code == 200
    assert solapur.put(url(test_form, "satara", D), json={"values": {"meetings": 4}}).status_code == 403
    assert pune.put(url(test_form, "pune", D), json={"values": {"meetings": 4}}).status_code == 404
    r = zone_pune.put(url(test_form, "satara", D), json={"values": {"meetings": 1}})
    assert r.status_code == 403
    got = zone_pune.get(url(test_form, "solapur", D)).json()
    assert got["values"]["meetings"] == 4 and got["status"] == "draft" and got["read_only_reason"]
    p = solapur.get(f"/api/forms/{test_form['id']}/periods?office=solapur").json()
    assert len(p["periods"]) == 7 and p["periods"][-1]["period_start"] == TODAY.isoformat()


def test_validation(test_form, solapur, entry_open):
    day = D - timedelta(days=1)
    put = lambda values, **kw: solapur.put(url(test_form, "solapur", day), json={"values": values, **kw})  # noqa: E731
    assert "at most 50" in put({"meetings": 51}).json()["detail"]
    assert put({"meetings": -1}).status_code == 400
    assert put({"meetings": 2.5}).status_code == 400
    assert put({"kind": "क"}).status_code == 400
    assert put({"done": "maybe"}).status_code == 400
    assert put({"bogus": 1}).status_code == 400
    r = put({"meetings": 0})
    assert r.status_code == 400 and "confirm" in r.json()["detail"]
    assert put({"meetings": 0, "kind": "अ"}, confirm_zero=True).status_code == 200
    assert put({"meetings": 0}).status_code == 200  # an already-confirmed zero needs no new confirmation
    # required field missing → can't submit
    r = put({"meetings": None})
    assert r.status_code == 200 and r.json()["values"]["meetings"] is None
    r = solapur.post(url(test_form, "solapur", day, "submit"))
    assert r.status_code == 400 and "required" in r.json()["detail"]
    tomorrow = TODAY + timedelta(days=1)
    assert solapur.put(url(test_form, "solapur", tomorrow), json={"values": {"meetings": 1}}).status_code == 400


def test_submit_return_resubmit(test_form, solapur, admin_client, web, entry_open):
    day = D - timedelta(days=2)
    r = solapur.put(url(test_form, "solapur", day), json={"values": {"meetings": 7, "done": "yes"}, "submit": True})
    assert r.status_code == 200 and r.json()["status"] == "submitted"
    assert r.json()["late"] is True  # submitted after 18:00 the next day
    assert admin_client.post(url(test_form, "solapur", day, "return"), json={"note": ""}).status_code == 400
    r = admin_client.post(url(test_form, "solapur", day, "return"), json={"note": "बैठका तपासा"})
    assert r.json()["status"] == "returned"
    got = solapur.get(url(test_form, "solapur", day)).json()
    assert got["status"] == "returned" and got["review_note"] == "बैठका तपासा" and got["read_only_reason"] is None
    assert any(x["returned"] for x in solapur.get("/api/forms/mine").json() if x["id"] == test_form["id"])
    r = solapur.put(url(test_form, "solapur", day), json={"values": {"meetings": 8}, "submit": True})
    assert r.json()["status"] == "submitted" and r.json()["values"]["meetings"] == 8
    assert admin_client.post(url(test_form, "solapur", day, "accept")).status_code in (404, 405)
    with web.SessionF() as s:
        acts = [a.action for a in s.scalars(select(AuditLog).where(
            AuditLog.entity_id == f"{test_form['id']}:solapur:{day}")).all()]
    assert acts == ["form_submission.save", "form_submission.submit", "form_submission.return",
                    "form_submission.save", "form_submission.submit"]


def test_office_changes_sent_period_and_keeps_history(test_form, solapur, admin_client, entry_open):
    day = D - timedelta(days=5)
    sent = solapur.put(url(test_form, "solapur", day), json={"values": {"meetings": 3, "done": "yes"}, "submit": True}).json()
    assert sent["read_only_reason"] is None and sent["edits"] == []
    # the office changes its own figure: still sent, first send time kept, the change is in the history
    got = solapur.put(url(test_form, "solapur", day), json={"values": {"meetings": 4, "done": "yes"}}).json()
    assert got["status"] == "submitted" and got["values"]["meetings"] == 4 and got["corrections"] == {}
    assert [(e["key"], e["before"], e["after"], e["by"], e["source"]) for e in got["edits"]] == [("meetings", 3, 4, "frm_solapur", "office")]
    got = solapur.put(url(test_form, "solapur", day), json={"values": {"meetings": 6}, "submit": True}).json()
    assert got["submitted_at"] == sent["submitted_at"] and got["late"] == sent["late"]
    # the state office's correction sits in the same history
    got = admin_client.post(url(test_form, "solapur", day, "correct"), json={"key": "meetings", "value": 7}).json()
    assert [(e["before"], e["after"], e["source"]) for e in got["edits"]] == [(3, 4, "office"), (4, 6, "office"), (6, 7, "state")]
    # a sent period can't lose a required field
    r = solapur.put(url(test_form, "solapur", day), json={"values": {"meetings": None}})
    assert r.status_code == 400 and "required" in r.json()["detail"]
    assert solapur.get(url(test_form, "solapur", day)).json()["values"]["meetings"] == 7
    # drafts keep no history
    draft = solapur.put(url(test_form, "solapur", day - timedelta(days=1)), json={"values": {"meetings": 1}}).json()
    assert solapur.put(url(test_form, "solapur", day - timedelta(days=1)), json={"values": {"meetings": 2}}).json()["edits"] == []
    assert draft["status"] == "draft"


def test_admin_correction_is_kept_and_highlighted(test_form, solapur, admin_client, web, entry_open):
    day = D - timedelta(days=3)
    solapur.put(url(test_form, "solapur", day), json={"values": {"meetings": 12}, "submit": True})
    r = admin_client.post(url(test_form, "solapur", day, "correct"),
                          json={"key": "meetings", "value": 21, "note": "आकडे उलटे झाले"})
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["values"]["meetings"] == 21
    assert got["corrections"]["meetings"]["original"] == 12 and got["corrections"]["meetings"]["by"] == "admin"
    resp = admin_client.get(f"/api/forms/{test_form['id']}/responses?start={day}&end={day}").json()
    row = next(x for x in resp["rows"] if x["office"] == "solapur")
    assert row["corrections"]["meetings"]["note"] == "आकडे उलटे झाले"
    assert next(x for x in resp["rows"] if x["office"] == "satara")["status"] == "none"
    # the office can't correct; correcting back to the original removes the highlight
    assert solapur.post(url(test_form, "solapur", day, "correct"),
                        json={"key": "meetings", "value": 1, "note": "x"}).status_code == 403
    r = admin_client.post(url(test_form, "solapur", day, "correct"), json={"key": "meetings", "value": 12, "note": "चूक"})
    assert r.json()["corrections"] == {}
    with web.SessionF() as s:
        rows = s.scalars(select(AuditLog).where(AuditLog.action == "form_value.correct",
                                                AuditLog.entity_id == f"{test_form['id']}:solapur:{day}")).all()
    assert [(a.before, a.after) for a in rows] == [({"meetings": 12}, {"meetings": 21}),
                                                  ({"meetings": 21}, {"meetings": 12})]


def test_edit_history_and_undo(test_form, solapur, admin_client, entry_open):
    day = D - timedelta(days=4)
    solapur.put(url(test_form, "solapur", day), json={"values": {"meetings": 5}, "submit": True})
    edit = lambda v, note="": admin_client.post(url(test_form, "solapur", day, "correct"),  # noqa: E731
                                                json={"key": "meetings", "value": v, "note": note})
    assert edit(5).status_code == 400  # unchanged
    assert edit(6).status_code == 200  # a reason is optional
    got = edit(9, "फोनवर खात्री केली").json()
    assert got["values"]["meetings"] == 9 and got["corrections"]["meetings"]["original"] == 5
    first, second = got["edits"]
    assert (first["before"], first["after"], first["note"]) == (5, 6, "")
    assert (second["before"], second["after"], second["by"]) == (6, 9, "admin")
    # undo the latest edit: back to 6, logged as a new edit that points at it
    got = admin_client.post(url(test_form, "solapur", day, "revert"), json={"edit_id": second["id"]}).json()
    assert got["values"]["meetings"] == 6 and got["edits"][-1]["reverts"] == second["id"]
    # restoring to before the first edit returns the office's value and clears the highlight; history stays
    got = admin_client.post(url(test_form, "solapur", day, "revert"), json={"edit_id": first["id"]}).json()
    assert got["values"]["meetings"] == 5 and got["corrections"] == {} and len(got["edits"]) == 4
    assert admin_client.post(url(test_form, "solapur", day, "revert"), json={"edit_id": 999999}).status_code == 404
    assert solapur.post(url(test_form, "solapur", day, "revert"), json={"edit_id": first["id"]}).status_code == 403


def test_offices_edit_until_1159pm_then_only_the_state_office(test_form, solapur, admin_client):
    day = TODAY - timedelta(days=9)
    # today is open to the office; an earlier day closed at 11:59 PM that night
    assert solapur.put(url(test_form, "solapur", TODAY), json={"values": {"meetings": 2}}).status_code == 200
    r = solapur.put(url(test_form, "solapur", day), json={"values": {"meetings": 2}})
    assert r.status_code == 400 and "11:59 PM" in r.json()["detail"]
    assert "11:59 PM" in solapur.get(url(test_form, "solapur", day)).json()["read_only_reason"]
    # the state office still fills and edits it
    r = admin_client.put(url(test_form, "solapur", day), json={"values": {"meetings": 3, "done": "yes"}, "submit": True})
    assert r.status_code == 200 and r.json()["status"] == "submitted"
    assert admin_client.post(url(test_form, "solapur", day, "correct"), json={"key": "meetings", "value": 4}).status_code == 200
    assert solapur.put(url(test_form, "solapur", day), json={"values": {"meetings": 5}}).status_code == 400
    # returning the day reopens it to the office for that fix
    admin_client.post(url(test_form, "solapur", day, "return"), json={"note": "तपासा"})
    r = solapur.put(url(test_form, "solapur", day), json={"values": {"meetings": 5}, "submit": True})
    assert r.status_code == 200 and r.json()["values"]["meetings"] == 5
    assert solapur.put(url(test_form, "solapur", day), json={"values": {"meetings": 6}}).status_code == 400


def test_entry_closes_at_midnight_ist():
    from datetime import datetime
    f = _f("daily", date(2026, 10, 1))
    assert P.entry_closes(f, date(2026, 10, 5)) == datetime(2026, 10, 5, 18, 30)  # 00:00 IST on the 6th, in UTC
    w = _f("weekly", date(2026, 10, 1))
    assert P.entry_closes(w, date(2026, 10, 1)) == datetime(2026, 10, 7, 18, 30)  # end of the week's last day


def test_compliance_and_closed_form(test_form, solapur, admin_client, zone_pune):
    c = zone_pune.get(f"/api/forms/{test_form['id']}/compliance?start={D - timedelta(days=3)}&end={D}").json()
    assert [r["code"] for r in c["rows"]] == ["solapur", "satara"] and len(c["periods"]) == 4
    satara = c["rows"][1]
    assert all(x["status"] == "none" and x["late"] for x in satara["cells"])
    assert all("satara" in m for m in c["missing"])
    assert admin_client.post(f"/api/forms/{test_form['id']}/close").json()["status"] == "closed"
    r = solapur.put(url(test_form, "solapur", TODAY), json={"values": {"meetings": 1}})
    assert r.status_code == 400 and "closed" in r.json()["detail"]
    assert admin_client.post(f"/api/forms/{test_form['id']}/publish").json()["status"] == "published"


def test_zone_cannot_review(test_form, zone_pune):
    assert zone_pune.post(url(test_form, "solapur", D, "correct"), json={"key": "meetings", "value": 1}).status_code == 403
    r = zone_pune.get(f"/api/forms/{test_form['id']}/responses").json()
    assert r["can_review"] is False


# --------------------------------------------------------------------------- service-level rules
def test_permission_checks_in_service(session, drought_form):
    u = User(username="u", password_hash="x", role="district", office_code="pune")
    with pytest.raises(FormError) as e:
        save(session, u, drought_form, "satara", D, {"articles": 1})
    assert e.value.status == 403
    z = User(username="z", password_hash="x", role="zone", division_code="pune")
    with pytest.raises(FormError):
        save(session, z, drought_form, "pune", D, {"articles": 1})


def test_returned_correction_then_office_change_clears_highlight(session, drought_form):
    admin = ADMIN_U
    sub = save(session, None, drought_form, "pune", D, {"news": 5}, check=False, actor="t", submit=True)
    correct(session, admin, drought_form, "pune", D, "news", 6, "typo")
    return_(session, admin, drought_form, "pune", D, "check again")
    save(session, None, drought_form, "pune", D, {"news": 7}, check=False, actor="pune")
    submit_(session, None, drought_form, sub, check=False)
    row = next(v for v in sub.values if v.field.key == "news")
    assert row.value_num == 7 and row.corrected_at is None and row.original_value_num is None


# --------------------------------------------------------------------------- Social Monitoring report from forms
FULL = {k: i + 1 for i, k in enumerate(COLUMN_KEYS)}


def cell(data, office, col):
    return next(o["cells"][col] for d in data["divisions"] for o in d["offices"] if o["code"] == office)


def test_report_sums_submitted_days_and_flags_missing_days(session, campaign, drought_form):
    d0, d1 = date(2026, 10, 3), date(2026, 10, 5)
    for d in (d0, d1):  # 4 Oct: only articles
        save(session, None, drought_form, "pune", d, FULL, confirm_zero=True, check=False, actor="t", submit=True)
    save(session, None, drought_form, "pune", d0 + timedelta(days=1), {"articles": 10}, check=False, actor="t",
         submit=True)
    save(session, None, drought_form, "satara", d0, {"articles": 99}, check=False, actor="t")  # draft: not counted
    data = compute_report(session, campaign, d0, d1)
    assert data["source"] == "office_entries"
    c = cell(data, "pune", "articles")
    assert c["state"] == "entered" and c["value"] == 1 + 10 + 1 and c["complete"]
    n = cell(data, "pune", "news")
    assert n["value"] == 4 and not n["complete"] and "missing_days" in n["issues"]
    msg = next(i["message"] for i in data["issues"] if i["code"] == "missing_days" and i["column"] == "news")
    assert "2026-10-04" in msg
    assert cell(data, "satara", "articles")["state"] == "missing"
    assert not data["complete"]


def test_social_columns_use_submitted_values_with_collected_cross_check(session, campaign, drought_form):
    save(session, None, drought_form, "mumbai_hq", D, FULL, check=False, actor="t", submit=True)
    data = compute_report(session, campaign, D, D)
    fb = cell(data, "mumbai_hq", "facebook")
    assert fb["state"] == "entered" and fb["value"] == FULL["facebook"] and fb["complete"]
    assert fb["collected"]["value"] == 0 and "mapping_unconfirmed" in fb["collected"]["issues"]
    assert all(i["severity"] == "warning" for i in data["issues"]
               if i["code"] in ("pending_review", "mapping_unconfirmed", "collected_differs"))
