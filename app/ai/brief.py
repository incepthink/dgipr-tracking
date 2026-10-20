"""The analytics page's daily brief: four or five plain sentences on what changed and what needs attention.

  1. Code builds the facts (insights.attention / groups / movers), each {id, hint, value, fmt}.
  2. The model writes the sentences and refers to numbers only as {f3}.
  3. The brief is rejected if it has any digit outside a placeholder or a placeholder that is not a fact; on
     rejection, no key, an error or the daily cap, a template brief written from the same facts is used.
  4. Code substitutes the real values.

The brief covers the last 7 periods up to the latest due one, whatever range the page shows, and is cached per
(form, latest due period, scope, language) in analytics_briefs."""
from __future__ import annotations

import json
import re
from datetime import date
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.client import AIClient, AIUnavailable, configured
from app.forms import insights
from app.forms.periods import periods
from app.models import AnalyticsBrief, Form
from app.reporting.marathi import long_date
from app.settings import Settings
from app.timeutil import today_ist, utcnow

GROUP_MR = {"print": "मुद्रित माध्यमे", "video": "व्हिडिओ", "social": "समाज माध्यमे", "other": "इतर"}
GROUP_EN = {"print": "print", "video": "video", "social": "social media", "other": "other"}
DIGITS = re.compile(r"[0-9०-९]")
PLACEHOLDER = re.compile(r"\{(f\d+)\}")
MAX_CHARS = 1500

SCHEMA = {"type": "object", "additionalProperties": False, "required": ["sentences"],
          "properties": {"sentences": {"type": "array", "items": {"type": "string"}}}}

SYSTEM = {
    "mr": ("तुम्ही महाराष्ट्र शासनाच्या माहिती व जनसंपर्क महासंचालनालयासाठी (DGIPR) दैनंदिन आढावा लिहिता. "
           "दिलेल्या तथ्यांवरून ४ ते ५ सोपी, औपचारिक मराठी वाक्ये लिहा: आधी काय लक्ष देण्याजोगे आहे, मग काय बदलले. "
           "कोणताही अंक, संख्या, टक्केवारी किंवा तारीख स्वतः लिहू नका — प्रत्येक आकड्यासाठी फक्त {f1} असे तथ्याचे "
           "चिन्ह वापरा. दिलेल्या तथ्यांबाहेरचे काहीही लिहू नका, अंदाज किंवा कारणे सांगू नका."),
    "en": ("You write the daily brief for Maharashtra's Directorate General of Information and Public Relations "
           "(DGIPR). From the facts given, write 4-5 plain, formal English sentences: first what needs attention, "
           "then what changed. Never write a digit, number, percentage or date yourself — refer to every figure "
           "only by its fact placeholder such as {f1}. Say nothing beyond the facts; no guesses or causes."),
}


# --------------------------------------------------------------------------- facts
def _fmt(v: Any, fmt: str) -> str:
    if fmt == "pct":
        return f"{'+' if v > 0 else '−' if v < 0 else ''}{abs(round(v)):,}%"
    if fmt == "num":
        return f"{v:,.0f}" if float(v).is_integer() else f"{v:,.1f}"
    return str(v)


