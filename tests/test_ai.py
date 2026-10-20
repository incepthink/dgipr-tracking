"""The AI brief and ask box: numbers only ever come from code. A brief with a stray digit or an unknown fact id is
rejected for the template; the ask validator rejects bad params and out-of-scope offices. No live API calls."""
from __future__ import annotations

import json
from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy import select

from app.ai import ask, brief
from app.ai.client import AIClient, AIUnavailable
from app.auth import visible_office_codes
from app.forms.service import save
from app.models import AnalyticsBrief, AuditLog, User
from app.timeutil import today_ist


def _settings(settings, **kw):
    settings.openai_api_key, settings.openai_model = "sk-test", "test-model"
    for k, v in kw.items():
        setattr(settings, k, v)
    return settings


def _client(settings, payload, seen=None, status=200):
    def handler(req: httpx.Request):
        if seen is not None:
            seen.append(json.loads(req.content))
        return httpx.Response(status, json={"output": [{"type": "message", "content": [
            {"type": "output_text", "text": json.dumps(payload, ensure_ascii=False)}]}],
            "usage": {"input_tokens": 120, "output_tokens": 40, "total_tokens": 160}})
    return AIClient(settings, httpx.Client(transport=httpx.MockTransport(handler)))


def offices(session, role="state", **kw):
    return visible_office_codes(session, User(username="u", password_hash="", role=role, **kw))


@pytest.fixture()
def recent(session, drought_form):
    """A few reported days ending yesterday (IST), so the latest due period is yesterday."""
    y = today_ist() - timedelta(days=1)
    drought_form.start_date = y - timedelta(days=20)
    for i in range(10):
        d = y - timedelta(days=i)
        save(session, None, drought_form, "pune", d, {"facebook": 3, "news": 2}, check=False, actor="t", submit=True)
        if i % 2:
            save(session, None, drought_form, "satara", d, {"facebook": 1}, check=False, actor="t", submit=True)
    session.flush()
    return y


def test_facts_and_template(session, drought_form, recent):
    day, facts = brief.build_facts(session, drought_form, offices(session))
    assert day == recent.isoformat()
    ids = [f["id"] for f in facts]
    assert ids == [f"f{i + 1}" for i in range(len(facts))]
    by = {f["hint"]: f for f in facts}
    assert by["offices that reported for that period"]["value"] == 1
    assert by["offices expected"]["value"] == 43
    t = brief.template(facts)
    assert "४३ पैकी 1" not in t and "43 पैकी 1 कार्यालयांनी" in t
    assert "Not yet received" in brief.template(facts, "en")


def test_check_rejects_stray_digits_and_unknown_ids():
    facts = [{"id": "f1", "text": "12"}, {"id": "f2", "text": "x"}]
    assert brief.check(["{f1} कार्यालयांनी अहवाल पाठवला."], facts) is None
    assert "digit" in brief.check(["{f1} पैकी 43 कार्यालये"], facts)
    assert "digit" in brief.check(["४ कार्यालये"], facts)  # Devanagari digits too
    assert "unknown" in brief.check(["{f9} कार्यालये"], facts)
    assert brief.check([], facts) == "empty brief"
    assert "malformed" in brief.check(["{fx} कार्यालये"], facts) and brief.check(["{f1 कार्यालये"], facts)
    assert brief.fill(["{f1} आणि {f2}."], facts) == "12 आणि x."


def test_brief_ai_path_fills_numbers_and_caches(session, settings, drought_form, recent):
    st = _settings(settings)
    seen: list = []
    ok = {"sentences": ["{f1} साठी {f3} पैकी {f2} कार्यालयांनी अहवाल पाठवला.", "उर्वरित कार्यालयांचा पाठपुरावा करावा."]}
    out = brief.brief(session, st, drought_form, offices(session), "state", "admin", client=_client(st, ok, seen))
    assert out["source"] == "ai" and "43 पैकी 1 कार्यालयांनी" in out["text"] and "{" not in out["text"]
    sent = seen[0]
    assert sent["model"] == "test-model" and sent["text"]["format"]["type"] == "json_schema"
    assert "facts" in sent["input"][1]["content"]
    log = session.scalar(select(AuditLog).where(AuditLog.action == "ai.call"))
    assert log.after["input_tokens"] == 120 and log.after["ok"]
    # cached: no second call
    again = brief.brief(session, st, drought_form, offices(session), "state", "admin", client=_client(st, {}, seen))
    assert again["text"] == out["text"] and len(seen) == 1
    assert session.scalar(select(AnalyticsBrief).where(AnalyticsBrief.scope == "state")).source == "ai"


@pytest.mark.parametrize("bad", [{"sentences": ["आज 5 कार्यालयांनी अहवाल पाठवला."]},
                                 {"sentences": ["{f99} कार्यालयांनी अहवाल पाठवला."]}])
