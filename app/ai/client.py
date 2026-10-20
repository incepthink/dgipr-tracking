"""OpenAI Responses API with structured (JSON-schema) output, for the analytics brief and the ask box.

One call = one JSON object matching the schema the caller passes. Every call is written to the audit log with its
token counts (action "ai.call"), and a daily cap across all users (AI_DAILY_CALL_LIMIT) is checked first against
those entries. Tests pass an httpx.Client on a MockTransport; nothing here retries more than the shared wrapper."""
from __future__ import annotations

import json
from datetime import datetime, time
from typing import Any, Optional

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import audit
from app.models import AuditLog
from app.providers.base import ProviderError
from app.providers.http import HttpClient
from app.settings import Settings
from app.timeutil import IST, to_utc_naive, today_ist


class AIUnavailable(RuntimeError):
    """No key / model, over the daily cap, or the call failed; the caller uses its fallback."""


def configured(settings: Settings) -> bool:
    return bool(settings.openai_api_key and settings.openai_model)


def calls_today(s: Session) -> int:
    since = to_utc_naive(datetime.combine(today_ist(), time(0), tzinfo=IST))
    return s.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "ai.call", AuditLog.at >= since)) or 0


class AIClient:
    def __init__(self, settings: Settings, client: Optional[httpx.Client] = None):
        self.settings = settings
        self.http = HttpClient(client, max_retries=min(settings.http_max_retries, 2),
                               timeout=settings.http_timeout_seconds)

    def json(self, s: Session, actor: str, purpose: str, *, system: str, user: str, schema: dict[str, Any],
             name: str) -> dict[str, Any]:
        st = self.settings
        if not configured(st):
            raise AIUnavailable("no OPENAI_API_KEY / OPENAI_MODEL")
        if calls_today(s) >= st.ai_daily_call_limit:
            raise AIUnavailable("daily AI call limit reached")
        body = {"model": st.openai_model,
                "input": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "text": {"format": {"type": "json_schema", "name": name, "schema": schema, "strict": True}}}
        usage: dict[str, Any] = {}
        error = ""
        try:
            resp = self.http.request("POST", st.openai_base_url.rstrip("/") + "/responses", json=body,
                                     headers={"Authorization": f"Bearer {st.openai_api_key}"})
            data = resp.json()
            usage = data.get("usage") or {}
            out = json.loads(_output_text(data))
            if not isinstance(out, dict):
                raise ValueError("model output is not an object")
            return out
        except (ProviderError, ValueError, KeyError, json.JSONDecodeError) as exc:
            error = f"{type(exc).__name__}: {exc}"[:500]
            raise AIUnavailable(error) from exc
        finally:
            audit.record(s, actor, "ai.call", "ai", purpose,
                         after={"model": st.openai_model, "input_tokens": usage.get("input_tokens"),
                                "output_tokens": usage.get("output_tokens"),
                                "total_tokens": usage.get("total_tokens"), "ok": not error},
                         note=error)


def _output_text(data: dict[str, Any]) -> str:
    if isinstance(data.get("output_text"), str):
        return data["output_text"]
    for item in data.get("output") or []:
        for c in item.get("content") or []:
            if c.get("type") == "output_text" and isinstance(c.get("text"), str):
                return c["text"]
            if c.get("type") == "refusal":
                raise ValueError("model refused")
    raise ValueError("no output text")
