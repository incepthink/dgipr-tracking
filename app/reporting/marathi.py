from __future__ import annotations

from datetime import date, datetime

DIGITS = str.maketrans("0123456789", "०१२३४५६७८९")
MONTHS = ("जानेवारी", "फेब्रुवारी", "मार्च", "एप्रिल", "मे", "जून", "जुलै", "ऑगस्ट", "सप्टेंबर", "ऑक्टोबर",
          "नोव्हेंबर", "डिसेंबर")


def num(value: int | str | None) -> str:
    return "" if value is None else str(value).translate(DIGITS)


def long_date(d: date) -> str:
    """१२ ऑक्टोबर २०२६"""
    return f"{num(d.day)} {MONTHS[d.month - 1]} {num(d.year)}"


def period_label(start: date, end: date) -> str:
    """Single day: '१२ ऑक्टोबर २०२६'. Range: '१० ते १२ ऑक्टोबर २०२६' / '२८ सप्टेंबर ते २ ऑक्टोबर २०२६' /
    '२८ डिसेंबर २०२५ ते २ जानेवारी २०२६'."""
    if start == end:
        return long_date(start)
    if start.year != end.year:
        return f"{long_date(start)} ते {long_date(end)}"
    if start.month != end.month:
        return f"{num(start.day)} {MONTHS[start.month - 1]} ते {long_date(end)}"
    return f"{num(start.day)} ते {long_date(end)}"


def short_datetime(dt: datetime) -> str:
    """दि. १३/१०/२०२६, १५:१०"""
    return num(dt.strftime("%d/%m/%Y, %H:%M"))
