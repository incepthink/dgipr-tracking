"""Asia/Kolkata reporting-date boundaries."""
from __future__ import annotations

from datetime import date, datetime

import pytest

from app.reporting.marathi import period_label
from app.timeutil import fetch_window_utc, period_bounds_utc, reporting_date


def test_reporting_date_boundaries_at_ist_midnight():
    # 2026-10-12 00:00 IST == 2026-10-11 18:30 UTC
    assert reporting_date(datetime(2026, 10, 11, 18, 29, 59)) == date(2026, 10, 11)
    assert reporting_date(datetime(2026, 10, 11, 18, 30, 0)) == date(2026, 10, 12)
    assert reporting_date(datetime(2026, 10, 12, 18, 29, 59)) == date(2026, 10, 12)
    assert reporting_date(datetime(2026, 10, 12, 18, 30, 0)) == date(2026, 10, 13)


def test_period_bounds_are_half_open_ist_days():
    lo, hi = period_bounds_utc(date(2026, 10, 12), date(2026, 10, 14))
    assert lo == datetime(2026, 10, 11, 18, 30) and hi == datetime(2026, 10, 14, 18, 30)
    with pytest.raises(ValueError):
        period_bounds_utc(date(2026, 10, 12), date(2026, 10, 11))


def test_fetch_window_adds_overlap_and_caps_at_now():
    lo, hi = fetch_window_utc(date(2026, 10, 12), date(2026, 10, 12), 6, now=datetime(2026, 10, 15))
    assert lo == datetime(2026, 10, 11, 12, 30) and hi == datetime(2026, 10, 13, 0, 30)
    _, hi2 = fetch_window_utc(date(2026, 10, 12), date(2026, 10, 12), 6, now=datetime(2026, 10, 12, 10))
    assert hi2 == datetime(2026, 10, 12, 10)


def test_marathi_period_labels():
    assert period_label(date(2026, 10, 12), date(2026, 10, 12)) == "१२ ऑक्टोबर २०२६"
    assert period_label(date(2026, 10, 10), date(2026, 10, 12)) == "१० ते १२ ऑक्टोबर २०२६"
    assert period_label(date(2026, 9, 28), date(2026, 10, 2)) == "२८ सप्टेंबर ते २ ऑक्टोबर २०२६"
    assert period_label(date(2025, 12, 30), date(2026, 1, 2)) == "३० डिसेंबर २०२५ ते २ जानेवारी २०२६"
