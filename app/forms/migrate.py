"""One-time move from the fixed 12-column office entries (office_entries + the campaign entry window) to forms.

For each campaign with office entries, or with an entry window an older database still carries, it creates
a published daily form linked to the campaign, with the 12 report columns as number fields (same keys, labels
and groups), every active office as recipient, and one submitted FormSubmission per office-day that has
values (values, who and when copied as-is). Campaigns that already have a linked form are skipped, so it is
safe to run again. office_entries itself is left untouched as a backup."""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app import audit
from app.forms.schema import all_office_codes
from app.models import Campaign, Form, FormField, FormRecipient, FormSubmission, FormValue, OfficeEntry
from app.reporting.columns import COLUMNS
from app.timeutil import today_ist

ACTOR = "system:migrate_entries"
INSTRUCTIONS_MR = ("१. रोजची आकडेवारी फक्त आपल्या कार्यालयासाठी भरा.\n"
                   "२. रिकामे ठेवलेले रकाने 'माहिती नाही' म्हणून राहतात — शून्य नाही. शून्य असल्यास ० भरा व खात्री करा.\n"
                   "३. भरून झाल्यावर 'सादर करा' दाबा. सादर केल्यानंतर बदल करायचा असल्यास राज्य कार्यालयाशी संपर्क साधा.")
INSTRUCTIONS_EN = ("1. Fill in the day's figures for your own office only.\n"
                   "2. Blank fields stay 'not entered' — never zero. Type 0 for a real zero and confirm it.\n"
                   "3. Press Submit when done. To change a submitted day, contact the state office.")


def _legacy_windows(s: Session) -> dict[int, dict[str, Any]]:
    """{campaign_id: {open, start, end}} from the old campaigns.entry_* columns, when the database has them."""
    cols = {c["name"] for c in inspect(s.get_bind()).get_columns("campaigns")}
    if "entry_open" not in cols:
        return {}
    out = {}
    for cid, is_open, start, end in s.execute(text("SELECT id, entry_open, entry_start, entry_end FROM campaigns")):
        out[cid] = {"open": bool(is_open), "start": _d(start), "end": _d(end)}
    return out


def _d(v) -> date | None:
    if v is None or isinstance(v, date):
        return v
    return date.fromisoformat(str(v)[:10])


def needed(s: Session) -> bool:
    return s.scalar(select(Form.id).limit(1)) is None and (
        s.scalar(select(OfficeEntry.id).limit(1)) is not None or bool(_legacy_windows(s)))


def migrate(s: Session) -> dict[str, Any]:
    windows = _legacy_windows(s)
    with_entries = set(s.scalars(select(OfficeEntry.campaign_id).distinct()).all())
    linked = set(s.scalars(select(Form.campaign_id).where(Form.campaign_id.isnot(None))).all())
    taken = set(s.scalars(select(Form.slug)).all())
    offices = all_office_codes(s)
    report: dict[str, Any] = {"forms": [], "skipped": []}
    for c in s.scalars(select(Campaign).order_by(Campaign.id)).all():
        win = windows.get(c.id)
        if c.id in linked:
            report["skipped"].append(c.slug)
            continue
        if c.id not in with_entries and not (win and win["open"] and c.active):
            continue
        entries = s.scalars(select(OfficeEntry).where(OfficeEntry.campaign_id == c.id)).all()
        first = min((e.entry_date for e in entries), default=None)
        start = (win or {}).get("start") or first or today_ist()
        if first and first < start:
            start = first
        slug = c.slug if c.slug not in taken else f"{c.slug}_form"
        taken.add(slug)
        form = Form(slug=slug, title_mr=c.title_mr, title_en=c.title_en, instructions_mr=INSTRUCTIONS_MR,
                    instructions_en=INSTRUCTIONS_EN, frequency="daily", start_date=start,
                    end_date=(win or {}).get("end"), status="published",
                    entry_open=(win or {}).get("open", True), campaign_id=c.id, created_by=ACTOR)
        for i, col in enumerate(COLUMNS):
            form.fields.append(FormField(key=col.key, label_mr=col.label_mr, label_en=col.label_en, type="number",
                                         min_value=0, integer=True, group=col.group, sort_order=i,
                                         aggregate="sum"))
        form.recipients = [FormRecipient(office_code=o) for o in offices]
        s.add(form)
        s.flush()
        field_id = {f.key: f.id for f in form.fields}
        grouped: dict[tuple[str, date], list[OfficeEntry]] = defaultdict(list)
        for e in entries:
            grouped[(e.office_code, e.entry_date)].append(e)
        n_values = 0
        for (office, day), items in sorted(grouped.items()):
            latest = max(items, key=lambda e: e.entered_at)
            sub = FormSubmission(form_id=form.id, office_code=office, period_start=day, status="submitted",
                                 submitted_at=latest.entered_at, submitted_by=latest.entered_by,
                                 note=latest.note or "", created_at=min(e.entered_at for e in items),
                                 updated_at=latest.entered_at)
            for e in items:
                if e.column_key in field_id:
                    sub.values.append(FormValue(field_id=field_id[e.column_key], value_num=float(e.value),
                                                entered_by_user_id=e.entered_by_user_id, entered_by=e.entered_by,
                                                entered_at=e.entered_at))
                    n_values += 1
            s.add(sub)
        s.flush()
        summary = {"form_id": form.id, "campaign": c.slug, "submissions": len(grouped), "values": n_values,
                   "sum": sum(e.value for e in entries if e.column_key in field_id)}
        audit.record(s, ACTOR, "form.migrate", "form", form.id, after=summary)
        report["forms"].append(summary)
    return report


def migrate_if_needed(s: Session) -> dict[str, Any] | None:
    if not needed(s):
        return None
    report = migrate(s)
    s.commit()
    return report
