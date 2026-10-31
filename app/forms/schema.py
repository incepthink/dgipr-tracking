"""Form definitions: create / update / publish / duplicate, and the schema lock.

The lock: once any value is stored for a field, the field can be renamed, reordered, archived or made
(not) required, but never deleted, retyped or re-keyed, and a choice can't lose an option that was
answered; once any submission exists the form's frequency and start date are fixed (periods would shift).
Old answers therefore always keep their meaning."""
from __future__ import annotations

import re
from datetime import date
from typing import Any, Iterable, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import audit
from app.forms.periods import FREQUENCIES, deadline, periods
from app.models import Division, Form, FormField, FormRecipient, FormSubmission, FormValue, Office
from app.timeutil import today_ist, utcnow

FIELD_TYPES = ("number", "text", "yesno", "choice", "date")
STATUSES = ("draft", "published", "paused", "archived")
AGGREGATES = ("sum", "none")
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")


class FormError(ValueError):
    """Rejected request; `status` is the HTTP status the API answers with."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# --------------------------------------------------------------------------- helpers
def _slugify(text: str, fallback: str, limit: int) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")[:limit].strip("_")
    return s if s and s[0].isalpha() else fallback


def _unique(base: str, taken: set[str], limit: int) -> str:
    if base not in taken:
        return base
    i = 2
    while f"{base[:limit - 4]}_{i}" in taken:
        i += 1
    return f"{base[:limit - 4]}_{i}"


def locked_field_ids(s: Session, form: Form) -> set[int]:
    ids = [f.id for f in form.fields if f.id]
    if not ids:
        return set()
    return set(s.scalars(select(FormValue.field_id).where(FormValue.field_id.in_(ids)).distinct()).all())


def has_submissions(s: Session, form: Form) -> bool:
    return bool(form.id and s.scalar(select(func.count(FormSubmission.id)).where(FormSubmission.form_id == form.id)))


def active_fields(form: Form) -> list[FormField]:
    return [f for f in form.fields if not f.archived]


def sum_fields(form: Form) -> list[FormField]:
    """Roll-up columns: numeric fields totalled across offices and periods."""
    return [f for f in form.fields if f.type == "number" and f.aggregate == "sum" and not f.archived]


def recipient_codes(s: Session, form: Form) -> list[str]:
    """The form's recipients, active offices only, in report order."""
    return list(s.scalars(
        select(Office.code).join(FormRecipient, FormRecipient.office_code == Office.code)
        .join(Division, Division.code == Office.division_code)
        .where(FormRecipient.form_id == form.id, Office.active.is_(True), Division.active.is_(True))
        .order_by(Division.sort_order, Office.sort_order)).all())


def all_office_codes(s: Session) -> list[str]:
    return list(s.scalars(select(Office.code).join(Division, Division.code == Office.division_code)
                          .where(Office.active.is_(True), Division.active.is_(True))
                          .order_by(Division.sort_order, Office.sort_order)).all())


# --------------------------------------------------------------------------- serializers
def field_json(f: FormField, locked: bool = False) -> dict[str, Any]:
    return {"id": f.id, "key": f.key, "label_mr": f.label_mr, "label_en": f.label_en, "help_mr": f.help_mr,
            "help_en": f.help_en, "type": f.type, "required": f.required, "options": list(f.options or []),
            "min_value": f.min_value, "max_value": f.max_value, "integer": f.integer, "group": f.group,
            "sort_order": f.sort_order, "aggregate": f.aggregate, "archived": f.archived, "locked": locked}


def form_json(s: Session, form: Form, *, fields: bool = True) -> dict[str, Any]:
    d: dict[str, Any] = {
        "id": form.id, "slug": form.slug, "title_mr": form.title_mr, "title_en": form.title_en,
        "instructions_mr": form.instructions_mr, "instructions_en": form.instructions_en,
        "frequency": form.frequency, "start_date": form.start_date.isoformat(),
        "end_date": form.end_date.isoformat() if form.end_date else None, "deadline_hours": form.deadline_hours,
        "status": form.status, "campaign_id": form.campaign_id,
        "created_by": form.created_by, "created_at": form.created_at.isoformat() + "Z",
        "updated_at": form.updated_at.isoformat() + "Z", "recipients": recipient_codes(s, form),
        "schedule_locked": has_submissions(s, form),
    }
    if fields:
        locked = locked_field_ids(s, form)
        d["fields"] = [field_json(f, f.id in locked) for f in form.fields]
    return d


# --------------------------------------------------------------------------- validation
def _date(v: Any, name: str) -> Optional[date]:
    if v in (None, ""):
        return None
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v))
    except ValueError:
        raise FormError(f"{name}: expected YYYY-MM-DD")


