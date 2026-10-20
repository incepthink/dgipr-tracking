"""The ask box: a question in Marathi or English becomes one intent from a fixed catalogue, with validated params,
which code then answers from the insights / analytics functions under the asker's own scope.

The model only picks the intent and fills params (field keys, office and division codes, a named range); it never
writes SQL and never produces a number. A question outside the catalogue, a param outside the asker's scope or an
unavailable model all end in "unsupported" with suggested questions. Suggestions carry their intent, so clicking
one works without a model."""
from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.ai.client import AIClient, AIUnavailable
from app.forms import analytics, insights
from app.forms.periods import periods
from app.forms.schema import sum_fields
from app.forms.service import _office_meta
from app.models import Form
from app.settings import Settings
from app.timeutil import today_ist

INTENTS = ("not_reported", "top", "improved", "trend", "compare", "totals", "office_summary")
RANGES = ("latest", "last7", "last14", "last30", "whole")
LEVELS = ("office", "division")


class AskError(ValueError):
    """A param that fails validation: unknown field, out-of-scope office, bad range."""


SUGGESTIONS = [
    {"mr": "काल कोणत्या कार्यालयांनी अहवाल पाठवला नाही?", "en": "Which offices didn't report for the latest day?",
     "intent": "not_reported", "params": {"range": "latest"}},
    {"mr": "समाज माध्यमांवर कोणत्या विभागात सर्वाधिक सुधारणा झाली?", "en": "Which division improved most on social media?",
     "intent": "improved", "params": {"group": "social", "level": "division", "range": "last7"}},
    {"mr": "मागील ७ दिवसांत फेसबुकवर सर्वाधिक पोस्ट कोणाच्या?", "en": "Who posted most on Facebook in the last 7 days?",
     "intent": "top", "params": {"field": "facebook", "level": "office", "range": "last7"}},
    {"mr": "मागील ७ दिवसांची एकूण आकडेवारी", "en": "Totals for the last 7 days",
     "intent": "totals", "params": {"range": "last7"}},
]

SYSTEM = ("You map a question about a government publicity report to exactly one intent from a fixed catalogue. "
          "Use only the field keys, group keys, office codes and division codes listed. If the question does not "
          "fit any intent, answer intent \"unsupported\". Never answer the question yourself.\n"
          "Intents:\n"
          "- not_reported(range, division): offices that did not send their report\n"
          "- top(field|group, level, range): highest average per reported day\n"
          "- improved(field|group, level, range): biggest rise vs the period before\n"
          "- trend(field|group, office): day-by-day figures for one office or everyone (office null)\n"
          "- compare(offices, field|group, range): side-by-side figures for 2-6 offices\n"
          "- totals(range, division): totals per field\n"
          "- office_summary(office, range): one office's reporting and figures\n"
          "range: latest (the most recent day; 'yesterday', 'today', 'काल', 'आज'), last7, last14, last30, whole. "
          "level: office (district) or division (विभाग).")

_NULLABLE_STR = {"type": ["string", "null"]}
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["intent", "params"], "properties": {
    "intent": {"type": "string", "enum": [*INTENTS, "unsupported"]},
    "params": {"type": "object", "additionalProperties": False,
               "required": ["range", "division", "field", "group", "level", "office", "offices"],
               "properties": {"range": {"type": ["string", "null"], "enum": [*RANGES, None]},
                              "division": _NULLABLE_STR, "field": _NULLABLE_STR,
                              "group": {"type": ["string", "null"], "enum": [*insights.GROUPS, None]},
                              "level": {"type": ["string", "null"], "enum": [*LEVELS, None]},
                              "office": _NULLABLE_STR,
                              "offices": {"type": ["array", "null"], "items": {"type": "string"}}}}}}


# --------------------------------------------------------------------------- catalogue + validation
def catalogue(s: Session, form: Form, offices: list[str]) -> dict[str, Any]:
    meta = _office_meta(s, offices)
    divs: dict[str, str] = {}
    for o, d in meta:
        divs[d.code] = d.summary_label_mr
    return {"fields": {f.key: f"{f.label_mr} / {f.label_en}" for f in sum_fields(form)},
            "groups": {g: insights.GROUP_LABELS[g] for g in insights.GROUPS
                       if any(insights.group_of(f) == g for f in sum_fields(form))},
            "offices": {o.code: f"{o.name_mr} / {o.name_en}" for o, _ in meta},
            "divisions": divs}


