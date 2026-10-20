"""Facebook normalisers (Apify Facebook Posts Scraper, Bright Data Pages Posts).

Stable ID: the Facebook post ID. Video/reel IDs and URL forms are recorded as aliases so a reel
returned both as a feed post and as a /reel/ URL is stored once."""
from __future__ import annotations

import re
from typing import Any, Optional

from app.normalize.model import NormalizedPublication, metric
from app.timeutil import from_unix, parse_iso

_VIDEO_ID_RE = re.compile(r"facebook\.com/(?:[^?#]*/)?(?:reel|videos|watch/?\?v=)/?(\d+)")


def _video_aliases(*urls: str | None) -> list[str]:
    out = []
    for u in urls:
        m = _VIDEO_ID_RE.search(u or "")
        if m:
            out.append(f"video:{m.group(1)}")
    return out


def _content_type_from(url: str, media_types: list[str]) -> str:
    if "/reel/" in (url or ""):
        return "reel"
    types = {t.lower() for t in media_types if t}
    if "video" in types or "/videos/" in (url or ""):
        return "video"
    if len([t for t in media_types if t]) > 1:
        return "carousel"
    if "photo" in types or "image" in types:
        return "photo"
    return "text" if not types else "post"


def from_apify(item: dict[str, Any], provider: str = "apify") -> Optional[NormalizedPublication]:
    if item.get("error"):
        return None
    post_id = str(item.get("postId") or "").strip()
    published = parse_iso(item.get("time")) if item.get("time") else from_unix(item.get("timestamp"))
    if not post_id or not published:
        return None
    media_items = item.get("media") or []
    media, media_types, aliases = [], [], []
    for m in media_items:
        typename = m.get("__typename") or ""
        media_types.append(typename)
        url = (m.get("photo_image") or {}).get("uri") or m.get("thumbnail") or m.get("url")
        media.append({"kind": typename.lower() or "unknown", "url": url, "id": m.get("id"),
                      "ocr_text": m.get("ocrText")})
        if typename.lower() == "video" and m.get("id"):
            aliases.append(f"video:{m['id']}")
    url = item.get("url") or item.get("topLevelUrl") or ""
    aliases += [f"url:{u}" for u in {item.get("url"), item.get("topLevelUrl")} if u]
    aliases += _video_aliases(item.get("url"), item.get("topLevelUrl"))
    return NormalizedPublication(
        platform="facebook",
        provider=provider,
        platform_post_id=post_id,
        author_handle=item.get("pageName") or (item.get("user") or {}).get("name") or "",
        url=url,
        published_at_utc=published,
        text=item.get("text") or "",
        content_type=_content_type_from(url, media_types),
        media=media,
        metrics={
            "reactions": metric(item.get("likes")),
            "comments": metric(item.get("comments")),
            "shares": metric(item.get("shares")),
            "views": metric(item.get("viewsCount")),
        },
        attributes={"link": item.get("link"), "facebook_url": item.get("facebookUrl"),
                    "top_reactions": metric(item.get("topReactionsCount"))},
        aliases=sorted(set(aliases)),
    )


def from_brightdata(item: dict[str, Any], provider: str = "brightdata") -> Optional[NormalizedPublication]:
    if item.get("error") or item.get("error_code"):
        return None
    post_id = str(item.get("post_id") or "").strip()
    published = parse_iso(item.get("date_posted")) if isinstance(item.get("date_posted"), str) \
        else from_unix(item.get("date_posted"))
    if not post_id or not published:
        return None
    media, media_types, aliases = [], [], []
    for a in item.get("attachments") or []:
        t = a.get("type") or ""
        media_types.append(t)
        media.append({"kind": t.lower() or "unknown", "url": a.get("url") or a.get("video_url"),
                      "id": a.get("id")})
        if t.lower() == "video" and a.get("id"):
            aliases.append(f"video:{a['id']}")
    url = item.get("url") or ""
    if url:
        aliases.append(f"url:{url}")
    aliases += _video_aliases(url)
    post_type = (item.get("post_type") or "").lower()
    ctype = _content_type_from(url, media_types)
    if post_type == "reel":
        ctype = "reel"
    return NormalizedPublication(
        platform="facebook",
        provider=provider,
        platform_post_id=post_id,
        author_handle=item.get("page_name") or item.get("user_username_raw") or "",
        url=url,
        published_at_utc=published,
        text=item.get("content") or "",
        content_type=ctype,
        is_repost=bool(item.get("original_post")),
        media=media,
        metrics={
            "reactions": metric(item.get("likes")),
            "comments": metric(item.get("num_comments")),
            "shares": metric(item.get("num_shares")),
            "views": metric(item.get("video_view_count")),
            "plays": metric(item.get("play_count")),
        },
        attributes={"hashtags": item.get("hashtags") or [], "post_type": item.get("post_type")},
        aliases=sorted(set(aliases)),
    )