def _clean_field(raw: dict[str, Any]) -> dict[str, Any]:
    ftype = raw.get("type", "number")
    if ftype not in FIELD_TYPES:
        raise FormError(f"field type must be one of {', '.join(FIELD_TYPES)}")
    label_mr = str(raw.get("label_mr") or "").strip()
    label_en = str(raw.get("label_en") or "").strip()
    if not label_mr and not label_en:
        raise FormError("every field needs a label")
    options = [str(o).strip() for o in (raw.get("options") or []) if str(o).strip()]
    if ftype == "choice":
        if not options:
            raise FormError(f"{label_mr or label_en}: a dropdown needs at least one option")
        if len(set(options)) != len(options):
            raise FormError(f"{label_mr or label_en}: options must be different")
    mn, mx = raw.get("min_value"), raw.get("max_value")
    mn = None if mn in (None, "") else float(mn)
    mx = None if mx in (None, "") else float(mx)
    if mn is not None and mx is not None and mn > mx:
        raise FormError(f"{label_mr or label_en}: minimum is above maximum")
    aggregate = raw.get("aggregate") or ("sum" if ftype == "number" else "none")
    if aggregate not in AGGREGATES:
        raise FormError("aggregate must be sum or none")
    return {"label_mr": label_mr or label_en, "label_en": label_en, "type": ftype,
            "help_mr": str(raw.get("help_mr") or "").strip(), "help_en": str(raw.get("help_en") or "").strip(),
            "required": bool(raw.get("required")), "options": options if ftype == "choice" else [],
            "min_value": mn if ftype == "number" else None, "max_value": mx if ftype == "number" else None,
            "integer": bool(raw.get("integer", True)), "group": str(raw.get("group") or "").strip()[:40],
            "aggregate": aggregate if ftype == "number" else "none", "archived": bool(raw.get("archived"))}


def _apply_details(form: Form, data: dict[str, Any], schedule_locked: bool) -> None:
    if "title_mr" in data or "title_en" in data:
        title_mr = str(data.get("title_mr", form.title_mr) or "").strip()
        title_en = str(data.get("title_en", form.title_en) or "").strip()
        if not title_mr and not title_en:
            raise FormError("the form needs a title")
        form.title_mr, form.title_en = (title_mr or title_en)[:300], title_en[:300]
    for k in ("instructions_mr", "instructions_en"):
        if k in data:
            setattr(form, k, str(data[k] or "").strip())
    freq = data.get("frequency", form.frequency)
    start = _date(data["start_date"], "start_date") if "start_date" in data else form.start_date
    if freq not in FREQUENCIES:
        raise FormError("frequency must be daily, weekly or once")
    if start is None:
        raise FormError("start_date is required")
    if schedule_locked and (freq != form.frequency or start != form.start_date):
        raise FormError("frequency and start date can't change once offices have sent data")
    form.frequency, form.start_date = freq, start
    if "end_date" in data:
        form.end_date = _date(data["end_date"], "end_date")
    if form.end_date and form.end_date < form.start_date:
        raise FormError("end date is before start date")
    if "deadline_hours" in data:
        dh = data["deadline_hours"]
        dh = None if dh in (None, "") else int(dh)
        if dh is not None and not 0 <= dh <= 24 * 60:
            raise FormError("deadline must be 0–1440 hours after the period")
        form.deadline_hours = dh
    if "campaign_id" in data:
        form.campaign_id = data["campaign_id"] or None


def _apply_fields(s: Session, form: Form, raw_fields: list[dict[str, Any]]) -> None:
    locked = locked_field_ids(s, form)
    existing = {f.id: f for f in form.fields}
    keep: set[int] = set()
    taken = {f.key for f in form.fields}
    for order, raw in enumerate(raw_fields):
        clean = _clean_field(raw)
        fid = raw.get("id")
        if fid:
            f = existing.get(int(fid))
            if f is None:
                raise FormError(f"field {fid} is not part of this form")
            new_key = str(raw.get("key") or f.key)
            if f.id in locked:
                if clean["type"] != f.type:
                    raise FormError(f"{f.label_mr}: offices already answered this field, so its type can't change")
                if new_key != f.key:
                    raise FormError(f"{f.label_mr}: offices already answered this field, so its key can't change")
                if f.type == "choice":
                    used = set(s.scalars(select(FormValue.value_text).where(FormValue.field_id == f.id)).all())
                    lost = sorted(o for o in used if o and o not in clean["options"])
                    if lost:
                        raise FormError(f"{f.label_mr}: option(s) already answered can't be removed: {', '.join(lost)}")
            elif new_key != f.key:
                if not KEY_RE.match(new_key) or new_key in taken - {f.key}:
                    raise FormError(f"field key {new_key!r} is invalid or already used")
                taken.discard(f.key)
                taken.add(new_key)
                f.key = new_key
            keep.add(f.id)
        else:
            want = str(raw.get("key") or "").strip()
            if want and (not KEY_RE.match(want) or want in taken):
                raise FormError(f"field key {want!r} is invalid or already used")
            key = want or _unique(_slugify(clean["label_en"], f"field_{len(taken) + 1}", 40), taken, 40)
            taken.add(key)
            f = FormField(key=key)
            form.fields.append(f)
        for k, v in clean.items():
            setattr(f, k, v)
        f.sort_order = order
    for fid, f in existing.items():
        if fid not in keep:
            if fid in locked:
                raise FormError(f"{f.label_mr}: offices already answered this field — archive it instead of deleting")
            form.fields.remove(f)


