"""JSON API for report forms (अहवाल फॉर्म): the admin defines and publishes forms, offices fill and submit them,
the admin edits submitted values (with undo) or returns a period, and everyone with access sees roll-ups and exports.

Every logged-in user reaches /api/forms (app.auth.OFFICE_PREFIXES); each endpoint scopes data with
app.forms.service (recipients ∩ visible offices) and admin endpoints require the state role."""
from __future__ import annotations

from datetime import date
from typing import Any, Optional
from urllib.parse import quote

from fastapi import Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import current_user, editable_office_codes, require_role
from app.forms import analytics, insights, schema, service
from app.forms.periods import MAX_PERIODS, periods
from app.forms.schema import FormError
from app.models import Form, User
from app.timeutil import today_ist
from app.web.main import app, get_session, settings

state_only = require_role("state")
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _err(exc: FormError):
    raise HTTPException(exc.status, str(exc))


def _form(s: Session, user: User, form_id: int) -> Form:
    try:
        return service.get_form(s, user, form_id)
    except FormError as exc:
        _err(exc)


def _scope(s: Session, user: User, form: Form, division: str = "", office: str = "") -> list[str]:
    try:
        return service.scope(s, user, form, division, office)
    except FormError as exc:
        _err(exc)


def _day(v: Optional[str], name: str) -> Optional[date]:
    if not v:
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        raise HTTPException(400, f"{name} must be YYYY-MM-DD")


def _range(form: Form, start: Optional[str], end: Optional[str], default_periods: int = 7) -> tuple[date, date]:
    """[start, end] defaulting to the last `default_periods` due periods (or the whole form when 0)."""
    d1 = _day(end, "end") or min(x for x in (form.end_date, today_ist()) if x)
    d0 = _day(start, "start")
    if d0 is None:
        due = periods(form, end=d1)
        d0 = (due[-default_periods] if default_periods and len(due) >= default_periods else
              due[0] if due else form.start_date)
    if d1 < d0:
        raise HTTPException(400, "end is before start")
    if (d1 - d0).days >= MAX_PERIODS * (7 if form.frequency == "weekly" else 1):
        raise HTTPException(400, "period too long")
    return d0, d1


def _attachment(name: str) -> dict[str, str]:
    ascii_name = name.encode("ascii", "ignore").decode() or "export"
    return {"Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"}


# --------------------------------------------------------------------------- forms (list / define)
class FieldIn(BaseModel):
    id: Optional[int] = None
    key: Optional[str] = None
    label_mr: str = ""
    label_en: str = ""
    help_mr: str = ""
    help_en: str = ""
    type: str = "number"
    required: bool = False
    options: list[str] = []
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    integer: bool = True
    group: str = ""
    aggregate: Optional[str] = None
    archived: bool = False


class FormIn(BaseModel):
    title_mr: Optional[str] = None
    title_en: Optional[str] = None
    instructions_mr: Optional[str] = None
    instructions_en: Optional[str] = None
    frequency: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    deadline_hours: Optional[int] = None
    campaign_id: Optional[int] = None
    fields: Optional[list[FieldIn]] = None
    recipients: Optional[list[str]] = None


def _payload(body: FormIn) -> dict[str, Any]:
    data = body.model_dump(exclude_unset=True)
    if body.fields is not None:
        data["fields"] = [f.model_dump() for f in body.fields]
    return data


@app.get("/api/forms")
def api_forms(request: Request, archived: bool = False, s: Session = Depends(get_session)):
    user = current_user(request)
    rows = service.visible_forms(s, user, include_archived=archived)
    if user.role == "state":
        return [schema.form_brief(s, f) for f in rows]
    return [schema.form_json(s, f, fields=False) for f in rows]


@app.get("/api/forms/mine")
def api_forms_mine(request: Request, s: Session = Depends(get_session)):
    return service.inbox(s, current_user(request))


