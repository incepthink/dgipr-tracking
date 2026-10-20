"""YouTube normaliser (YouTube Data API v3 `videos` resource, optionally with its playlistItem).

The Data API has no field identifying Shorts, so `is_short` stays None (unknown). A
`possible_short` attribute (duration <= 180 s, not a live stream) is recorded as a hint only."""
from __future__ import annotations

import re
from typing import Any, Optional

from app.normalize.model import NormalizedPublication, metric
from app.timeutil import parse_iso

_DUR_RE = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$")


def iso_duration_seconds(value: str | None) -> Optional[int]:
    m = _DUR_RE.match(value or "")
    if not m:
        return None
    d, h, mi, s = (int(x) if x else 0 for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + s


def from_data_api(payload: dict[str, Any], provider: str = "youtube_data_api") -> Optional[NormalizedPublication]:
    video = payload.get("video") or {}
    pitem = payload.get("playlistItem") or {}
    vid = video.get("id") or (pitem.get("contentDetails") or {}).get("videoId")
    snippet = video.get("snippet") or pitem.get("snippet") or {}
    status = video.get("status") or pitem.get("status") or {}
    if not vid or status.get("privacyStatus") in ("private", "privacyStatusUnspecified"):
        return None
    published = parse_iso(snippet.get("publishedAt") or (pitem.get("contentDetails") or {}).get("videoPublishedAt"))
    if not published:
        return None
    stats = video.get("statistics") or {}
    details = video.get("contentDetails") or {}
    live = video.get("liveStreamingDetails")
    broadcast = snippet.get("liveBroadcastContent") or "none"
    duration = iso_duration_seconds(details.get("duration"))
    if broadcast == "upcoming":
        ctype = "upcoming_live"
    elif live or broadcast == "live":
        ctype = "live"
    else:
        ctype = "video"
    if live and live.get("actualStartTime"):
        # For streams, publishedAt can be the scheduling time; prefer the actual start.
        published = parse_iso(live["actualStartTime"]) or published
    thumb = ((snippet.get("thumbnails") or {}).get("high") or {}).get("url")
    return NormalizedPublication(
        platform="youtube",
        provider=provider,
        platform_post_id=vid,
        author_handle=snippet.get("channelTitle") or "",
        url=f"https://www.youtube.com/watch?v={vid}",
        published_at_utc=published,
        title=snippet.get("title") or "",
        description=snippet.get("description") or "",
        content_type=ctype,
        is_short=None,
        media=[{"kind": "thumbnail", "url": thumb}] if thumb else [],
        metrics={
            "views": metric(stats.get("viewCount")),
            "likes": metric(stats.get("likeCount")),
            "comments": metric(stats.get("commentCount")),
        },
        attributes={
            "tags": snippet.get("tags") or [],
            "duration_s": duration,
            "possible_short": (duration is not None and duration <= 180 and ctype == "video"),
            "live_broadcast_content": broadcast,
            "channel_id": snippet.get("channelId"),
        },
        aliases=[f"shorts_url:https://www.youtube.com/shorts/{vid}"],
    )
