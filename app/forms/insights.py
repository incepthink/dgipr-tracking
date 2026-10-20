"""Exceptions-first analytics over a form: what needs attention, group totals, a per-office map, fair rankings
and the office × period heatmap. Definitions are in docs/analytics.md; every screen (Analytics, Desk, My numbers)
and the AI brief read them from here so they agree.

Same contract as app.forms.analytics: each function takes the office codes the caller may see
(app.forms.service.scope) and a date range, and only counted periods (service.COUNTED) carry values. A period
nobody sent is "not reported", never zero; a typed 0 is a confirmed zero.

  reported   a counted submission (submitted / accepted / returned) exists for the office-period
  due        the period's deadline has passed (no deadline: the period has ended), or it was reported anyway
  per day    a total divided by the periods the office reported, so a late starter is not ranked below
             someone who simply sent more days"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import median
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.forms import analytics
from app.forms.periods import deadline, period_end, periods
from app.forms.schema import sum_fields
from app.forms.service import COUNTED, _num_out, _office_meta
from app.models import Form, FormField, FormSubmission
from app.timeutil import today_ist, utcnow

GROUPS = ("print", "video", "social", "other")
GROUP_LABELS = {"print": "मुद्रित माध्यमे / print", "video": "व्हिडिओ / video", "social": "समाज माध्यमे / social media",
                "other": "इतर / other"}
SPIKE_RATIO = 3          # value ≥ 3 × the office's usual (median) …
SPIKE_MIN_EXCESS = 10    # … and at least 10 above it, so 1 → 3 is not a spike
SPIKE_HISTORY = 14       # usual = median of the office's last 14 reported periods
SPIKE_MIN_HISTORY = 3
STREAK_LOOKBACK = 30
STREAK_MIN = 2
IMPROVED_MIN_SHARE = 0.5  # "most improved" only among offices that reported ≥ half their due periods, both times


# --------------------------------------------------------------------------- loading
def group_of(f: FormField) -> str:
    return f.group if f.group in GROUPS else "other"


def _fields(form: Form, column: str = "", group: str = "") -> list[FormField]:
    cols = sum_fields(form)
    if column:
        cols = [f for f in cols if f.key == column]
        if not cols:
            raise ValueError(f"unknown column {column}")
    elif group:
        cols = [f for f in cols if group_of(f) == group]
        if not cols:
            raise ValueError(f"unknown group {group}")
    return cols


class Grid:
    """Every submission of [start, end] for the offices: status per office-period and counted values by key."""

    def __init__(self, s: Session, form: Form, offices: list[str], start: date, end: date):
        self.form = form
        self.periods = periods(form, start, end)
        self.offices = offices
        self.fields = sum_fields(form)
        keys = {f.id: f for f in self.fields}
        self.status: dict[tuple[str, date], str] = {}
        self.values: dict[tuple[str, date], dict[str, float]] = {}
        self.corrections: list[dict[str, Any]] = []
        subs = s.scalars(select(FormSubmission).options(selectinload(FormSubmission.values)).where(
            FormSubmission.form_id == form.id, FormSubmission.office_code.in_(offices or ["-"]),
            FormSubmission.period_start.in_(self.periods or [date.min]))).all()
        for sub in subs:
            k = (sub.office_code, sub.period_start)
            self.status[k] = sub.status
            if sub.status not in COUNTED:
                continue
            vals: dict[str, float] = {}
            for v in sub.values:
                f = keys.get(v.field_id)
                if f is None or v.value_num is None:
                    continue
                vals[f.key] = _num_out(f, v.value_num)
                if v.corrected_at is not None:
                    self.corrections.append({"office": sub.office_code, "date": sub.period_start, "field": f.key,
                                             "value": vals[f.key], "expected": _num_out(f, v.original_value_num),
                                             "by": v.corrected_by, "note": v.correction_note,
                                             "at": v.corrected_at})
            self.values[k] = vals

    def reported(self, office: str, ps: date) -> bool:
        return self.status.get((office, ps)) in COUNTED

    def total(self, office: str, ps: date, keys: list[str]) -> Optional[float]:
        """Sum of `keys` for one office-period; None when nothing of it was entered."""
        vals = self.values.get((office, ps))
        if not vals:
            return None
        got = [vals[k] for k in keys if k in vals]
        return _clean(sum(got)) if got else None


def _clean(v: float):
    return int(v) if float(v).is_integer() else round(v, 2)


def is_due(form: Form, ps: date, now: Optional[datetime] = None, today: Optional[date] = None) -> bool:
    dl = deadline(form, ps)
    if dl is not None:
        return (now or utcnow()) >= dl
    return period_end(form, ps) < (today or today_ist())


def latest_due(form: Form, end: date, now: Optional[datetime] = None) -> Optional[date]:
    """The newest period up to `end` whose deadline has passed (none passed yet: the newest started one)."""
    ps_list = periods(form, end=end)
    for ps in reversed(ps_list[-8:]):
        if is_due(form, ps, now):
            return ps
    return ps_list[-1] if ps_list else None


def previous_range(start: date, end: date) -> tuple[date, date]:
    n = (end - start).days + 1
    p_end = start - timedelta(days=1)
    return p_end - timedelta(days=n - 1), p_end


def _meta(s: Session, offices: list[str]) -> list[dict[str, Any]]:
    return [{"code": o.code, "name_mr": o.name_mr, "name_en": o.name_en, "kind": o.kind, "division": d.code,
             "division_mr": d.summary_label_mr} for o, d in _office_meta(s, offices)]


def _pct(now: Optional[float], prev: Optional[float]) -> Optional[float]:
    if now is None or prev is None or not prev:
        return None
    return round(100 * (now - prev) / prev, 1)


# --------------------------------------------------------------------------- attention
def spike_of(value: Optional[float], history: list[float]) -> Optional[float]:
    """The usual (median) value when `value` is a spike against `history` (oldest first), else None."""
    if value is None:
        return None
    hist = history[-SPIKE_HISTORY:]
    if len(hist) < SPIKE_MIN_HISTORY:
        return None
    usual = median(hist)
    if value >= SPIKE_RATIO * usual and value - usual >= SPIKE_MIN_EXCESS:
        return _clean(usual)
    return None


def attention(s: Session, form: Form, offices: list[str], start: date, end: date,
              now: Optional[datetime] = None) -> dict[str, Any]:
    """What needs looking at for the latest due period up to `end`: offices missing, miss streaks, spikes,
    repeated rows; plus admin corrections within [start, end]. Every item: {kind, office, date, field, value,
    expected, link}."""
    now = now or utcnow()
    day = latest_due(form, end, now)
    meta = {m["code"]: m for m in _meta(s, offices)}
    out: dict[str, Any] = {"period": day.isoformat() if day else None, "offices": len(offices), "sent": 0,
                           "missing": [], "streaks": [], "spikes": [], "repeats": [], "corrections": []}
    if day is None:
        return out
    look_start = max(form.start_date, day - timedelta(days=STREAK_LOOKBACK * (7 if form.frequency == "weekly" else 1)))
    g = Grid(s, form, offices, look_start, day)
    ps_list = [p for p in g.periods if p <= day]
    keys = [f.key for f in g.fields]

    def item(kind: str, code: str, ps: date, **kw) -> dict[str, Any]:
        m = meta.get(code, {})
        return {"kind": kind, "office": code, "name_mr": m.get("name_mr", code), "name_en": m.get("name_en", ""),
                "division_mr": m.get("division_mr", ""), "date": ps.isoformat(), "field": kw.get("field"),
                "value": kw.get("value"), "expected": kw.get("expected"),
                "link": f"/forms/responses?form={form.id}&day={ps.isoformat()}", **{k: v for k, v in kw.items()
                                                                                  if k not in ("field", "value", "expected")}}

    for code in meta:
        if g.reported(code, day):
            out["sent"] += 1
        else:
            out["missing"].append(item("missing", code, day, status=g.status.get((code, day), "none")))
        # streak: consecutive unreported periods ending at `day`
        n = 0
        for ps in reversed(ps_list):
            if g.reported(code, ps):
                break
            n += 1
        if n >= STREAK_MIN:
            out["streaks"].append(item("streak", code, day, value=n, since=ps_list[-n].isoformat(),
                                       ever=any(g.reported(code, p) for p in ps_list)))
        if not g.reported(code, day):
            continue
        # spikes: field by field against the office's own usual
        vals = g.values.get((code, day), {})
        best = None
        for k in keys:
            hist = [g.values[(code, p)][k] for p in ps_list if p < day and k in g.values.get((code, p), {})]
            usual = spike_of(vals.get(k), hist)
            if usual is not None:
                ratio = vals[k] / usual if usual else None
                if best is None or (ratio or 1e9) > (best["ratio"] or 1e9):
                    best = {"field": k, "value": vals[k], "expected": usual, "ratio": round(ratio, 1) if ratio else None}
        if best:
            out["spikes"].append(item("spike", code, day, **best))
        # repeats: the whole row equals the previous period's, and is not all zeros
        prev = ps_list[-2] if len(ps_list) >= 2 else None
        pv = g.values.get((code, prev)) if prev else None
        if pv and vals and len(vals) >= 2 and vals == pv and any(vals.values()):
            out["repeats"].append(item("repeat", code, day, value=sum(vals.values()), previous=prev.isoformat()))
    out["streaks"].sort(key=lambda x: -x["value"])
    out["spikes"].sort(key=lambda x: -(x["ratio"] or 0))
    # corrections within the selected range (not just the latest period)
    cg = Grid(s, form, offices, start, end)
    for c in sorted(cg.corrections, key=lambda c: c["at"], reverse=True):
        out["corrections"].append(item("correction", c["office"], c["date"], field=c["field"], value=c["value"],
                                       expected=c["expected"], by=c["by"], note=c["note"]))
    return out


# --------------------------------------------------------------------------- groups
def groups(s: Session, form: Form, offices: list[str], start: date, end: date) -> dict[str, Any]:
    """Totals per field group (print / video / social / other) for the range and the one before it, each with a
    per-period series for a sparkline. `comparable` is false when the previous range starts before the form."""
    p_start, p_end = previous_range(start, end)
    cur = analytics.series(s, form, offices, start, end)
    prev_tot = analytics.totals(s, form, offices, p_start, p_end)
    by: dict[str, list[FormField]] = defaultdict(list)
    for f in sum_fields(form):
        by[group_of(f)].append(f)
    rows = []
    for g in GROUPS:
        fs = by.get(g)
        if not fs:
            continue
        ks = [f.key for f in fs]
        series = [{"date": p["date"], "value": _clean(sum(p["values"][k] for k in ks)),
                   "reported": p["entered_cells"] > 0} for p in cur]
        total = _clean(sum(x["value"] for x in series))
        previous = _clean(sum(prev_tot[k] for k in ks))
        rows.append({"key": g, "fields": ks, "total": total, "previous": previous, "delta_pct": _pct(total, previous),
                     "series": series})
    return {"start": start.isoformat(), "end": end.isoformat(), "previous": {"start": p_start.isoformat(),
            "end": p_end.isoformat()}, "comparable": p_start >= form.start_date, "groups": rows}


# --------------------------------------------------------------------------- per office
def _office_stats(g: Grid, code: str, keys: list[str], now: datetime) -> dict[str, Any]:
    due = sent = 0
    total = 0.0
    entered = 0
    series = []
    for ps in g.periods:
        rep = g.reported(code, ps)
        if rep or is_due(g.form, ps, now):
            due += 1
        if rep:
            sent += 1
        v = g.total(code, ps, keys)
        if v is not None:
            total += v
            entered += 1
        series.append(v)
    return {"due": due, "sent": sent, "pct": round(100 * sent / due, 1) if due else None,
            "total": _clean(total), "entered": entered, "per_day": round(total / sent, 2) if sent else None,
            "series": series}


def office_map(s: Session, form: Form, offices: list[str], start: date, end: date, column: str = "",
               group: str = "", now: Optional[datetime] = None) -> dict[str, Any]:
    """One row per office: reporting % (sent / due), the chosen field's (or group's, or all fields') total,
    per-reported-day average, change vs the previous range, the latest period's status and a series."""
    now = now or utcnow()
    keys = [f.key for f in _fields(form, column, group)]
    p_start, p_end = previous_range(start, end)
    comparable = p_start >= form.start_date
    g = Grid(s, form, offices, start, end)
    pg = Grid(s, form, offices, p_start, p_end) if comparable else None
    last = latest_due(form, end, now)
    rows = []
    for m in _meta(s, offices):
        st = _office_stats(g, m["code"], keys, now)
        prev = _office_stats(pg, m["code"], keys, now) if pg else None
        latest = g.status.get((m["code"], last), "none") if last else "none"
        rows.append({**m, **st, "previous": prev["total"] if prev else None,
                     "previous_per_day": prev["per_day"] if prev else None,
                     "delta_pct": _pct(st["per_day"], prev["per_day"]) if prev else None,
                     "latest": latest, "latest_reported": latest in COUNTED})
    return {"start": start.isoformat(), "end": end.isoformat(), "periods": [p.isoformat() for p in g.periods],
            "latest": last.isoformat() if last else None, "column": column, "group": group, "fields": keys,
            "comparable": comparable, "rows": rows}


