"""Explicit, configurable rules for which publication types count toward report columns."""
from __future__ import annotations

from typing import Any

DEFAULT_COUNT_RULES: dict[str, Any] = {
    "include_reposts": False,
    "include_replies": False,
    "include_quotes": True,
    "include_reels": True,
    "include_shorts": True,
    "include_live": True,
    "include_upcoming": False,
    "video_bites_source": "manual",
    "video_interviews_source": "manual",
}


def effective_rules(rules: dict[str, Any] | None) -> dict[str, Any]:
    return {**DEFAULT_COUNT_RULES, **(rules or {})}


def countable(pub: Any, rules: dict[str, Any] | None) -> tuple[bool, str]:
    """Return (counts, reason). `pub` is a Publication (or anything with the same attributes)."""
    r = effective_rules(rules)
    if pub.is_repost and not r["include_reposts"]:
        return False, "repost excluded by count rules"
    if pub.is_reply and not r["include_replies"]:
        return False, "reply excluded by count rules"
    if pub.is_quote and not r["include_quotes"]:
        return False, "quote post excluded by count rules"
    ctype = pub.content_type
    if ctype == "reel" and not r["include_reels"]:
        return False, "reel excluded by count rules"
    if ctype == "live" and not r["include_live"]:
        return False, "live stream excluded by count rules"
    if ctype == "upcoming_live" and not r["include_upcoming"]:
        return False, "scheduled/upcoming stream excluded by count rules"
    if pub.platform == "youtube" and not r["include_shorts"]:
        if pub.is_short:
            return False, "Short excluded by count rules"
        if pub.is_short is None and (pub.attributes or {}).get("possible_short"):
            return False, "possible Short (≤180 s) excluded by count rules — verify manually"
    return True, "counts"
