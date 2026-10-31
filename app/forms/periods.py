"""Reporting periods of a form, identified by their first day (period_start).

  daily   one period per day from start_date
  weekly  seven-day periods starting on start_date (start_date, +7, +14, …)
  once    a single period from start_date to end_date (or just start_date)

A period is due once its first day has arrived in IST; periods never run past end_date. The deadline is
deadline_hours after the period's last day ends (00:00 IST the next day), e.g. 18 = 18:00 the next day.

Entry closes for offices when the period's last day ends (11:59 PM IST); after that only the state office (admin)
changes the figures — see entry_closes and app.forms.service.editable."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Optional

from app.timeutil import IST, to_utc_naive, today_ist

FREQUENCIES = ("daily", "weekly", "once")
MAX_PERIODS = 400


def _step(freq: str) -> int:
    return 7 if freq == "weekly" else 1


def period_end(form, ps: date) -> date:
    if form.frequency == "weekly":
        end = ps + timedelta(days=6)
    elif form.frequency == "once":
        end = form.end_date or ps
    else:
        end = ps
    return min(end, form.end_date) if form.end_date and form.frequency != "once" else end


def is_period_start(form, d: date) -> bool:
    if d < form.start_date or (form.end_date and d > form.end_date):
        return False
    if form.frequency == "once":
        return d == form.start_date
    return (d - form.start_date).days % _step(form.frequency) == 0


def period_containing(form, d: date) -> Optional[date]:
    """The period_start of the period that includes day d (None outside the schedule)."""
    if d < form.start_date or (form.end_date and d > form.end_date):
        return None
    if form.frequency == "once":
        return form.start_date
    step = _step(form.frequency)
    return form.start_date + timedelta(days=((d - form.start_date).days // step) * step)


def periods(form, start: Optional[date] = None, end: Optional[date] = None,
            today: Optional[date] = None) -> list[date]:
    """Due period starts within [start, end] (both optional), oldest first, at most MAX_PERIODS (the newest)."""
    today = today or today_ist()
    last = min(x for x in (end, form.end_date, today) if x is not None)
    if form.frequency == "once":
        ps = form.start_date
        return [ps] if ps <= last and (start is None or ps >= start) else []
    step = _step(form.frequency)
    first = form.start_date
    if start and start > last:
        return []
    if start and start > first:
        first = period_containing(form, start) or first
        if first < start:
            first += timedelta(days=step)
    if first > last:
        return []
    n = (last - first).days // step + 1
    skip = max(0, n - MAX_PERIODS)
    return [first + timedelta(days=(i + skip) * step) for i in range(n - skip)]


def is_due(form, ps: date, today: Optional[date] = None) -> bool:
    return is_period_start(form, ps) and ps <= (today or today_ist())


def deadline(form, ps: date) -> Optional[datetime]:
    """Naive-UTC instant after which the period is late; None when the form sets no deadline."""
    if form.deadline_hours is None:
        return None
    end_of_period = datetime.combine(period_end(form, ps) + timedelta(days=1), time(0), tzinfo=IST)
    return to_utc_naive(end_of_period + timedelta(hours=form.deadline_hours))


def entry_closes(form, ps: date) -> datetime:
    """Naive-UTC instant offices stop editing the period: the end of its last day (23:59 IST, i.e. 00:00 IST next)."""
    return to_utc_naive(datetime.combine(period_end(form, ps) + timedelta(days=1), time(0), tzinfo=IST))


def label(form, ps: date) -> str:
    end = period_end(form, ps)
    return ps.isoformat() if end == ps else f"{ps.isoformat()} – {end.isoformat()}"