def test_brief_rejected_uses_template(session, settings, drought_form, recent, bad):
    st = _settings(settings)
    out = brief.brief(session, st, drought_form, offices(session), "state", "admin", client=_client(st, bad))
    assert out["source"] == "template" and out["reason"]
    assert out["text"] == brief.template(out["facts"])


def test_brief_without_key_or_over_cap(session, settings, drought_form, recent):
    out = brief.brief(session, settings, drought_form, offices(session), "state", "admin")
    assert out["source"] == "template" and "OPENAI" in out["reason"] and not out["ai_configured"]
    st = _settings(settings, ai_daily_call_limit=0)
    with pytest.raises(AIUnavailable, match="limit"):
        _client(st, {}).json(session, "a", "p", system="s", user="u", schema={}, name="n")


def test_brief_http_error_falls_back(session, settings, drought_form, recent):
    st = _settings(settings)
    out = brief.brief(session, st, drought_form, offices(session), "division:pune", "admin",
                      client=_client(st, {}, status=401))
    assert out["source"] == "template"
    log = session.scalar(select(AuditLog).where(AuditLog.action == "ai.call"))
    assert log.after["ok"] is False and log.note


# --------------------------------------------------------------------------- ask
def test_validator(session, drought_form):
    cat = ask.catalogue(session, drought_form, offices(session, "zone", division_code="pune"))
    assert ask.validate("top", {"field": "facebook", "level": "division"}, cat) == \
        {"range": "last7", "field": "facebook", "level": "division"}
    assert ask.validate("trend", {"office": "Satara"}, cat)["office"] == "satara"  # name resolves to the code
    for intent, params in [("top", {"field": "nope"}), ("top", {"level": "planet"}), ("totals", {"range": "forever"}),
                           ("office_summary", {"office": "nashik"}),   # outside the zone
                           ("office_summary", {}), ("compare", {"offices": ["pune"]}), ("drop_tables", {}),
                           ("not_reported", {"division": "nashik"}), ("top", {"group": "radio"})]:
        with pytest.raises(ask.AskError):
            ask.validate(intent, params, cat)


def test_ask_runs_intents_in_scope(session, settings, drought_form, recent):
    offs = offices(session)
    r = ask.ask(session, settings, drought_form, offs, "admin", intent="not_reported", params={"range": "latest"})
    assert r["kind"] == "table" and r["summary"] == {"sent": 1, "offices": 43} and len(r["rows"]) == 42
    r = ask.ask(session, settings, drought_form, offs, "admin", intent="top",
                params={"field": "facebook", "level": "office", "range": "last7"})
    assert r["rows"][0]["name_en"] == "Pune" and r["rows"][0]["per_day"] == 3
    r = ask.ask(session, settings, drought_form, offs, "admin", intent="trend", params={"office": "pune", "field": "news"})
    assert r["kind"] == "series" and r["points"][-1]["value"] == 2
    r = ask.ask(session, settings, drought_form, offs, "admin", intent="compare",
                params={"offices": ["pune", "satara"], "field": "facebook", "range": "last14"})
    assert [x["name_en"] for x in r["rows"]] == ["Pune", "Satara"]
    r = ask.ask(session, settings, drought_form, offs, "admin", intent="totals", params={"range": "whole"})
    assert next(x for x in r["rows"] if x["name_en"] == "Facebook")["total"] == 35
    r = ask.ask(session, settings, drought_form, offs, "admin", intent="improved",
                params={"group": "social", "level": "division"})
    assert r["kind"] == "table"


def test_ask_via_model_and_unsupported(session, settings, drought_form, recent):
    st = _settings(settings)
    offs = offices(session, "zone", division_code="nashik")
    pick = {"intent": "top", "params": {"range": "last7", "division": None, "field": "facebook", "group": None,
                                        "level": "office", "office": None, "offices": None}}
    r = ask.ask(session, st, drought_form, offs, "z", question="फेसबुकवर सर्वाधिक कोण?", client=_client(st, pick))
    assert r["intent"] == "top" and all(x["name_en"] != "Pune" for x in r["rows"])  # pune is outside the zone
    out_of_scope = {**pick, "intent": "office_summary", "params": {**pick["params"], "office": "pune"}}
    r = ask.ask(session, st, drought_form, offs, "z", question="पुण्याचा आढावा", client=_client(st, out_of_scope))
    assert r["intent"] == "unsupported" and r["suggestions"]
    r = ask.ask(session, st, drought_form, offs, "z", question="हवामान कसे आहे?",
                client=_client(st, {"intent": "unsupported", "params": pick["params"]}))
    assert r["intent"] == "unsupported"
    r = ask.ask(session, settings.__class__(**{**settings.__dict__, "openai_api_key": ""}), drought_form, offs, "z",
                question="काहीही")
    assert r["intent"] == "unsupported" and "OPENAI" in r["reason"]
    assert date.fromisoformat(ask.date_range(drought_form, "last7")[1].isoformat()) == recent
