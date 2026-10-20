"""Bright Data Web Scraper API adapters (interchangeable with the Apify adapters).

Verified against Bright Data docs (Oct 2026):
  POST /datasets/v3/trigger?dataset_id=...&include_errors=true[&type=discover_new&discover_by=url]
       body {"input": [...]}  -> {"snapshot_id": "..."}; auth: Authorization: Bearer <key>
  GET  /datasets/v3/progress/{snapshot_id}  -> status starting|running|ready|failed
  Facebook  "Pages Posts by Profile URL"  gd_lkaxegm826bjpoo9m5 (collect_by_url: url, num_of_posts, start_date, end_date)
  Instagram "Posts"                        gd_lk5ns7kz21pck8jpis (discover_by_url: url, num_of_posts, start_date, end_date, post_type)
NOT fully confirmed by the public docs and therefore configurable / to verify on the first live run:
  * snapshot download path GET /datasets/v3/snapshot/{id}?format=json (a 202 means 'not ready')
  * start_date/end_date text format (BRIGHTDATA_DATE_FORMAT, default %m-%d-%Y)
"""
from __future__ import annotations

import time
from datetime import timedelta
from typing import Any, Callable, Iterator, Optional

from app.normalize import facebook as fb_norm
from app.normalize import instagram as ig_norm
from app.normalize.model import NormalizedPublication
from app.providers.base import (CollectionRequest, FetchPage, ProviderAdapter, ProviderCapabilities, ProviderError,
                                RawItem)
from app.providers.http import HttpClient

API = "https://api.brightdata.com/datasets/v3"
CHUNK = 100


class _BrightDataBase(ProviderAdapter):
    dataset_id: str
    discover: bool = False

    def __init__(self, http: HttpClient, api_key: str, dataset_id: str, *, date_format: str = "%m-%d-%Y",
                 num_of_posts: int = 200, max_wait_seconds: int = 1200, poll_interval: float = 10.0,
                 sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic,
                 label: str = "brightdata"):
        if not api_key:
            raise ProviderError("config", "BRIGHTDATA_API_KEY is not configured")
        self.http = http
        self.headers = {"Authorization": f"Bearer {api_key}"}
        self.dataset_id = dataset_id
        self.date_format = date_format
        self.num_of_posts = num_of_posts
        self.max_wait = max_wait_seconds
        self.poll_interval = poll_interval
        self.sleep = sleep
        self.clock = clock
        self.name = label

    def build_input(self, request: CollectionRequest) -> dict[str, Any]:
        return {
            "url": request.account.url,
            "num_of_posts": self.num_of_posts,
            "start_date": (request.window_start_utc - timedelta(days=1)).strftime(self.date_format),
            "end_date": (request.window_end_utc + timedelta(days=1)).strftime(self.date_format),
        }

    def fetch_pages(self, request: CollectionRequest) -> Iterator[FetchPage]:
        state = dict(request.resume_state or {})
        if not state.get("snapshot_id"):
            params: dict[str, Any] = {"dataset_id": self.dataset_id, "include_errors": "true"}
            if self.discover:
                params.update(type="discover_new", discover_by="url")
            resp = self.http.post_json(f"{API}/trigger", params=params, headers=self.headers,
                                       json={"input": [self.build_input(request)]})
            sid = resp.get("snapshot_id")
            if not sid:
                raise ProviderError("provider", f"Bright Data trigger returned no snapshot_id: {str(resp)[:200]}")
            state["snapshot_id"] = sid
            yield FetchPage(items=[], resume_state=dict(state), note=f"triggered snapshot {sid}")
        sid = state["snapshot_id"]
        deadline = self.clock() + self.max_wait
        while True:
            prog = self.http.get_json(f"{API}/progress/{sid}", headers=self.headers)
            status = (prog.get("status") or "").lower()
            if status == "ready":
                break
            if status == "failed":
                raise ProviderError("provider", f"Bright Data snapshot {sid} failed")
            if self.clock() >= deadline:
                raise ProviderError("timeout", f"Bright Data snapshot {sid} still '{status}' after {self.max_wait}s; "
                                               f"re-run the task to resume")
            self.sleep(self.poll_interval)
        resp = self.http.request("GET", f"{API}/snapshot/{sid}", params={"format": "json"}, headers=self.headers)
        if resp.status_code == 202:
            raise ProviderError("retryable", f"Bright Data snapshot {sid} not ready for download", retryable=True)
        records = resp.json()
        if isinstance(records, dict):
            records = records.get("data") or records.get("records") or []
        errors = [r for r in records if isinstance(r, dict) and (r.get("error") or r.get("error_code"))]
        good = [r for r in records if isinstance(r, dict) and r not in errors]
        for i in range(0, max(len(good), 1), CHUNK):
            chunk = good[i:i + CHUNK]
            last = i + CHUNK >= len(good)
            yield FetchPage(items=[RawItem(payload=r, external_id=self.external_id(r)) for r in chunk],
                            limit_reached=last and len(good) >= self.num_of_posts,
                            resume_state=dict(state), note=f"snapshot {sid}: {min(i + CHUNK, len(good))}/{len(good)}")
        if errors and not good:
            raise ProviderError("provider", f"Bright Data returned only errors: {str(errors[0])[:200]}")
        if errors:
            raise ProviderError("provider", f"Bright Data returned {len(errors)} error record(s) alongside "
                                            f"{len(good)} results; partial results kept")

    @staticmethod
    def external_id(item: dict[str, Any]) -> Optional[str]:
        return None


class BrightDataFacebookAdapter(_BrightDataBase):
    platform = "facebook"
    discover = False
    capabilities = ProviderCapabilities(
        platform="facebook", server_side_window=True, window_upper_bound=True, cursor_pagination=False,
        resumable=True, newest_first=None, may_include_pinned=True, async_job=True,
        notes="Async snapshot. Date format and snapshot download path must be verified on first live run.")

    @staticmethod
    def external_id(item: dict[str, Any]) -> Optional[str]:
        return str(item.get("post_id")) if item.get("post_id") else None

    def normalize(self, item: RawItem) -> Optional[NormalizedPublication]:
        return fb_norm.from_brightdata(item.payload, provider=self.name)


class BrightDataInstagramAdapter(_BrightDataBase):
    platform = "instagram"
    discover = True
    capabilities = ProviderCapabilities(
        platform="instagram", server_side_window=True, window_upper_bound=True, cursor_pagination=False,
        resumable=True, newest_first=None, may_include_pinned=True, async_job=True,
        notes="Async snapshot (discover_by=url). Date format and snapshot download path must be verified live.")

    @staticmethod
    def external_id(item: dict[str, Any]) -> Optional[str]:
        return item.get("shortcode") or item.get("post_id")

    def normalize(self, item: RawItem) -> Optional[NormalizedPublication]:
        return ig_norm.from_brightdata(item.payload, provider=self.name)