def set_recipients(s: Session, form: Form, codes: Iterable[str]) -> None:
    codes = list(dict.fromkeys(codes))
    known = set(s.scalars(select(Office.code).where(Office.code.in_(codes or ["-"]))).all())
    unknown = [c for c in codes if c not in known]
    if unknown:
        raise FormError(f"unknown office(s): {', '.join(unknown)}")
    current = {r.office_code: r for r in form.recipients}
    for code, r in current.items():
        if code not in codes:
            form.recipients.remove(r)
    for code in codes:
        if code not in current:
            form.recipients.append(FormRecipient(office_code=code))


# --------------------------------------------------------------------------- operations
def create_form(s: Session, actor: str, data: dict[str, Any]) -> Form:
    taken = set(s.scalars(select(Form.slug)).all())
    base = _slugify(str(data.get("slug") or data.get("title_en") or ""), "form", 90)
    form = Form(slug=_unique(base, taken, 100), title_mr="", status="draft", created_by=actor,
                start_date=_date(data.get("start_date"), "start_date") or today_ist(), frequency="daily")
    s.add(form)
    _apply_details(form, {"title_mr": "", "title_en": "", **data}, schedule_locked=False)
    _apply_fields(s, form, data.get("fields") or [])
    set_recipients(s, form, data["recipients"] if data.get("recipients") is not None else all_office_codes(s))
    s.flush()
    audit.record(s, actor, "form.create", "form", form.id, after=form_json(s, form))
    return form


def update_form(s: Session, actor: str, form: Form, data: dict[str, Any]) -> Form:
    before = form_json(s, form)
    _apply_details(form, data, schedule_locked=has_submissions(s, form))
    if data.get("fields") is not None:
        _apply_fields(s, form, data["fields"])
    if data.get("recipients") is not None:
        set_recipients(s, form, data["recipients"])
    if form.status == "published":
        _check_publishable(s, form)
    form.updated_at = utcnow()
    s.flush()
    s.expire(form, ["fields", "recipients"])
    audit.record(s, actor, "form.update", "form", form.id, before=before, after=form_json(s, form))
    return form


def _check_publishable(s: Session, form: Form) -> None:
    if not active_fields(form):
        raise FormError("add at least one field before publishing")
    if not form.recipients:
        raise FormError("choose at least one office before publishing")


def set_status(s: Session, actor: str, form: Form, status: str) -> Form:
    if status not in STATUSES:
        raise FormError("unknown status")
    if status == "published":
        _check_publishable(s, form)
    if status == "draft" and has_submissions(s, form):
        raise FormError("offices already sent data; pause the form instead")
    before = form.status
    form.status = status
    form.updated_at = utcnow()
    audit.record(s, actor, f"form.{status}", "form", form.id, before={"status": before}, after={"status": status})
    return form


def duplicate_form(s: Session, actor: str, form: Form) -> Form:
    """A new draft with the same details, fields and recipients, starting today and not linked to a campaign."""
    data = form_json(s, form)
    data.update(slug=f"{form.slug}_copy", title_mr=f"{form.title_mr} (प्रत)",
                title_en=f"{form.title_en} (copy)" if form.title_en else "", start_date=today_ist(),
                end_date=None, campaign_id=None,
                fields=[{**f, "id": None} for f in data["fields"] if not f["archived"]])
    copy = create_form(s, actor, data)
    audit.record(s, actor, "form.duplicate", "form", copy.id, after={"from": form.id})
    return copy


def delete_form(s: Session, actor: str, form: Form) -> Form:
    """What the admin sees as deleting: the form is archived, from any status, so nothing it collected is lost."""
    before = form.status
    form.status = "archived"
    form.updated_at = utcnow()
    audit.record(s, actor, "form.delete", "form", form.id, before={"status": before}, after={"status": "archived"})
    return form


def restore_form(s: Session, actor: str, form: Form) -> Form:
    """Bring back an archived form: paused if offices sent data for it, otherwise a draft to publish again."""
    if form.status != "archived":
        raise FormError("only a deleted form can be restored")
    return set_status(s, actor, form, "paused" if has_submissions(s, form) else "draft")


def form_brief(s: Session, form: Form, today: Optional[date] = None) -> dict[str, Any]:
    """Card data for the admin's forms list: response rate for the latest due period and its deadline."""
    today = today or today_ist()
    recips = recipient_codes(s, form)
    due = periods(form, today=today)
    latest = due[-1] if due else None
    sent = 0
    if latest:
        sent = s.scalar(select(func.count(FormSubmission.id)).where(
            FormSubmission.form_id == form.id, FormSubmission.period_start == latest,
            FormSubmission.office_code.in_(recips or ["-"]),
            FormSubmission.status.in_(("submitted", "accepted")))) or 0
    dl = deadline(form, latest) if latest else None
    return {**form_json(s, form, fields=False), "fields_count": len(active_fields(form)),
            "latest_period": latest.isoformat() if latest else None, "latest_sent": int(sent),
            "latest_expected": len(recips), "latest_deadline": dl.isoformat() + "Z" if dl else None}
