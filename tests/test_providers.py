"""Provider adapters: pagination, resume state, error handling. All HTTP is mocked (no live calls)."""
from __future__ import annotations

import json
from datetime import datetime

import httpx
import pytest

from app.providers.apify import ApifyFacebookAdapter, ApifyInstagramAdapter
from app.providers.base import AccountRef, CollectionRequest, ProviderError
from app.providers.brightdata import BrightDataFacebookAdapter
from app.providers.http import HttpClient, redact
from app.providers.twitterapi_io import TwitterApiIoAdapter
from app.providers.youtube import YouTubeDataApiAdapter


def req(platform="instagram", handle="mahadgipr", url="https://www.instagram.com/mahadgipr", **kw):
    return CollectionRequest(account=AccountRef(1, platform, handle, url, **kw),
                             window_start_utc=datetime(2026, 10, 11, 12, 30), window_end_utc=datetime(2026, 10, 13, 0, 30))


def http(handler, retries=2):
    return HttpClient(httpx.Client(transport=httpx.MockTransport(handler)), max_retries=retries, sleep=lambda _: None)


def ig_item(i):
    return {"shortCode": f"SC{i:03d}", "timestamp": "2026-10-12T05:00:00.000Z", "caption": f"post {i}", "type": "Image"}


# ---------------------------------------------------------------- Apify
def apify_handler(items, status="SUCCEEDED", seen=None):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer tok"
        if seen is not None:
            seen.append((request.method, request.url.path, dict(request.url.params),
                         json.loads(request.content) if request.content else None))
        if request.method == "POST":
            return httpx.Response(201, json={"data": {"id": "r1", "status": "RUNNING", "defaultDatasetId": "d1"}})
        if "/actor-runs/" in request.url.path:
            return httpx.Response(200, json={"data": {"id": "r1", "status": status, "defaultDatasetId": "d1",
                                                      "usageTotalUsd": 0.25}})
        off, lim = int(request.url.params["offset"]), int(request.url.params["limit"])
        return httpx.Response(200, json=items[off:off + lim], headers={"X-Apify-Pagination-Total": str(len(items))})
    return handler


def test_apify_paginates_dataset_and_sends_documented_input():
    items = [ig_item(i) for i in range(250)]
    seen = []
    a = ApifyInstagramAdapter(http(apify_handler(items, seen=seen)), "tok", "apify~instagram-scraper",
                              results_limit=1000, collect_reels_tab=False)
    pages = [p for p in a.fetch_pages(req()) if p.items]
    assert [len(p.items) for p in pages] == [100, 100, 50]
    assert not any(p.limit_reached for p in pages)
    start = next(s for s in seen if s[0] == "POST")
    assert start[1] == "/v2/acts/apify~instagram-scraper/runs"
    assert start[3]["directUrls"] == ["https://www.instagram.com/mahadgipr"]
    assert start[3]["resultsType"] == "posts" and start[3]["onlyPostsNewerThan"] == "2026-10-10"
    assert pages[-1].usage["apify_usage_usd"] == 0.25


def test_apify_flags_result_limit_and_failed_run_is_partial():
    items = [ig_item(i) for i in range(30)]
    a = ApifyInstagramAdapter(http(apify_handler(items)), "tok", "x~y", results_limit=30, collect_reels_tab=False)
    pages = [p for p in a.fetch_pages(req()) if p.items]
    assert pages[-1].limit_reached is True

    b = ApifyInstagramAdapter(http(apify_handler(items[:5], status="FAILED")), "tok", "x~y", collect_reels_tab=False)
    got = []
    with pytest.raises(ProviderError) as e:
        for p in b.fetch_pages(req()):
            got.extend(p.items)
    assert len(got) == 5 and "FAILED" in str(e.value)


def test_apify_resume_skips_starting_a_new_run():
    seen = []
    a = ApifyFacebookAdapter(http(apify_handler([], seen=seen)), "tok", "apify~facebook-posts-scraper")
    r = req("facebook", "MahaDGIPR", "https://www.facebook.com/MahaDGIPR")
    r.resume_state = {"passes": {"posts": {"run_id": "r1", "dataset_id": "d1", "offset": 0, "received": 0}}}
    list(a.fetch_pages(r))
    assert not any(s[0] == "POST" for s in seen)


def test_missing_credentials_is_config_error():
    with pytest.raises(ProviderError) as e:
        ApifyInstagramAdapter(http(lambda r: httpx.Response(200)), "", "x~y")
    assert e.value.kind == "config"


# ---------------------------------------------------------------- TwitterAPI.io
def test_twitter_cursor_pagination_and_pinned_detection():
    pages = {"": {"tweets": [{"id": "1", "createdAt": "Mon Oct 12 16:00:00 +0000 2026", "text": "a",
                              "author": {"userName": "MahaDGIPR", "pinnedTweetIds": ["9"]}}],
                  "has_next_page": True, "next_cursor": "c2", "status": "success"},
             "c2": {"tweets": [{"id": "9", "createdAt": "Tue Sep 01 06:00:00 +0000 2026", "text": "pinned"}],
                    "has_next_page": False, "next_cursor": "", "status": "success"}}

    def handler(request):
        assert request.headers["X-API-Key"] == "k" and request.url.params["userName"] == "MahaDGIPR"
        return httpx.Response(200, json=pages[request.url.params["cursor"]])
    a = TwitterApiIoAdapter(http(handler), "k")
    out = list(a.fetch_pages(req("x", "@MahaDGIPR", "https://x.com/MahaDGIPR")))
    assert [len(p.items) for p in out] == [1, 1]
    assert out[0].resume_state == {"cursor": "c2"}
    assert a.normalize(out[1].items[0]).is_pinned is True
    assert a.normalize(out[0].items[0]).is_pinned is False