def build_facts(s: Session, form: Form, offices: list[str], lang: str = "mr") -> tuple[Optional[str], list[dict]]:
    """(latest due period, facts). Names come in `lang`; values are what the placeholders become."""
    d = insights.latest_due(form, today_ist())
    if d is None:
        return None, []
    ps = periods(form, end=d)[-7:]
    start = ps[0] if ps else d
    att = insights.attention(s, form, offices, start, d)
    day = d.isoformat()
    nm = (lambda x: x["name_en"] or x["name_mr"]) if lang == "en" else (lambda x: x["name_mr"])
    facts: list[dict[str, Any]] = []

    def add(hint: str, value: Any, fmt: str = "num") -> None:
        facts.append({"id": f"f{len(facts) + 1}", "hint": hint, "value": value, "fmt": fmt,
                      "text": _fmt(value, fmt)})

    add("period: the latest period whose deadline has passed", long_date(d) if lang == "mr" else d.strftime("%d %b"),
        "text")
    add("offices that reported for that period", att["sent"])
    add("offices expected", att["offices"])
    missing = att["missing"]
    if missing:
        add("offices that did not report for that period", len(missing))
        add("names of up to five offices that did not report", ", ".join(nm(x) for x in missing[:5]), "text")
    if att["streaks"]:
        top = att["streaks"][0]
        add("office with the longest run of consecutive missed periods", nm(top), "text")
        add("length of that run, in periods", top["value"])
        add("offices missing two or more periods in a row", len(att["streaks"]))
    if att["spikes"]:
        sp = att["spikes"][0]
        label = next((f.label_en if lang == "en" else f.label_mr for f in form.fields if f.key == sp["field"]),
                     sp["field"])
        add("unusually high figures to check (≥3× the office's usual)", len(att["spikes"]))
        add("office with the largest jump", nm(sp), "text")
        add("field of that jump", label, "text")
        add("the figure entered", sp["value"])
        add("that office's usual (median) figure", sp["expected"])
    if att["repeats"]:
        add("offices whose figures are identical to the previous period", len(att["repeats"]))
    if att["corrections"]:
        add("figures corrected by the state office in the last seven periods", len(att["corrections"]))
    g = insights.groups(s, form, offices, start, d)
    names = GROUP_EN if lang == "en" else GROUP_MR
    for row in g["groups"]:
        add(f"total for {GROUP_EN[row['key']]} over the last seven periods ({names[row['key']]})", row["total"])
        if g["comparable"] and row["delta_pct"] is not None:
            add(f"change in {GROUP_EN[row['key']]} vs the seven periods before", row["delta_pct"], "pct")
    level = "office" if len({o for o in offices}) <= 12 else "division"
    try:
        mv = insights.movers(s, form, offices, start, d, group="social", level=level, limit=1)
    except ValueError:
        mv = None
    if mv and mv["top"]:
        add(f"{level} with the highest social-media average per reported period", nm(mv["top"][0]), "text")
        add("that average", mv["top"][0]["per_day"])
    if mv and mv["improved"]:
        add(f"{level} that improved most on social media (per reported period)", nm(mv["improved"][0]), "text")
        if mv["improved"][0]["delta_pct"] is not None:
            add("its change", mv["improved"][0]["delta_pct"], "pct")
    return day, facts


# --------------------------------------------------------------------------- check + fill
def check(sentences: list[str], facts: list[dict]) -> Optional[str]:
    """None when the model's text is acceptable, otherwise why not."""
    ids = {f["id"] for f in facts}
    if not sentences or not all(isinstance(x, str) and x.strip() for x in sentences):
        return "empty brief"
    text = " ".join(sentences)
    if len(text) > MAX_CHARS:
        return "brief too long"
    unknown = sorted(set(PLACEHOLDER.findall(text)) - ids)
    if unknown:
        return f"unknown fact id(s): {', '.join(unknown)}"
    stray = DIGITS.search(PLACEHOLDER.sub("", text))
    if stray:
        return f"digit outside a fact: {stray.group(0)!r}"
    if re.search(r"[{}]", PLACEHOLDER.sub("", text)):
        return "malformed placeholder"
    return None


def fill(sentences: list[str], facts: list[dict]) -> str:
    by = {f["id"]: f["text"] for f in facts}
    return " ".join(PLACEHOLDER.sub(lambda m: by[m.group(1)], x.strip()) for x in sentences)