@app.post("/api/forms")
def api_form_create(body: FormIn, admin: User = Depends(state_only), s: Session = Depends(get_session)):
    try:
        form = schema.create_form(s, admin.username, _payload(body))
    except FormError as exc:
        s.rollback()
        _err(exc)
    s.commit()
    return schema.form_json(s, form)


@app.get("/api/forms/{form_id}")
def api_form(request: Request, form_id: int, s: Session = Depends(get_session)):
    return schema.form_json(s, _form(s, current_user(request), form_id))


@app.put("/api/forms/{form_id}")
def api_form_update(form_id: int, body: FormIn, admin: User = Depends(state_only), s: Session = Depends(get_session)):
    form = _form(s, admin, form_id)
    try:
        schema.update_form(s, admin.username, form, _payload(body))
    except FormError as exc:
        s.rollback()
        _err(exc)
    s.commit()
    s.refresh(form)
    return schema.form_json(s, form)


class RecipientsIn(BaseModel):
    offices: list[str]


@app.put("/api/forms/{form_id}/recipients")
def api_form_recipients(form_id: int, body: RecipientsIn, admin: User = Depends(state_only),
                        s: Session = Depends(get_session)):
    return api_form_update(form_id, FormIn(recipients=body.offices), admin, s)


def _status_endpoint(status: str):
    def handler(form_id: int, admin: User = Depends(state_only), s: Session = Depends(get_session)):
        form = _form(s, admin, form_id)
        try:
            schema.set_status(s, admin.username, form, status)
        except FormError as exc:
            s.rollback()
            _err(exc)
        s.commit()
        return schema.form_json(s, form)
    return handler


for _action, _status in (("publish", "published"), ("pause", "paused"), ("unpublish", "draft")):
    app.post(f"/api/forms/{{form_id}}/{_action}")(_status_endpoint(_status))


@app.post("/api/forms/{form_id}/duplicate")
def api_form_duplicate(form_id: int, admin: User = Depends(state_only), s: Session = Depends(get_session)):
    copy = schema.duplicate_form(s, admin.username, _form(s, admin, form_id))
    s.commit()
    return schema.form_json(s, copy)


@app.delete("/api/forms/{form_id}")
def api_form_delete(form_id: int, admin: User = Depends(state_only), s: Session = Depends(get_session)):
    """Shown to the admin as a delete; the form is archived (see schema.delete_form)."""
    schema.delete_form(s, admin.username, _form(s, admin, form_id))
    s.commit()
    return {"ok": True}


@app.post("/api/forms/{form_id}/restore")
def api_form_restore(form_id: int, admin: User = Depends(state_only), s: Session = Depends(get_session)):
    form = _form(s, admin, form_id)
    try:
        schema.restore_form(s, admin.username, form)
    except FormError as exc:
        s.rollback()
        _err(exc)
    s.commit()
    return schema.form_json(s, form)


# --------------------------------------------------------------------------- filling (offices)
def _with_access(s: Session, user: User, form: Form, office: str, ps: date, sub) -> dict[str, Any]:
    out = service.submission_json(form, office, ps, sub)
    out["read_only_reason"] = service.editable(user, form, office, ps, sub, set(schema.recipient_codes(s, form)))
    return out


@app.get("/api/forms/{form_id}/periods")
def api_form_periods(request: Request, form_id: int, office: str, start: Optional[str] = None,
                     end: Optional[str] = None, s: Session = Depends(get_session)):
    """One office's periods in [start, end] (default: the last 7), each with its submission and whether the
    user may edit it."""
    user = current_user(request)
    form = _form(s, user, form_id)
    if office not in _scope(s, user, form, office=office):
        raise HTTPException(404, "this office does not receive this form")
    d0, d1 = _range(form, start, end)
    recips = set(schema.recipient_codes(s, form))
    rows = service.office_periods(s, form, office, d0, d1)
    for r in rows:
        sub = service.find(s, form, office, date.fromisoformat(r["period_start"]))
        r["read_only_reason"] = service.editable(user, form, office, date.fromisoformat(r["period_start"]), sub,
                                                 recips)
    return {"form": schema.form_json(s, form), "office": office, "start": d0.isoformat(), "end": d1.isoformat(),
            "editable_offices": editable_office_codes(s, user), "periods": rows}


