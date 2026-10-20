"""Provider-response normalisation (synthetic payloads in documented shapes)."""
from __future__ import annotations

from datetime import datetime

from app.normalize import facebook, instagram, x, youtube
from app.normalize.model import metric


def test_metric_keeps_unknown_as_none():
    assert metric(None) is None and metric("") is None and metric(-1) is None and metric("abc") is None
    assert metric(0) == 0 and metric("12") == 12 and metric(3.0) == 3


def test_instagram_apify_reel_and_hidden_likes():
    n = instagram.from_apify({"id": "1", "shortCode": "ABC", "url": "https://www.instagram.com/reel/ABC/",
                              "timestamp": "2026-10-12T05:00:00.000Z", "caption": "दुष्काळ", "type": "Video",
                              "productType": "clips", "likesCount": -1, "videoViewCount": 50, "isPinned": True})
    assert n.platform_post_id == "ABC" and n.url == "https://www.instagram.com/p/ABC/"
    assert n.content_type == "reel" and n.is_pinned is True
    assert n.metrics["likes"] is None and n.metrics["views"] == 50 and n.metrics["comments"] is None
    assert n.published_at_utc == datetime(2026, 10, 12, 5, 0)
    assert instagram.from_apify({"error": "no_items"}) is None


def test_instagram_brightdata_uses_same_stable_id_as_apify():
    a = instagram.from_apify({"shortCode": "XYZ", "timestamp": "2026-10-12T05:00:00Z"})
    b = instagram.from_brightdata({"url": "https://www.instagram.com/p/XYZ/", "date_posted": "2026-10-12T05:00:00Z",
                                   "description": "t", "likes": 3})
    assert a.platform_post_id == b.platform_post_id == "XYZ"


def test_facebook_apify_reel_aliases_and_missing_metrics():
    n = facebook.from_apify({"postId": "900", "url": "https://www.facebook.com/reel/700", "time": "2026-10-12T09:30:00Z",
                             "text": "t", "likes": None, "media": [{"__typename": "Video", "id": "700"}]})
    assert n.content_type == "reel" and "video:700" in n.aliases
    assert n.metrics["reactions"] is None and n.metrics["shares"] is None
    assert facebook.from_apify({"postId": "", "time": "2026-10-12T09:30:00Z"}) is None


def test_facebook_brightdata_shared_post_is_repost():
    n = facebook.from_brightdata({"post_id": "5", "url": "https://www.facebook.com/p/5", "date_posted": "2026-10-12T01:00:00Z",
                                  "content": "c", "original_post": {"url": "u"}, "num_shares": 0})
    assert n.is_repost and n.metrics["shares"] == 0


def test_x_parsing_flags_and_url():
    t = {"type": "tweet", "id": "77", "createdAt": "Mon Oct 12 16:00:00 +0000 2026", "text": "RT @a: दुष्काळ",
         "author": {"userName": "MahaDGIPR"}, "isReply": False, "retweeted_tweet": {"text": "दुष्काळ बैठक"},
         "likeCount": 4, "viewCount": None}
    n = x.from_twitterapi_io(t)
    assert n.url == "https://x.com/MahaDGIPR/status/77" and n.is_repost and not n.is_reply
    assert n.description == "दुष्काळ बैठक" and n.metrics["views"] is None and n.metrics["likes"] == 4
    assert n.published_at_utc == datetime(2026, 10, 12, 16, 0)


def test_youtube_upcoming_live_private_and_duration():
    assert youtube.iso_duration_seconds("PT1H2M3S") == 3723 and youtube.iso_duration_seconds("P1DT1S") == 86401
    up = youtube.from_data_api({"video": {"id": "v", "snippet": {"publishedAt": "2026-10-12T12:00:00Z", "liveBroadcastContent": "upcoming"},
                                          "status": {"privacyStatus": "public"}, "statistics": {}}})
    assert up.content_type == "upcoming_live" and up.metrics["views"] is None
    live = youtube.from_data_api({"video": {"id": "w", "snippet": {"publishedAt": "2026-10-11T12:00:00Z", "liveBroadcastContent": "none"},
                                            "liveStreamingDetails": {"actualStartTime": "2026-10-12T06:00:00Z"},
                                            "contentDetails": {"duration": "PT50M"}, "status": {"privacyStatus": "public"}}})
    assert live.content_type == "live" and live.published_at_utc == datetime(2026, 10, 12, 6, 0)
    assert youtube.from_data_api({"video": {"id": "p", "snippet": {"publishedAt": "2026-10-12T12:00:00Z"},
                                            "status": {"privacyStatus": "private"}}}) is None
