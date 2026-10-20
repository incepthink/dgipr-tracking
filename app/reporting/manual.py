"""Manual report inputs (columns without an automated source). Every change is audited."""
from __future__ import annotations

from datetime import date
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.models import ManualInput, Office
from app.reporting.columns import COLUMN_KEYS
from app.timeutil import utcnow


class ManualInputError(ValueError):
    pass


def set_manual_value(session: Session, *, campaign_id: Optional[int], start: date, end: date, office_code: str,
                     column_key: str, value: Optional[int], confirm_zero: bool, actor: str,
                     note: str = "") -> Optional[ManualInput]:
    """value None clears the entry (cell becomes 'missing' again). Zero is accepted only with
    confirm_zero=True so an untouched field can never be mistaken for a confirmed zero."""
    if column_key not in COLUMN_KEYS:
        raise ManualInputError(f"unknown column {column_key}")
    if session.get(Office, office_code) is None:
        raise ManualInputError(f"unknown office {office_code}")
    if value is not None and value < 0:
        raise ManualInputError("value cannot be negative")
    if value == 0 and not confirm_zero:
        raise ManualInputError("zero must be explicitly confirmed")
    row = session.scalar(select(ManualInput).where(
        ManualInput.campaign_id == campaign_id, ManualInput.period_start == start, ManualInput.period_end == end,
        ManualInput.office_code == office_code, ManualInput.column_key == column_key))
    before = {"value": row.value, "confirmed_zero": row.confirmed_zero, "note": row.note} if row else None
    if value is None:
        if row:
            session.delete(row)
            audit.record(session, actor, "manual_input.clear", "manual_input",
                         f"{campaign_id}:{start}:{end}:{office_code}:{column_key}", before=before, note=note)
        return None
    if row is None:
        row = ManualInput(campaign_id=campaign_id, period_start=start, period_end=end, office_code=office_code,
                          column_key=column_key, value=value, entered_by=actor)
        session.add(row)
    row.value = value
    row.confirmed_zero = value == 0
    row.note = note or ""
    row.entered_by = actor
    row.entered_at = utcnow()
    session.flush()
    audit.record(session, actor, "manual_input.set", "manual_input",
                 f"{campaign_id}:{start}:{end}:{office_code}:{column_key}", before=before,
                 after={"value": value, "confirmed_zero": row.confirmed_zero, "note": row.note}, note=note)
    return row