def _submission_target(request: Request, s: Session, form_id: int, office: str, period: date):
    user = current_user(request)
    form = _form(s, user, form_id)
    if office not in _scope(s, user, form, office=office):
        raise HTTPException(404, "this office does not receive this form")
    return user, form


@app.get("/api/forms/{form_id}/submissions/{office}/{period}")
def api_submission(request: Request, form_id: int, office: str, period: date, s: Session = Depends(get_session)):
    user, form = _submission_target(request, s, form_id, office, period)
    return _with_access(s, user, form, office, period, service.find(s, form, office, period))


class SaveIn(BaseModel):
    values: dict[str, Any]
    confirm_zero: bool = False
    note: Optional[str] = None
    submit: bool = False


@app.put("/api/forms/{form_id}/submissions/{office}/{period}")
def api_submission_save(request: Request, form_id: int, office: str, period: date, body: SaveIn,
                        s: Session = Depends(get_session)):
    user, form = _submission_target(request, s, form_id, office, period)
    try:
        sub = service.save(s, user, form, office, period, body.values, confirm_zero=body.confirm_zero,
                           note=body.note, submit=body.submit)
    except FormError as exc:
        s.rollback()
        _err(exc)
    s.commit()
    return _with_access(s, user, form, office, period, sub)


@app.post("/api/forms/{form_id}/submissions/{office}/{period}/submit")
def api_submission_submit(request: Request, form_id: int, office: str, period: date,
                          s: Session = Depends(get_session)):
    user, form = _submission_target(request, s, form_id, office, period)
    sub = service.find(s, form, office, period)
    if sub is None:
        raise HTTPException(400, "nothing filled in yet")
    try:
        service.submit_(s, user, form, sub)
    except FormError as exc:
        s.rollback()
        _err(exc)
    s.commit()
    return _with_access(s, user, form, office, period, sub)


# --------------------------------------------------------------------------- review (state; zone reads)
@app.get("/api/forms/{form_id}/responses")
def api_form_responses(request: Request, form_id: int, start: Optional[str] = None, end: Optional[str] = None,
                       division: str = "", office: str = "", s: Session = Depends(get_session)):
    user = current_user(request)
    form = _form(s, user, form_id)
    d0, d1 = _range(form, start, end)
    if len(periods(form, d0, d1)) > 62:
        raise HTTPException(400, "show at most 62 periods at a time (export the workbook for more)")
    return {"form": schema.form_json(s, form), "start": d0.isoformat(), "end": d1.isoformat(),
            "can_review": user.role == "state",
            **service.responses(s, form, _scope(s, user, form, division, office), d0, d1)}


@app.get("/api/forms/{form_id}/compliance")
def api_form_compliance(request: Request, form_id: int, start: Optional[str] = None, end: Optional[str] = None,
                        division: str = "", s: Session = Depends(get_session)):
    user = current_user(request)
    form = _form(s, user, form_id)
    d0, d1 = _range(form, start, end)
    return {"start": d0.isoformat(), "end": d1.isoformat(),
            **service.compliance(s, form, _scope(s, user, form, division), d0, d1)}


class ReturnIn(BaseModel):
    note: str


class CorrectIn(BaseModel):
    key: str
    value: Any = None
    note: str = ""


class RevertIn(BaseModel):
    edit_id: int


def _review(form_id: int, office: str, period: date, admin: User, s: Session, fn) -> dict[str, Any]:
    form = _form(s, admin, form_id)
    try:
        fn(form)
    except FormError as exc:
        s.rollback()
        _err(exc)
    s.commit()
    return _with_access(s, admin, form, office, period, service.find(s, form, office, period))


@app.post("/api/forms/{form_id}/submissions/{office}/{period}/return")
def api_submission_return(form_id: int, office: str, period: date, body: ReturnIn,
                          admin: User = Depends(state_only), s: Session = Depends(get_session)):
    return _review(form_id, office, period, admin, s,
                   lambda form: service.return_(s, admin, form, office, period, body.note))