# --------------------------------------------------------------------------- movers
def _level_stats(s: Session, g: Grid, offices: list[str], keys: list[str], level: str,
                 now: datetime) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for m in _meta(s, offices):
        st = _office_stats(g, m["code"], keys, now)
        code = m["division"] if level == "division" else m["code"]
        r = out.setdefault(code, {"code": code, "name_mr": m["division_mr"] if level == "division" else m["name_mr"],
                                  "name_en": code.replace("_", " ").title() if level == "division" else m["name_en"],
                                  "division_mr": m["division_mr"], "due": 0, "sent": 0, "total": 0.0})
        r["due"] += st["due"]
        r["sent"] += st["sent"]
        r["total"] += st["total"]
    for r in out.values():
        r["total"] = _clean(r["total"])
        r["per_day"] = round(r["total"] / r["sent"], 2) if r["sent"] else None
        r["share_reported"] = round(r["sent"] / r["due"], 3) if r["due"] else None
    return out


def movers(s: Session, form: Form, offices: list[str], start: date, end: date, column: str = "", group: str = "",
           level: str = "office", now: Optional[datetime] = None, limit: int = 10) -> dict[str, Any]:
    """Two lists that are always shown together. top: by average per reported period. improved: change in that
    average vs the previous range, only for offices (divisions) that reported at least half their due periods in
    both ranges, so one good day after a silent week is not "most improved"."""
    if level not in ("office", "division"):
        raise ValueError("level must be office or division")
    now = now or utcnow()
    keys = [f.key for f in _fields(form, column, group)]
    p_start, p_end = previous_range(start, end)
    comparable = p_start >= form.start_date
    cur = _level_stats(s, Grid(s, form, offices, start, end), offices, keys, level, now)
    prev = _level_stats(s, Grid(s, form, offices, p_start, p_end), offices, keys, level, now) if comparable else {}
    top = sorted((r for r in cur.values() if r["per_day"] is not None),
                 key=lambda r: (-r["per_day"], r["name_en"]))
    improved = []
    for code, r in cur.items():
        p = prev.get(code)
        if not p or r["per_day"] is None or p["per_day"] is None:
            continue
        if (r["share_reported"] or 0) < IMPROVED_MIN_SHARE or (p["share_reported"] or 0) < IMPROVED_MIN_SHARE:
            continue
        change = r["per_day"] - p["per_day"]
        improved.append({**r, "previous_per_day": p["per_day"], "change": round(change, 2),
                         "delta_pct": _pct(r["per_day"], p["per_day"])})
    improved.sort(key=lambda r: (-(r["change"] / max(r["previous_per_day"], 1)), -r["change"], r["name_en"]))
    improved = [r for r in improved if r["change"] > 0]
    return {"start": start.isoformat(), "end": end.isoformat(), "level": level, "column": column, "group": group,
            "fields": keys, "comparable": comparable, "previous": {"start": p_start.isoformat(), "end": p_end.isoformat()},
            "top": top[:limit], "improved": improved[:limit], "eligible_share": IMPROVED_MIN_SHARE}


