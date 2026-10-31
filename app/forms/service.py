"""Filling, submitting and reviewing forms.

  office (district)  fills its own office's periods for the forms it receives: save draft → submit. It may keep
                     changing a sent period until 11:59 PM IST on the period's last day (each change is kept as a
                     FormValueEdit); after that the period is read-only for it unless the state office returns it.
  zone               reads its division's submissions; never writes.
  state              may fill any recipient office, edits submitted values, and may return a period with a note.

Blank fields stay missing (no row); a typed 0 is stored only when the office confirms zeros, so an untouched
field can never pass for a confirmed zero. An edit keeps the office's original value and adds a FormValueEdit
(before, after, who, when, why), so every edit can be undone; the UI and the Excel export highlight edited
values. Every change writes an audit entry."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.auth import can_edit, visible_office_codes
from app.forms.periods import deadline, entry_closes, is_period_start, label, period_end, periods
from app.forms.schema import FormError, active_fields, recipient_codes
from app.models import Division, Form, FormField, FormRecipient, FormSubmission, FormValue, FormValueEdit, Office, User
from app.timeutil import today_ist, utcnow

COUNTED = ("submitted", "returned")  # what roll-ups and reports sum; drafts are work in progress
MAX_TEXT = 2000
ENTRY_CLOSED = "entry closed at 11:59 PM; only the state office can change these figures now"

Value = Any  # float | str | None


# --------------------------------------------------------------------------- visibility
def visible_forms(s: Session, user: User, include_archived: bool = False) -> list[Form]:
    """state: every form; others: published/closed forms sent to an office they can see."""
    q = select(Form).order_by(Form.id.desc())
    if user.role == "state":
        if not include_archived:
            q = q.where(Form.status != "archived")
        return list(s.scalars(q).all())
    offices = visible_office_codes(s, user)
    q = (q.where(Form.status.in_(("published", "closed")))
         .where(Form.id.in_(select(FormRecipient.form_id).where(FormRecipient.office_code.in_(offices or ["-"])))))
    return list(s.scalars(q).all())


def get_form(s: Session, user: User, form_id: int) -> Form:
    form = s.get(Form, form_id)
    if form is None or (user.role != "state" and form not in visible_forms(s, user)):
        raise FormError("form not found", 404)
    return form


def scope(s: Session, user: User, form: Form, division: str = "", office: str = "") -> list[str]:
    """Recipient offices the user may read, optionally narrowed to one division or office."""
    visible = set(visible_office_codes(s, user))
    codes = [c for c in recipient_codes(s, form) if c in visible]
    if office:
        if office not in visible:
            raise FormError("office outside your access", 403)
        return [c for c in codes if c == office]
    if division:
        div_offices = set(s.scalars(select(Office.code).where(Office.division_code == division)).all())
        if not div_offices & visible:
            raise FormError("division outside your access", 403)
        return [c for c in codes if c in div_offices]
    return codes


# --------------------------------------------------------------------------- values
def _num_out(f: FormField, v: Optional[float]):
    if v is None:
        return None
    return int(v) if f.integer and float(v).is_integer() else v


def value_of(f: FormField, row: Optional[FormValue]) -> Value:
    if row is None:
        return None
    return _num_out(f, row.value_num) if f.type == "number" else row.value_text


def _original_of(f: FormField, row: FormValue) -> Value:
    return _num_out(f, row.original_value_num) if f.type == "number" else row.original_value_text


def clean_value(f: FormField, v: Any) -> tuple[Optional[float], Optional[str]]:
    """(value_num, value_text) for one answer, or FormError. None / "" means blank."""
    label_ = f.label_mr or f.key
    if v is None or (isinstance(v, str) and not v.strip()):
        return None, None
    if f.type == "number":
        if isinstance(v, bool):
            raise FormError(f"{label_}: must be a number")
        try:
            n = float(v.strip().replace(",", "")) if isinstance(v, str) else float(v)
        except (TypeError, ValueError):
            raise FormError(f"{label_}: must be a number")
        if n != n or n in (float("inf"), float("-inf")):
            raise FormError(f"{label_}: must be a number")
        if f.integer and not n.is_integer():
            raise FormError(f"{label_}: must be a whole number")
        lo = 0 if f.min_value is None else f.min_value
        if n < lo:
            raise FormError(f"{label_}: must be at least {_fmt(lo)}")
        if f.max_value is not None and n > f.max_value:
            raise FormError(f"{label_}: must be at most {_fmt(f.max_value)}")
        return n, None
    text = str(v).strip()
    if f.type == "yesno":
        if text not in ("yes", "no"):
            raise FormError(f"{label_}: answer yes or no")
    elif f.type == "choice":
        if text not in (f.options or []):
            raise FormError(f"{label_}: pick one of the listed options")
    elif f.type == "date":
        try:
            date.fromisoformat(text)
        except ValueError:
            raise FormError(f"{label_}: expected a date (YYYY-MM-DD)")
    elif len(text) > MAX_TEXT:
        raise FormError(f"{label_}: at most {MAX_TEXT} characters")
    return None, text


def _fmt(n: float) -> str:
    return str(int(n)) if float(n).is_integer() else str(n)


def _has(row: FormValue) -> bool:
    return row.value_num is not None or row.value_text is not None


# --------------------------------------------------------------------------- submissions
def find(s: Session, form: Form, office: str, ps: date) -> Optional[FormSubmission]:
    return s.scalar(select(FormSubmission).where(FormSubmission.form_id == form.id,
                                                 FormSubmission.office_code == office,
                                                 FormSubmission.period_start == ps))


def _late(form: Form, ps: date, sub: Optional[FormSubmission], now: datetime) -> bool:
    dl = deadline(form, ps)
    if dl is None:
        return False
    if sub is not None and sub.submitted_at is not None and sub.status == "submitted":
        return sub.submitted_at > dl
    return now > dl


def submission_json(form: Form, office: str, ps: date, sub: Optional[FormSubmission],
                    now: Optional[datetime] = None) -> dict[str, Any]:
    now = now or utcnow()
    fields = {f.id: f for f in form.fields}
    rows = {v.field_id: v for v in (sub.values if sub else [])}
    values: dict[str, Value] = {}
    corrections: dict[str, dict[str, Any]] = {}
    for fid, f in fields.items():
        row = rows.get(fid)
        values[f.key] = value_of(f, row)
        if row is not None and row.corrected_at is not None:
            corrections[f.key] = {"original": _original_of(f, row), "by": row.corrected_by,
                                  "at": row.corrected_at.isoformat() + "Z", "note": row.correction_note}
    latest = max((r for r in rows.values()), key=lambda r: r.entered_at, default=None)
    dl = deadline(form, ps)
    return {"form_id": form.id, "office": office, "period_start": ps.isoformat(),
            "period_end": period_end(form, ps).isoformat(), "label": label(form, ps),
            "status": sub.status if sub else "none", "late": _late(form, ps, sub, now),
            "deadline": dl.isoformat() + "Z" if dl else None,
            "submitted_at": sub.submitted_at.isoformat() + "Z" if sub and sub.submitted_at else None,
            "submitted_by": sub.submitted_by if sub else "",
            "reviewed_at": sub.reviewed_at.isoformat() + "Z" if sub and sub.reviewed_at else None,
            "reviewed_by": sub.reviewed_by if sub else "", "review_note": sub.review_note if sub else "",
            "note": sub.note if sub else "", "values": values, "corrections": corrections,
            "edits": [edit_json(e) for e in sub.edits] if sub else [],
            "entered_by": latest.entered_by if latest else None,
            "entered_at": latest.entered_at.isoformat() + "Z" if latest else None}


def office_periods(s: Session, form: Form, office: str, start: date, end: date) -> list[dict[str, Any]]:
    """Every due period of [start, end] for one office, newest last, with its submission (or status none)."""
    ps_list = periods(form, start, end)
    subs = {x.period_start: x for x in s.scalars(select(FormSubmission).where(
        FormSubmission.form_id == form.id, FormSubmission.office_code == office,
        FormSubmission.period_start.in_(ps_list or [date.min]))).all()}
    now = utcnow()
    return [submission_json(form, office, ps, subs.get(ps), now) for ps in ps_list]


def editable(user: User, form: Form, office: str, ps: date, sub: Optional[FormSubmission],
             recipients: Optional[set[str]] = None) -> Optional[str]:
    """None when the user may save this period; otherwise the reason it is read-only."""
    if not can_edit(user, office):
        return "you can only fill in forms for your own office"
    if recipients is not None and office not in recipients:
        return "this office does not receive this form"
    if not is_period_start(form, ps):
        return "not a reporting period of this form"
    if ps > today_ist():
        return "this period has not started yet"
    if user.role == "state":
        if sub is not None and sub.status == "submitted":
            return "already submitted — edit the values on the responses page"
        return None
    if form.status != "published":
        return "this form is closed"
    if not form.entry_open:
        return "data entry is paused for this form"
    # offices fill a day until 11:59 PM IST that day; afterwards only the state office changes it, unless it
    # returned the period to the office for a fix
    if utcnow() >= entry_closes(form, ps) and not (sub is not None and sub.status == "returned"):
        return ENTRY_CLOSED
    return None


def check_writable(s: Session, user: User, form: Form, office: str, ps: date,
                   sub: Optional[FormSubmission]) -> None:
    reason = editable(user, form, office, ps, sub, set(recipient_codes(s, form)))
    if reason:
        raise FormError(reason, 403 if "own office" in reason or "receive" in reason else 400)


def save(s: Session, user: Optional[User], form: Form, office: str, ps: date, values: dict[str, Any], *,
         confirm_zero: bool = False, note: Optional[str] = None, submit: bool = False,
         actor: Optional[str] = None, check: bool = True) -> FormSubmission:
    """Save (part of) one office-period. Keys absent from `values` are left untouched; None/"" clears one.
    check=False skips permission/schedule checks and required fields (imports, migration)."""
    if s.get(Office, office) is None:
        raise FormError(f"unknown office {office}", 404)
    sub = find(s, form, office, ps)
    if check:
        if user is None:
            raise FormError("login required", 401)
        check_writable(s, user, form, office, ps, sub)
    elif not is_period_start(form, ps):
        raise FormError(f"{ps.isoformat()} is not a reporting period of this form")
    by_key = {f.key: f for f in form.fields}
    unknown = [k for k in values if k not in by_key or (check and by_key[k].archived)]
    if unknown:
        raise FormError(f"unknown field(s): {', '.join(unknown)}")
    cleaned = {k: clean_value(by_key[k], v) for k, v in values.items()}

    if sub is None:
        sub = FormSubmission(form_id=form.id, office_code=office, period_start=ps, status="draft")
        s.add(sub)
        s.flush()
    rows = {v.field_id: v for v in sub.values}
    new_zeros = [k for k, (n, _) in cleaned.items()
                 if n == 0 and not ((r := rows.get(by_key[k].id)) is not None and r.value_num == 0)]
    if new_zeros and not confirm_zero:
        raise FormError("confirm the zeros before saving (" + ", ".join(by_key[k].label_mr for k in new_zeros) + ")")

    before = {r.field.key: value_of(r.field, r) for r in rows.values()}
    now = utcnow()
    who = actor or (user.username if user else "system")
    sent = sub.status in COUNTED  # changes to a sent period are kept as its history
    for k, (n, t) in cleaned.items():
        f = by_key[k]
        row = rows.get(f.id)
        old = (row.value_num, row.value_text) if row is not None else (None, None)
        if old == (n, t):
            continue
        if sent:
            sub.edits.append(FormValueEdit(field_id=f.id, before_num=old[0], before_text=old[1], after_num=n,
                                           after_text=t, by=who, at=now,
                                           source="state" if user and user.role == "state" else "office"))
        if n is None and t is None:
            sub.values.remove(row)
            continue
        if row is None:
            row = FormValue(field_id=f.id)
            sub.values.append(row)
        # the office's own new value replaces an earlier correction (which stays in the audit log)
        row.original_value_num = row.original_value_text = row.corrected_by = row.corrected_at = None
        row.correction_note = ""
        row.value_num, row.value_text = n, t
        row.entered_by_user_id = user.id if user else None
        row.entered_by = who
        row.entered_at = now
    if note is not None:
        sub.note = note[:500]
    sub.updated_at = now
    s.flush()
    s.expire(sub, ["values"])
    after = {r.field.key: value_of(r.field, r) for r in sub.values}
    if check and sub.status == "submitted" and not submit and (missing := missing_required(form, sub)):
        raise FormError("a sent period can't lose a required field: " + ", ".join(f.label_mr for f in missing))
    if before != after:
        audit.record(s, who, "form_submission.save", "form_submission", _eid(form, office, ps),
                     before=before or None, after=after or None, note=note or "")
    if submit:
        submit_(s, user, form, sub, actor=who, check=check)
    return sub


def _eid(form: Form, office: str, ps: date) -> str:
    return f"{form.id}:{office}:{ps.isoformat()}"


def missing_required(form: Form, sub: FormSubmission) -> list[FormField]:
    have = {v.field_id for v in sub.values if _has(v)}
    return [f for f in active_fields(form) if f.required and f.id not in have]


def submit_(s: Session, user: Optional[User], form: Form, sub: FormSubmission, *, actor: Optional[str] = None,
            check: bool = True) -> FormSubmission:
    who = actor or (user.username if user else "system")
    if check:
        if user is None:
            raise FormError("login required", 401)
        check_writable(s, user, form, sub.office_code, sub.period_start, sub)
        missing = missing_required(form, sub)
        if missing:
            raise FormError("fill in the required field(s) first: " + ", ".join(f.label_mr for f in missing))
        if not any(_has(v) for v in sub.values):
            raise FormError("nothing filled in yet")
    before = sub.status
    if before == "submitted":  # sending changes to a sent period keeps when it was first sent
        return sub
    sub.status = "submitted"
    sub.submitted_at = utcnow()
    sub.submitted_by = who
    audit.record(s, who, "form_submission.submit", "form_submission", _eid(form, sub.office_code, sub.period_start),
                 before={"status": before}, after={"status": "submitted"})
    return sub


def _review_target(s: Session, form: Form, office: str, ps: date) -> FormSubmission:
    sub = find(s, form, office, ps)
    if sub is None or sub.status in ("draft",):
        raise FormError("this office has not submitted this period yet", 400)
    return sub


def return_(s: Session, admin: User, form: Form, office: str, ps: date, note: str) -> FormSubmission:
    note = (note or "").strip()
    if not note:
        raise FormError("say what needs fixing")
    sub = _review_target(s, form, office, ps)
    before = sub.status
    sub.status, sub.review_note = "returned", note[:1000]
    sub.reviewed_at, sub.reviewed_by = utcnow(), admin.username
    audit.record(s, admin.username, "form_submission.return", "form_submission", _eid(form, office, ps),
                 before={"status": before}, after={"status": "returned"}, note=note)
    return sub


def edit_json(e: FormValueEdit) -> dict[str, Any]:
    f = e.field
    num = f.type == "number"
    return {"id": e.id, "key": f.key, "by": e.by, "at": e.at.isoformat() + "Z", "note": e.note, "source": e.source,
            "before": _num_out(f, e.before_num) if num else e.before_text,
            "after": _num_out(f, e.after_num) if num else e.after_text, "reverts": e.reverts_id}


def correct(s: Session, admin: User, form: Form, office: str, ps: date, key: str, value: Any,
            note: str = "", reverts: Optional[FormValueEdit] = None) -> FormValueEdit:
    """Admin edit of one submitted value. The office's value is kept as the original; editing back to the
    original removes the highlight. Every edit is kept as a FormValueEdit."""
    note = (note or "").strip()
    f = next((x for x in form.fields if x.key == key), None)
    if f is None:
        raise FormError(f"unknown field {key}")
    sub = _review_target(s, form, office, ps)
    n, t = clean_value(f, value)
    row = next((v for v in sub.values if v.field_id == f.id), None)
    if row is None:
        row = FormValue(field_id=f.id, entered_by="", entered_at=utcnow())
        sub.values.append(row)
    if (row.value_num, row.value_text) == (n, t):
        raise FormError("the value is unchanged")
    before = value_of(f, row) if _has(row) else None
    edit = FormValueEdit(field_id=f.id, before_num=row.value_num, before_text=row.value_text, after_num=n,
                         after_text=t, by=admin.username, note=note[:1000], reverts_id=reverts.id if reverts else None)
    sub.edits.append(edit)
    if row.corrected_at is None:
        row.original_value_num, row.original_value_text = row.value_num, row.value_text
    row.value_num, row.value_text = n, t
    if (row.original_value_num, row.original_value_text) == (n, t):  # back to what the office sent
        row.original_value_num = row.original_value_text = row.corrected_by = row.corrected_at = None
        row.correction_note = ""
    else:
        row.corrected_by, row.corrected_at, row.correction_note = admin.username, utcnow(), note[:1000]
    sub.updated_at = utcnow()
    s.flush()
    audit.record(s, admin.username, "form_value.revert" if reverts else "form_value.correct", "form_submission",
                 _eid(form, office, ps), before={key: before}, after={key: value_of(f, row)}, note=note)
    return edit


def revert(s: Session, admin: User, form: Form, office: str, ps: date, edit_id: int) -> FormValueEdit:
    """Undo one edit: set the value back to what it was before that edit, as a new edit pointing at it."""
    sub = _review_target(s, form, office, ps)
    target = next((e for e in sub.edits if e.id == edit_id), None)
    if target is None:
        raise FormError("edit not found", 404)
    f = target.field
    before = (_num_out(f, target.before_num) if f.type == "number" else target.before_text)
    return correct(s, admin, form, office, ps, f.key, before, "", reverts=target)


# --------------------------------------------------------------------------- review views
def _subs(s: Session, form: Form, offices: list[str], ps_list: list[date]) -> dict[tuple[str, date], FormSubmission]:
    return {(x.office_code, x.period_start): x for x in s.scalars(select(FormSubmission).where(
        FormSubmission.form_id == form.id, FormSubmission.office_code.in_(offices or ["-"]),
        FormSubmission.period_start.in_(ps_list or [date.min]))).all()}


def _office_meta(s: Session, offices: list[str]) -> list[tuple[Office, Division]]:
    return [(o, d) for o, d in s.execute(
        select(Office, Division).join(Division, Division.code == Office.division_code)
        .where(Office.code.in_(offices or ["-"])).order_by(Division.sort_order, Office.sort_order)).all()]


def responses(s: Session, form: Form, offices: list[str], start: date, end: date) -> dict[str, Any]:
    """The combined (डेटा एंट्री) grid: one row per period × office, missing ones included as status none."""
    ps_list = periods(form, start, end)
    subs = _subs(s, form, offices, ps_list)
    meta = _office_meta(s, offices)
    now = utcnow()
    rows = []
    for ps in ps_list:
        for o, d in meta:
            r = submission_json(form, o.code, ps, subs.get((o.code, ps)), now)
            rows.append({**r, "office_name_mr": o.name_mr, "office_name_en": o.name_en,
                         "division": d.code, "division_mr": d.summary_label_mr})
    return {"periods": [p.isoformat() for p in ps_list], "rows": rows}


def compliance(s: Session, form: Form, offices: list[str], start: date, end: date) -> dict[str, Any]:
    """Offices × periods coloured by status (with late), per-period counts and the offices still missing."""
    ps_list = periods(form, start, end)
    subs = _subs(s, form, offices, ps_list)
    now = utcnow()
    n_fields = len(active_fields(form))
    active_ids = {f.id for f in active_fields(form)}
    rows = []
    per_period: dict[date, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    missing: dict[date, list[str]] = defaultdict(list)
    for o, d in _office_meta(s, offices):
        cells = []
        sent = 0
        for ps in ps_list:
            sub = subs.get((o.code, ps))
            st = sub.status if sub else "none"
            late = _late(form, ps, sub, now)
            filled = sum(1 for v in sub.values if v.field_id in active_ids and _has(v)) if sub else 0
            cells.append({"status": st, "late": late, "filled": filled})
            per_period[ps][st] += 1
            if st == "submitted":
                sent += 1
            else:
                missing[ps].append(o.code)
        rows.append({"code": o.code, "name_mr": o.name_mr, "name_en": o.name_en, "division": d.code,
                     "division_mr": d.summary_label_mr, "cells": cells, "sent": sent,
                     "pct": round(100 * sent / len(ps_list), 1) if ps_list else 0.0})
    return {"periods": [p.isoformat() for p in ps_list], "of": n_fields, "rows": rows,
            "counts": [dict(per_period[p]) for p in ps_list], "missing": [missing[p] for p in ps_list]}


def inbox(s: Session, user: User, today: Optional[date] = None) -> list[dict[str, Any]]:
    """Forms for the user's offices with what is pending (due, not submitted), overdue and returned."""
    today = today or today_ist()
    now = utcnow()
    visible = set(visible_office_codes(s, user))
    out = []
    for form in visible_forms(s, user):
        offices = [c for c in recipient_codes(s, form) if c in visible]
        due = periods(form, today=today)
        subs = _subs(s, form, offices, due)
        pending = overdue = returned = 0
        next_ps = None
        for ps in due:
            for o in offices:
                sub = subs.get((o, ps))
                st = sub.status if sub else "none"
                if st == "returned":
                    returned += 1
                if st in ("none", "draft", "returned"):
                    pending += 1
                    if _late(form, ps, sub, now):
                        overdue += 1
                    if next_ps is None or ps < next_ps:
                        next_ps = ps
        latest = due[-1] if due else None
        dl = deadline(form, latest) if latest else None
        out.append({"id": form.id, "slug": form.slug, "title_mr": form.title_mr, "title_en": form.title_en,
                    "instructions_mr": form.instructions_mr, "instructions_en": form.instructions_en,
                    "frequency": form.frequency, "status": form.status, "entry_open": form.entry_open,
                    "start_date": form.start_date.isoformat(),
                    "end_date": form.end_date.isoformat() if form.end_date else None,
                    "offices": offices, "pending": pending if form.status == "published" else 0,
                    "overdue": overdue if form.status == "published" else 0, "returned": returned,
                    "first_pending": next_ps.isoformat() if next_ps else None,
                    "latest_period": latest.isoformat() if latest else None,
                    "latest_deadline": dl.isoformat() + "Z" if dl else None})
    return out