@app.post("/api/forms/{form_id}/submissions/{office}/{period}/correct")
def api_submission_correct(form_id: int, office: str, period: date, body: CorrectIn,
                           admin: User = Depends(state_only), s: Session = Depends(get_session)):
    return _review(form_id, office, period, admin, s,
                   lambda form: service.correct(s, admin, form, office, period, body.key, body.value, body.note))


@app.post("/api/forms/{form_id}/submissions/{office}/{period}/revert")
def api_submission_revert(form_id: int, office: str, period: date, body: RevertIn,
                          admin: User = Depends(state_only), s: Session = Depends(get_session)):
    return _review(form_id, office, period, admin, s,
                   lambda form: service.revert(s, admin, form, office, period, body.edit_id))


# --------------------------------------------------------------------------- analytics + export
class _Q:
    def __init__(self, request: Request, s: Session, form_id: int, start: Optional[str], end: Optional[str],
                 division: str, office: str):
        self.user = current_user(request)
        self.form = _form(s, self.user, form_id)
        self.start, self.end = _range(self.form, start, end)
        self.offices = _scope(s, self.user, self.form, division, office)
        self.division = division


def _q(request: Request, form_id: int, start: Optional[str] = None, end: Optional[str] = None,
       division: str = "", office: str = "", s: Session = Depends(get_session)) -> tuple[_Q, Session]:
    return _Q(request, s, form_id, start, end, division, office), s


@app.get("/api/forms/{form_id}/analytics/summary")
def api_an_summary(qs=Depends(_q)):
    q, s = qs
    return analytics.summary(s, q.form, q.offices, q.start, q.end)


@app.get("/api/forms/{form_id}/analytics/breakdown")
def api_an_breakdown(level: str = "office", qs=Depends(_q)):
    q, s = qs
    try:
        return analytics.breakdown(s, q.form, q.offices, q.start, q.end, level)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.get("/api/forms/{form_id}/analytics/series")
def api_an_series(qs=Depends(_q)):
    q, s = qs
    return analytics.series(s, q.form, q.offices, q.start, q.end)


@app.get("/api/forms/{form_id}/analytics/rankings")
def api_an_rankings(column: str, level: str = "office", qs=Depends(_q)):
    q, s = qs
    try:
        return analytics.rankings(s, q.form, q.offices, q.start, q.end, column, level)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.get("/api/forms/{form_id}/analytics/table")
def api_an_table(kind: str, sort: str = "", order: str = "desc", qs=Depends(_q)):
    q, s = qs
    try:
        return analytics.table(s, q.form, q.offices, q.start, q.end, kind, sort, order)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


# --------------------------------------------------------------------------- insights (docs/analytics.md)
def _bad(fn):
    try:
        return fn()
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.get("/api/forms/{form_id}/analytics/attention")
def api_an_attention(qs=Depends(_q)):
    q, s = qs
    return insights.attention(s, q.form, q.offices, q.start, q.end)


@app.get("/api/forms/{form_id}/analytics/groups")
def api_an_groups(qs=Depends(_q)):
    q, s = qs
    return insights.groups(s, q.form, q.offices, q.start, q.end)


@app.get("/api/forms/{form_id}/analytics/map")
def api_an_map(column: str = "", group: str = "", qs=Depends(_q)):
    q, s = qs
    return _bad(lambda: insights.office_map(s, q.form, q.offices, q.start, q.end, column, group))


@app.get("/api/forms/{form_id}/analytics/movers")
def api_an_movers(column: str = "", group: str = "", level: str = "office", qs=Depends(_q)):
    q, s = qs
    return _bad(lambda: insights.movers(s, q.form, q.offices, q.start, q.end, column, group, level))


@app.get("/api/forms/{form_id}/analytics/heatmap")
def api_an_heatmap(column: str = "", group: str = "", qs=Depends(_q)):
    q, s = qs
    if len(periods(q.form, q.start, q.end)) > 62:
        raise HTTPException(400, "show at most 62 periods at a time")
    return _bad(lambda: insights.heatmap(s, q.form, q.offices, q.start, q.end, column, group))