# --------------------------------------------------------------------------- heatmap
def heatmap(s: Session, form: Form, offices: list[str], start: date, end: date, column: str = "",
            group: str = "", now: Optional[datetime] = None) -> dict[str, Any]:
    """Offices × periods: {status, late, filled, total} per cell (from service.compliance), the total being the
    chosen column's (or all fields') sum for that cell, None when nothing was entered."""
    from app.forms.service import compliance
    now = now or utcnow()
    keys = [f.key for f in _fields(form, column, group)]
    comp = compliance(s, form, offices, start, end)
    g = Grid(s, form, offices, start, end)
    ps_list = [date.fromisoformat(p) for p in comp["periods"]]
    for r in comp["rows"]:
        for ps, c in zip(ps_list, r["cells"]):
            c["total"] = g.total(r["code"], ps, keys)
            c["due"] = c["status"] in COUNTED or is_due(form, ps, now)
    return {"start": start.isoformat(), "end": end.isoformat(), "column": column, "group": group, **comp}


# --------------------------------------------------------------------------- district peers
def peer_average(s: Session, form: Form, peers: list[str], start: date, end: date) -> dict[str, Any]:
    """Average per reported period, per field, across `peers` (a district office's own division). Only the
    average is returned, never another office's figures."""
    g = Grid(s, form, peers, start, end)
    sent = sum(1 for o in peers for ps in g.periods if g.reported(o, ps))
    tot = analytics.totals(s, form, peers, start, end)
    return {"offices": len(peers), "periods_reported": sent,
            "per_day": {k: (round(v / sent, 2) if sent else None) for k, v in tot.items()}}
