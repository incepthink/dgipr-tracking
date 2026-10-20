"""TwitterAPI.io adapter for X.

Verified against docs.twitterapi.io (Oct 2026), auth header X-API-Key:
  GET /twitter/user/last_tweets?userName=&cursor=&includeReplies=   up to 20/page, sorted by created_at
  GET /twitter/tweet/advanced_search?query=&queryType=Latest&cursor=  supports since_time:/until_time: (unix seconds)
Both return {tweets, has_next_page, next_cursor}. The docs do not say whether pinned tweets appear in
the timeline; we mark them via author.pinnedTweetIds and never rely on them for stop conditions.
"""
from __future__ import annotations

import calendar
from typing import Any, Iterator, Optional

from app.normalize import x as x_norm
from app.normalize.model import NormalizedPublication
from app.providers.base import (CollectionRequest, FetchPage, ProviderAdapter, ProviderCapabilities, ProviderError,
                                RawItem)
from app.providers.http import HttpClient

API = "https://api.twitterapi.io"


class TwitterApiIoAdapter(ProviderAdapter):
    platform = "x"

    def __init__(self, http: HttpClient, api_key: str, mode: str = "timeline", label: str = "twitterapi_io"):
        if not api_key:
            raise ProviderError("config", "TWITTERAPI_IO_KEY is not configured")
        if mode not in ("timeline", "search"):
            raise ProviderError("config", f"TWITTERAPI_IO_MODE must be timeline or search, not {mode!r}")
        self.http = http
        self.headers = {"X-API-Key": api_key}
        self.mode = mode
        self.name = label
        self.capabilities = ProviderCapabilities(
            platform="x", server_side_window=(mode == "search"), window_upper_bound=(mode == "search"),
            cursor_pagination=True, resumable=True, newest_first=True, may_include_pinned=True, async_job=False,
            notes="timeline: user timeline incl. replies, paged until older than the window. "
                  "search: advanced_search with since_time/until_time (search index may omit some posts).")
        self._pinned: set[str] = set()

    def fetch_pages(self, request: CollectionRequest) -> Iterator[FetchPage]:
        handle = request.account.handle.lstrip("@")
        cursor = (request.resume_state or {}).get("cursor", "")
        pages = 0
        while True:
            if self.mode == "timeline":
                url = f"{API}/twitter/user/last_tweets"
                params: dict[str, Any] = {"userName": handle, "cursor": cursor, "includeReplies": "true"}
            else:
                since = calendar.timegm(request.window_start_utc.timetuple())
                until = calendar.timegm(request.window_end_utc.timetuple())
                url = f"{API}/twitter/tweet/advanced_search"
                params = {"query": f"from:{handle} since_time:{since} until_time:{until}",
                          "queryType": "Latest", "cursor": cursor}
            data = self.http.get_json(url, params=params, headers=self.headers)
            if data.get("status") == "error":
                raise ProviderError("provider", f"TwitterAPI.io error: {data.get('message') or data.get('msg')}")
            body = data.get("data") if isinstance(data.get("data"), dict) else data
            tweets = body.get("tweets") or []
            pin = body.get("pin_tweet")
            if isinstance(pin, dict) and pin.get("id"):
                self._pinned.add(str(pin["id"]))
            for t in tweets:
                for pid in ((t.get("author") or {}).get("pinnedTweetIds") or []):
                    self._pinned.add(str(pid))
            pages += 1
            cursor = data.get("next_cursor") or body.get("next_cursor") or ""
            has_next = bool(data.get("has_next_page", body.get("has_next_page"))) and bool(cursor)
            yield FetchPage(items=[RawItem(payload=t, external_id=str(t.get("id"))) for t in tweets],
                            resume_state={"cursor": cursor}, note=f"page {pages}: {len(tweets)} tweets")
            if not has_next:
                return

    def normalize(self, item: RawItem) -> Optional[NormalizedPublication]:
        return x_norm.from_twitterapi_io(item.payload, pinned_ids=self._pinned or None, provider=self.name)