@app.get("/api/forms/{form_id}/analytics/peer")
def api_an_peer(qs=Depends(_q)):
    """A district office's division average per reported period (averages only, never another office's own
    figures), with the caller's own totals and average counted the same way under `mine`. Other roles get their
    own scope's average."""
    q, s = qs
    peers = q.offices
    if q.user.role == "district" and q.user.office_code:
        from app.models import Office
        own = s.get(Office, q.user.office_code)
        peers = [c for c in schema.recipient_codes(s, q.form)
                 if own and (o := s.get(Office, c)) is not None and o.division_code == own.division_code]
    mine = insights.peer_average(s, q.form, q.offices, q.start, q.end)
    return {**insights.peer_average(s, q.form, peers, q.start, q.end),
            "mine": {"periods_reported": mine["periods_reported"], "per_day": mine["per_day"],
                     "totals": analytics.totals(s, q.form, q.offices, q.start, q.end)}}


def _scope_key(q) -> str:
    if q.user.role == "district":
        return f"office:{q.user.office_code}"
    if q.user.role == "zone":
        return f"division:{q.user.division_code}"
    div = q.division or ""
    return f"division:{div}" if div else "state"


@app.get("/api/forms/{form_id}/analytics/brief")
def api_an_brief(lang: str = "mr", refresh: bool = False, qs=Depends(_q)):
    from app.ai import brief
    q, s = qs
    out = brief.brief(s, settings, q.form, q.offices, _scope_key(q), q.user.username, lang,
                      refresh=refresh and q.user.role == "state")
    s.commit()
    return out


class AskIn(BaseModel):
    question: str = ""
    intent: str = ""
    params: dict[str, Any] = {}


@app.post("/api/forms/{form_id}/analytics/ask")
def api_an_ask(body: AskIn, qs=Depends(_q)):
    from app.ai import ask
    q, s = qs
    out = ask.ask(s, settings, q.form, q.offices, q.user.username, body.question, body.intent, body.params)
    s.commit()
    return out


@app.get("/api/forms/{form_id}/analytics/ask")
def api_an_ask_suggestions(qs=Depends(_q)):
    from app.ai import ask
    from app.ai.client import configured
    q, s = qs
    return {"ai_configured": configured(settings), "suggestions": ask.suggestions(ask.catalogue(s, q.form, q.offices))}


@app.get("/api/forms/{form_id}/analytics/export")
def api_an_export(kind: str, format: str = "xlsx", sort: str = "", order: str = "desc", qs=Depends(_q)):
    q, s = qs
    try:
        t = analytics.table(s, q.form, q.offices, q.start, q.end, kind, sort, order)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    name = f"{kind}_{t['start']}" + (f"_{t['end']}" if t["end"] != t["start"] else "")
    if format == "csv":
        return Response(analytics.to_csv(t), media_type="text/csv; charset=utf-8",
                        headers=_attachment(f"{name}.csv"))
    if format != "xlsx":
        raise HTTPException(400, "format must be xlsx or csv")
    return Response(analytics.to_xlsx(t), media_type=XLSX, headers=_attachment(f"{name}.xlsx"))


@app.get("/api/forms/{form_id}/export")
def api_form_export(request: Request, form_id: int, start: Optional[str] = None, end: Optional[str] = None,
                    division: str = "", office: str = "", s: Session = Depends(get_session)):
    """The whole workbook (सूचना, डेटा एंट्री, five roll-ups) for [start, end]; default: the whole form."""
    user = current_user(request)
    form = _form(s, user, form_id)
    d0, d1 = _range(form, start, end, default_periods=0)
    data = analytics.workbook(s, form, _scope(s, user, form, division, office), d0, d1)
    return Response(data, media_type=XLSX, headers=_attachment(f"{form.title_mr}_{d0}_{d1}.xlsx"))