def test_twitter_search_mode_uses_unix_since_until():
    def handler(request):
        q = request.url.params["query"]
        assert q == "from:MahaDGIPR since_time:1791721800 until_time:1791851400"
        return httpx.Response(200, json={"tweets": [], "has_next_page": False, "next_cursor": ""})
    a = TwitterApiIoAdapter(http(handler), "k", mode="search")
    assert a.capabilities.server_side_window
    list(a.fetch_pages(req("x", "MahaDGIPR", "https://x.com/MahaDGIPR")))


def test_twitter_error_status_raises():
    a = TwitterApiIoAdapter(http(lambda r: httpx.Response(200, json={"status": "error", "message": "bad user"})), "k")
    with pytest.raises(ProviderError):
        list(a.fetch_pages(req("x", "nobody", "https://x.com/nobody")))


# ---------------------------------------------------------------- YouTube
def test_youtube_resolves_handle_and_pages_uploads():
    calls = []

    def handler(request):
        p = request.url.path.rsplit("/", 1)[1]
        calls.append(p)
        assert request.url.params["key"] == "yk"
        if p == "channels":
            assert request.url.params["forHandle"] == "@MAHARASHTRADGIPR"
            return httpx.Response(200, json={"items": [{"id": "UC1", "contentDetails": {"relatedPlaylists": {"uploads": "UU1"}}}]})
        if p == "playlistItems":
            tok = request.url.params.get("pageToken")
            vid = "v2" if tok else "v1"
            body = {"items": [{"contentDetails": {"videoId": vid}}]}
            if not tok:
                body["nextPageToken"] = "T2"
            return httpx.Response(200, json=body)
        ids = request.url.params["id"].split(",")
        return httpx.Response(200, json={"items": [{"id": i, "snippet": {"publishedAt": "2026-10-12T09:00:00Z", "title": i},
                                                    "contentDetails": {"duration": "PT45S"}, "status": {"privacyStatus": "public"},
                                                    "statistics": {"viewCount": "5"}} for i in ids]})
    a = YouTubeDataApiAdapter(http(handler), "yk")
    ref = AccountRef(1, "youtube", "@MAHARASHTRADGIPR", "https://www.youtube.com/@MAHARASHTRADGIPR")
    resolved = a.resolve_account(ref)
    assert resolved["external_id"] == "UC1" and resolved["provider_meta"]["uploads_playlist_id"] == "UU1"
    ref.provider_meta = resolved["provider_meta"]
    r = req("youtube"); r.account = ref
    pages = list(a.fetch_pages(r))
    assert [p.items[0].external_id for p in pages] == ["v1", "v2"]
    assert a.usage_counters()["youtube_quota_units"] == 5  # channels + 2×(playlistItems + videos)
    pub = a.normalize(pages[0].items[0])
    assert pub.is_short is None and pub.attributes["possible_short"] is True


def test_youtube_unknown_handle():
    a = YouTubeDataApiAdapter(http(lambda r: httpx.Response(200, json={"items": []})), "yk")
    with pytest.raises(ProviderError) as e:
        a.resolve_account(AccountRef(1, "youtube", "@nope", ""))
    assert e.value.kind == "not_found"


# ---------------------------------------------------------------- Bright Data
def test_brightdata_trigger_poll_download_and_error_records():
    polls = iter(["running", "ready"])

    def handler(request):
        path = request.url.path
        assert request.headers["Authorization"] == "Bearer bk"
        if path.endswith("/trigger"):
            assert request.url.params["dataset_id"] == "gd_lkaxegm826bjpoo9m5"
            body = json.loads(request.content)
            assert body["input"][0]["url"] == "https://www.facebook.com/MahaDGIPR"
            assert body["input"][0]["start_date"] == "10-10-2026"
            return httpx.Response(200, json={"snapshot_id": "s1"})
        if "/progress/" in path:
            return httpx.Response(200, json={"status": next(polls)})
        return httpx.Response(200, json=[{"post_id": "1", "date_posted": "2026-10-12T06:00:00Z", "content": "x"},
                                         {"error": "dead page", "error_code": "dead_page"}])
    a = BrightDataFacebookAdapter(http(handler), "bk", "gd_lkaxegm826bjpoo9m5", sleep=lambda _: None)
    got = []
    with pytest.raises(ProviderError) as e:
        for p in a.fetch_pages(req("facebook", "MahaDGIPR", "https://www.facebook.com/MahaDGIPR")):
            got.extend(p.items)
    assert len(got) == 1 and "error record" in str(e.value)


# ---------------------------------------------------------------- HTTP client
def test_http_retries_429_then_succeeds_and_counts_requests():
    responses = iter([httpx.Response(429, headers={"Retry-After": "3"}), httpx.Response(503),
                      httpx.Response(200, json={"ok": 1})])
    slept = []
    h = HttpClient(httpx.Client(transport=httpx.MockTransport(lambda r: next(responses))), max_retries=3,
                   sleep=slept.append)
    assert h.get_json("https://api.example/x") == {"ok": 1}
    assert h.requests_made == 3 and slept[0] == 3.0


def test_http_auth_error_is_not_retried_and_secrets_are_redacted():
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(401, text="bad key=SECRET123")
    h = http(handler, retries=5)
    with pytest.raises(ProviderError) as e:
        h.get_json("https://www.googleapis.com/youtube/v3/videos?key=SECRET123&id=1")
    assert len(calls) == 1 and e.value.kind == "auth"
    assert "SECRET123" not in str(e.value)
    assert redact("https://x/?key=abc&token=def") == "https://x/?key=***&token=***"