def template(facts: list[dict], lang: str = "mr") -> str:
    """The brief without a model: the same facts in fixed sentences."""
    get = lambda key: next((x["text"] for x in facts if x["hint"].startswith(key)), None)  # noqa: E731
    out = []
    if lang == "en":
        out.append(f"For {get('period')}, {get('offices that reported')} of {get('offices expected')} offices have reported.")
        if get("names of up to five"):
            out.append(f"Not yet received: {get('names of up to five')}.")
        if get("office with the longest run"):
            out.append(f"{get('office with the longest run')} has missed {get('length of that run')} periods in a row.")
        if get("unusually high"):
            out.append(f"{get('unusually high')} unusual figure(s) to check; the largest is {get('office with the largest jump')}"
                       f" ({get('field of that jump')}: {get('the figure entered')} against a usual {get('that office')}).")
        for x in facts:
            if x["hint"].startswith("change in social media"):
                out.append(f"Social media is {x['text']} on the previous seven periods.")
        if get("office that improved most") or get("division that improved most"):
            out.append(f"Most improved on social media: {get('office that improved most') or get('division that improved most')}.")
    else:
        out.append(f"{get('period')} साठी {get('offices expected')} पैकी {get('offices that reported')} कार्यालयांनी अहवाल पाठवला आहे.")
        if get("names of up to five"):
            out.append(f"अहवाल न आलेली कार्यालये: {get('names of up to five')}.")
        if get("office with the longest run"):
            out.append(f"{get('office with the longest run')} कार्यालयाचा अहवाल सलग {get('length of that run')} वेळा आलेला नाही.")
        if get("unusually high"):
            out.append(f"{get('unusually high')} असामान्य आकडे तपासायचे आहेत; सर्वात मोठा {get('office with the largest jump')} "
                       f"({get('field of that jump')}: नेहमीच्या {get('that office')} ऐवजी {get('the figure entered')}).")
        for x in facts:
            if x["hint"].startswith("change in social media"):
                out.append(f"समाज माध्यमांवरील प्रसिद्धी मागील सात दिवसांच्या तुलनेत {x['text']} आहे.")
        if get("office that improved most") or get("division that improved most"):
            out.append(f"समाज माध्यमांवर सर्वाधिक सुधारणा: {get('office that improved most') or get('division that improved most')}.")
    return " ".join(out[:5])


# --------------------------------------------------------------------------- entry point
def brief(s: Session, settings: Settings, form: Form, offices: list[str], scope: str, actor: str, lang: str = "mr",
          refresh: bool = False, client: Optional[AIClient] = None) -> dict[str, Any]:
    lang = "en" if lang == "en" else "mr"
    day, facts = build_facts(s, form, offices, lang)
    if day is None:
        return {"period": None, "text": "", "source": "none", "facts": [], "ai_configured": configured(settings)}
    d = date.fromisoformat(day)
    row = s.scalar(select(AnalyticsBrief).where(AnalyticsBrief.form_id == form.id, AnalyticsBrief.day == d,
                                                AnalyticsBrief.scope == scope, AnalyticsBrief.lang == lang))
    if row is not None and not refresh:
        return _out(row, settings)
    text, source, reason = "", "template", ""
    try:
        res = (client or AIClient(settings)).json(
            s, actor, f"brief:{form.id}:{scope}:{day}", system=SYSTEM[lang], name="brief", schema=SCHEMA,
            user=json.dumps({"facts": [{"id": x["id"], "meaning": x["hint"], "value": x["text"]} for x in facts]},
                            ensure_ascii=False))
        sentences = res.get("sentences") or []
        reason = check(sentences, facts) or ""
        if not reason:
            text, source = fill(sentences, facts), "ai"
    except AIUnavailable as exc:
        reason = str(exc)
    if source != "ai":
        text = template(facts, lang)
    if row is None:
        row = AnalyticsBrief(form_id=form.id, day=d, scope=scope, lang=lang, text=text)
        s.add(row)
    row.text, row.source, row.facts, row.reason, row.created_at = text, source, facts, reason, utcnow()
    s.flush()
    return _out(row, settings)


def _out(row: AnalyticsBrief, settings: Settings) -> dict[str, Any]:
    return {"period": row.day.isoformat(), "text": row.text, "source": row.source, "facts": row.facts,
            "reason": row.reason if row.source != "ai" else "", "created_at": row.created_at.isoformat() + "Z",
            "ai_configured": configured(settings)}