def _resolve(code: Optional[str], allowed: dict[str, str], what: str) -> Optional[str]:
    if code in (None, ""):
        return None
    if code in allowed:
        return code
    norm = str(code).strip().lower()
    for k, label in allowed.items():
        if norm in [p.strip().lower() for p in label.split("/")]:
            return k
    raise AskError(f"{what} {code!r} is not one you can see")


def validate(intent: str, params: dict[str, Any], cat: dict[str, Any]) -> dict[str, Any]:
    """Clean params for `intent`, or AskError. Offices and divisions must be inside the asker's scope."""
    if intent not in INTENTS:
        raise AskError(f"unknown intent {intent!r}")
    p = {k: v for k, v in (params or {}).items() if v not in (None, "", [])}
    out: dict[str, Any] = {}
    rng = p.get("range") or ("latest" if intent == "not_reported" else "last7")
    if rng not in RANGES:
        raise AskError(f"unknown range {rng!r}")
    out["range"] = rng
    if p.get("field"):
        out["field"] = _resolve(p["field"], cat["fields"], "field")
    elif p.get("group"):
        if p["group"] not in cat["groups"]:
            raise AskError(f"unknown group {p['group']!r}")
        out["group"] = p["group"]
    if intent in ("top", "improved"):
        lvl = p.get("level") or "office"
        if lvl not in LEVELS:
            raise AskError(f"unknown level {lvl!r}")
        out["level"] = lvl
    if p.get("division") and intent in ("not_reported", "totals", "top", "improved"):
        out["division"] = _resolve(p["division"], cat["divisions"], "division")
    if intent in ("trend", "office_summary") and p.get("office"):
        out["office"] = _resolve(p["office"], cat["offices"], "office")
    if intent == "office_summary" and not out.get("office"):
        raise AskError("which office?")
    if intent == "compare":
        offs = [_resolve(x, cat["offices"], "office") for x in (p.get("offices") or [])]
        offs = list(dict.fromkeys(o for o in offs if o))
        if not 2 <= len(offs) <= 6:
            raise AskError("compare needs 2 to 6 offices")
        out["offices"] = offs
    return out


def date_range(form: Form, rng: str, today: Optional[date] = None) -> tuple[date, date]:
    end = insights.latest_due(form, today or today_ist()) or form.start_date
    if rng == "latest":
        return end, end
    if rng == "whole":
        return form.start_date, end
    n = {"last7": 7, "last14": 14, "last30": 30}[rng]
    ps = periods(form, end=end)[-n:]
    return (ps[0] if ps else end), end


# --------------------------------------------------------------------------- answering
def _cols(*spec: tuple[str, str, str, bool]) -> list[dict[str, Any]]:
    return [{"key": k, "label_mr": mr, "label_en": en, "num": num} for k, mr, en, num in spec]


NAME = ("name", "कार्यालय", "Office", False)


