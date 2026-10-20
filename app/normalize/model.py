"""Provider-independent publication model produced by every normaliser."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

# Metric keys used across platforms. A missing/unavailable metric is None — never 0.
METRIC_KEYS = ("likes", "comments", "shares", "views", "plays", "reposts", "quotes", "bookmarks", "reactions")

CONTENT_TYPES = ("post", "photo", "carousel", "video", "reel", "short", "live", "upcoming_live", "text", "link")


def metric(value: Any) -> Optional[int]:
    """Coerce a provider metric to int, keeping 'unknown' as None. Negative sentinels
    (e.g. Instagram -1 for hidden likes) are unknown, not zero."""
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


@dataclass
class NormalizedPublication:
    platform: str
    provider: str
    platform_post_id: str                 # stable ID on the platform (not provider-specific)
    author_handle: str
    url: str                              # canonical publication URL
    published_at_utc: datetime            # naive UTC
    text: str = ""
    title: str = ""
    description: str = ""
    content_type: str = "post"
    is_repost: bool = False
    is_reply: bool = False
    is_quote: bool = False
    is_pinned: Optional[bool] = None
    is_short: Optional[bool] = None
    media: list[dict[str, Any]] = field(default_factory=list)
    metrics: dict[str, Optional[int]] = field(default_factory=dict)
    attributes: dict[str, Any] = field(default_factory=dict)
    aliases: list[str] = field(default_factory=list)  # other keys identifying the same publication

    def classification_text(self) -> str:
        return "\n".join(p for p in (self.title, self.text, self.description) if p)
