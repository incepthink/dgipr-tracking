"""Instagram normalisers (Apify Instagram Scraper, Bright Data Instagram Posts).

The stable platform ID is the post *shortcode* — it is the identifier in the public URL and is the
same whichever provider or endpoint (posts feed vs. reels tab) returned the item."""
from __future__ import annotations

import re
from typing import Any, Optional

from app.normalize.model import NormalizedPublication, metric
from app.timeutil import from_unix, parse_iso

_SHORTCODE_RE = re.compile(r"instagram\.com/(?:[^/]+/)?(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)")


def shortcode_from_url(url: str | None) -> Optional[str]:
    m = _SHORTCODE_RE.search(url or "")
    return m.group(1) if m else None


def canonical_url(shortcode: str) -> str:
    return f"https://www.instagram.com/p/{shortcode}/"


def _content_type(type_: str | None, product_type: str | None) -> str:
    pt = (product_type or "").lower()
    t = (type_ or "").lower()
    if pt == "clips" or t == "reel":
        return "reel"
    if pt == "carousel_container" or t in ("sidecar", "carousel"):
        return "carousel"
    if t == "video":
        return "video"
    if t in ("image", "photo"):
        return "photo"
    return "post"


def from_apify(item: dict[str, Any], provider: str = "apify") -> Optional[NormalizedPublication]:
    if item.get("error"):
        return None
    shortcode = item.get("shortCode") or shortcode_from_url(item.get("url"))
    published = parse_iso(item.get("timestamp"))
    if not shortcode or not published:
        return None
    media: list[dict[str, Any]] = []
    if item.get("displayUrl"):
        media.append({"kind": "image", "url": item["displayUrl"]})
    if item.get("videoUrl"):
        media.append({"kind": "video", "url": item["videoUrl"], "duration_s": item.get("videoDuration")})
    for child in item.get("childPosts") or []:
        media.append({"kind": (child.get("type") or "image").lower(), "url": child.get("displayUrl")})
    aliases = [f"url:{u}" for u in {item.get("url")} if u]
    if item.get("id"):
        aliases.append(f"media_id:{item['id']}")
    return NormalizedPublication(
        platform="instagram",
        provider=provider,
        platform_post_id=shortcode,
        author_handle=item.get("ownerUsername") or "",
        url=canonical_url(shortcode),
        published_at_utc=published,
        text=item.get("caption") or "",
        content_type=_content_type(item.get("type"), item.get("productType")),
        is_pinned=item.get("isPinned") if isinstance(item.get("isPinned"), bool) else None,
        media=media,
        metrics={
            "likes": metric(item.get("likesCount")),
            "comments": metric(item.get("commentsCount")),
            "views": metric(item.get("videoViewCount")),
            "plays": metric(item.get("videoPlayCount")),
        },
        attributes={"hashtags": item.get("hashtags") or [], "product_type": item.get("productType"),
                    "alt": item.get("alt")},
        aliases=aliases,
    )


def from_brightdata(item: dict[str, Any], provider: str = "brightdata") -> Optional[NormalizedPublication]:
    if item.get("error") or item.get("error_code"):
        return None
    shortcode = item.get("shortcode") or shortcode_from_url(item.get("url"))
    published = parse_iso(item.get("date_posted")) if isinstance(item.get("date_posted"), str) \
        else from_unix(item.get("date_posted"))
    if not shortcode or not published:
        return None
    media = [{"kind": "image", "url": u} for u in (item.get("photos") or []) if u]
    media += [{"kind": "video", "url": u} for u in (item.get("videos") or []) if u]
    aliases = [f"url:{item['url']}"] if item.get("url") else []
    if item.get("pk"):
        aliases.append(f"media_id:{item['pk']}")
    return NormalizedPublication(
        platform="instagram",
        provider=provider,
        platform_post_id=shortcode,
        author_handle=item.get("user_posted") or "",
        url=canonical_url(shortcode),
        published_at_utc=published,
        text=item.get("description") or "",
        content_type=_content_type(item.get("content_type"), item.get("product_type")),
        is_pinned=item.get("is_pinned") if isinstance(item.get("is_pinned"), bool) else None,
        media=media,
        metrics={
            "likes": metric(item.get("likes")),
            "comments": metric(item.get("num_comments")),
            "views": metric(item.get("video_view_count")),
            "plays": metric(item.get("video_play_count")),
        },
        attributes={"hashtags": item.get("hashtags") or [], "product_type": item.get("product_type")},
        aliases=aliases,
    )