def run(s: Session, form: Form, offices: list[str], intent: str, p: dict[str, Any]) -> dict[str, Any]:
    start, end = date_range(form, p["range"])
    if p.get("division"):
        div_codes = {o.code for o, d in _office_meta(s, offices) if d.code == p["division"]}
        offices = [o for o in offices if o in div_codes]
    column, group = p.get("field", ""), p.get("group", "")
    base = {"intent": intent, "params": p, "start": start.isoformat(), "end": end.isoformat()}

    if intent == "not_reported":
        if start == end:
            att = insights.attention(s, form, offices, start, end)
            rows = [{"name_mr": x["name_mr"], "name_en": x["name_en"], "division_mr": x["division_mr"],
                     "status": x.get("status", "none")} for x in att["missing"]]
            return {**base, "kind": "table", "summary": {"sent": att["sent"], "offices": att["offices"]},
                    "columns": _cols(NAME, ("division_mr", "विभाग", "Division", False)), "rows": rows}
        m = insights.office_map(s, form, offices, start, end)
        rows = [{"name_mr": r["name_mr"], "name_en": r["name_en"], "division_mr": r["division_mr"],
                 "missed": r["due"] - r["sent"], "due": r["due"]} for r in m["rows"] if r["due"] > r["sent"]]
        rows.sort(key=lambda r: -r["missed"])
        return {**base, "kind": "table", "columns": _cols(NAME, ("division_mr", "विभाग", "Division", False),
                                                          ("missed", "न पाठवलेले दिवस", "Days missed", True),
                                                          ("due", "अपेक्षित दिवस", "Days due", True)), "rows": rows}

    if intent in ("top", "improved"):
        mv = insights.movers(s, form, offices, start, end, column, group, p["level"])
        if intent == "top":
            rows = [{"name_mr": r["name_mr"], "name_en": r["name_en"], "per_day": r["per_day"], "total": r["total"],
                     "sent": r["sent"], "due": r["due"]} for r in mv["top"]]
            cols = _cols(NAME, ("per_day", "प्रति दिवस सरासरी", "Per day", True), ("total", "एकूण", "Total", True),
                         ("sent", "पाठवलेले दिवस", "Days sent", True))
        else:
            rows = [{"name_mr": r["name_mr"], "name_en": r["name_en"], "per_day": r["per_day"],
                     "previous_per_day": r["previous_per_day"], "delta_pct": r["delta_pct"]} for r in mv["improved"]]
            cols = _cols(NAME, ("per_day", "प्रति दिवस सरासरी", "Per day", True),
                         ("previous_per_day", "आधी", "Before", True), ("delta_pct", "बदल %", "Change %", True))
        return {**base, "kind": "table", "columns": cols, "rows": rows, "comparable": mv["comparable"]}

    if intent == "trend":
        scope = [p["office"]] if p.get("office") else offices
        keys = [f.key for f in insights._fields(form, column, group)]
        ser = analytics.series(s, form, scope, start if p["range"] != "latest" else start - timedelta(days=13), end)
        pts = [{"date": x["date"], "value": sum(x["values"][k] for k in keys), "reported": x["entered_cells"] > 0}
               for x in ser]
        return {**base, "kind": "series", "points": pts}

    if intent in ("compare", "office_summary"):
        scope = p["offices"] if intent == "compare" else [p["office"]]
        m = insights.office_map(s, form, scope, start, end, column, group)
        rows = [{"name_mr": r["name_mr"], "name_en": r["name_en"], "total": r["total"], "per_day": r["per_day"],
                 "sent": r["sent"], "due": r["due"], "pct": r["pct"]} for r in m["rows"]]
        return {**base, "kind": "table", "columns": _cols(
            NAME, ("total", "एकूण", "Total", True), ("per_day", "प्रति दिवस सरासरी", "Per day", True),
            ("sent", "पाठवलेले दिवस", "Days sent", True), ("pct", "अहवाल %", "Reporting %", True)), "rows": rows}

    # totals
    t = analytics.totals(s, form, offices, start, end)
    rows = [{"name_mr": f.label_mr, "name_en": f.label_en, "total": t[f.key]} for f in sum_fields(form)]
    return {**base, "kind": "table", "columns": _cols(("name", "रकाना", "Field", False), ("total", "एकूण", "Total", True)),
            "rows": rows}


def suggestions(cat: dict[str, Any]) -> list[dict[str, Any]]:
    """The fixed questions that make sense for this form (e.g. no Facebook question without a facebook field)."""
    out = []
    for x in SUGGESTIONS:
        try:
            validate(x["intent"], x["params"], cat)
        except AskError:
            continue
        out.append(x)
    return out


def unsupported(cat: dict[str, Any], reason: str = "") -> dict[str, Any]:
    return {"intent": "unsupported", "reason": reason, "suggestions": suggestions(cat)}


def ask(s: Session, settings: Settings, form: Form, offices: list[str], actor: str, question: str = "",
        intent: str = "", params: Optional[dict[str, Any]] = None, client: Optional[AIClient] = None) -> dict[str, Any]:
    cat = catalogue(s, form, offices)
    if not intent:
        question = (question or "").strip()[:500]
        if not question:
            return unsupported(cat, "empty question")
        try:
            res = (client or AIClient(settings)).json(
                s, actor, f"ask:{form.id}", system=SYSTEM, name="intent", schema=SCHEMA,
                user=json.dumps({"catalogue": cat, "question": question}, ensure_ascii=False))
        except AIUnavailable as exc:
            return unsupported(cat, f"ai: {exc}")
        intent, params = res.get("intent", ""), res.get("params") or {}
        if intent == "unsupported":
            return unsupported(cat, "outside the catalogue")
    try:
        p = validate(intent, params or {}, cat)
    except AskError as exc:
        return unsupported(cat, str(exc))
    return {**run(s, form, offices, intent, p), "question": question}
