"""X normaliser for TwitterAPI.io tweet objects."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from app.normalize.model import NormalizedPublication, metric
from app.timeutil import parse_iso, to_utc_naive


def parse_twitter_date(value: str | None) -> Optional[datetime]:
    if not value:
        return None
    try:
        return to_utc_naive(datetime.strptime(value, "%a %b %d %H:%M:%S %z %Y"))
    except ValueError:
        return parse_iso(value)


def from_twitterapi_io(tweet: dict[str, Any], pinned_ids: set[str] | None = None,
                       provider: str = "twitterapi_io") -> Optional[NormalizedPublication]:
    tid = str(tweet.get("id") or "").strip()
    published = parse_twitter_date(tweet.get("createdAt"))
    if not tid or not published or tweet.get("type") not in (None, "tweet"):
        return None
    author = tweet.get("author") or {}
    handle = author.get("userName") or ""
    retweeted = tweet.get("retweeted_tweet")
    quoted = tweet.get("quoted_tweet")
    media_entities = ((tweet.get("extendedEntities") or {}).get("media") or [])
    media = [{"kind": m.get("type"), "url": m.get("media_url_https") or m.get("url")} for m in media_entities]
    kinds = {m["kind"] for m in media}
    ctype = "video" if ({"video", "animated_gif"} & kinds) else ("photo" if "photo" in kinds else "text")
    description_parts = []
    if retweeted:
        description_parts.append(retweeted.get("text") or "")
    if quoted:
        description_parts.append(quoted.get("text") or "")
    pinned = None
    if pinned_ids is not None:
        pinned = tid in pinned_ids
    elif isinstance(author.get("pinnedTweetIds"), list):
        pinned = tid in {str(x) for x in author["pinnedTweetIds"]}
    hashtags = [h.get("text") for h in ((tweet.get("entities") or {}).get("hashtags") or []) if h.get("text")]
    return NormalizedPublication(
        platform="x",
        provider=provider,
        platform_post_id=tid,
        author_handle=handle,
        url=f"https://x.com/{handle or 'i/web'}/status/{tid}",
        published_at_utc=published,
        text=tweet.get("text") or "",
        description="\n".join(p for p in description_parts if p),
        content_type=ctype,
        is_repost=bool(retweeted),
        is_reply=bool(tweet.get("isReply")),
        is_quote=bool(quoted),
        is_pinned=pinned,
        media=media,
        metrics={
            "likes": metric(tweet.get("likeCount")),
            "reposts": metric(tweet.get("retweetCount")),
            "comments": metric(tweet.get("replyCount")),
            "quotes": metric(tweet.get("quoteCount")),
            "views": metric(tweet.get("viewCount")),
            "bookmarks": metric(tweet.get("bookmarkCount")),
        },
        attributes={"hashtags": hashtags, "lang": tweet.get("lang"),
                    "conversation_id": tweet.get("conversationId")},
        aliases=[f"url:{tweet['url']}"] if tweet.get("url") else [],
    )
