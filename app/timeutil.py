"""Time handling. All instants are stored as naive UTC datetimes; reporting dates are
calendar dates in Asia/Kolkata."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_utc_naive(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def as_aware_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def reporting_date(published_at_utc: datetime) -> date:
    """Calendar date in Asia/Kolkata for a UTC instant."""
    return as_aware_utc(published_at_utc).astimezone(IST).date()


def period_bounds_utc(start: date, end: date) -> tuple[datetime, datetime]:
    """[start 00:00 IST, (end+1) 00:00 IST) expressed as naive UTC — half-open interval."""
    if end < start:
        raise ValueError("period end is before period start")
    lo = datetime.combine(start, time(0), tzinfo=IST)
    hi = datetime.combine(end + timedelta(days=1), time(0), tzinfo=IST)
    return to_utc_naive(lo), to_utc_naive(hi)


def fetch_window_utc(start: date, end: date, overlap_hours: int, now: datetime | None = None) -> tuple[datetime, datetime]:
    """Retrieval window: the reporting period widened by `overlap_hours` on each side
    (capped at now), so publications near the boundaries or indexed late are not missed."""
    lo, hi = period_bounds_utc(start, end)
    now = now or utcnow()
    return lo - timedelta(hours=overlap_hours), min(hi + timedelta(hours=overlap_hours), now)


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    v = value.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(v)
    return to_utc_naive(dt) if dt.tzinfo else dt


def from_unix(ts: float | int | str | None) -> datetime | None:
    if ts in (None, ""):
        return None
    return datetime.fromtimestamp(float(ts), tz=timezone.utc).replace(tzinfo=None)


def today_ist(now: datetime | None = None) -> date:
    return as_aware_utc(now or utcnow()).astimezone(IST).date()
