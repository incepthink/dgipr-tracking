"""Apify adapters (Instagram Scraper, Facebook Posts Scraper, X tweet scraper).

Verified against Apify docs (Oct 2026):
  POST /v2/acts/{owner~actor}/runs           start run, body = actor input, returns data.id/defaultDatasetId
  GET  /v2/actor-runs/{runId}?waitForFinish=N  N <= 60 s; status READY|RUNNING|SUCCEEDED|FAILED|TIMING-OUT|TIMED-OUT|ABORTING|ABORTED
  GET  /v2/datasets/{id}/items?offset&limit&clean  pagination headers X-Apify-Pagination-Total
Inputs (actor input schemas):
  instagram-scraper : directUrls[], resultsType ('posts'|'reels'...), resultsLimit, onlyPostsNewerThan (UTC; pinned may still appear), addParentData
  facebook-posts-scraper : startUrls[{url}], resultsLimit, onlyPostsNewerThan, onlyPostsOlderThan, captionText
  kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest : searchTerms[] (X search syntax), maxItems, queryType
    Output items are TwitterAPI.io tweet objects (same vendor), observed live on 2026-10-16; maxItems is not a hard cap.
"""
from __future__ import annotations

import calendar
import time
from datetime import timedelta
from typing import Any, Callable, Iterator, Optional

from app.normalize import facebook as fb_norm
from app.normalize import instagram as ig_norm
from app.normalize import x as x_norm
from app.normalize.model import NormalizedPublication
from app.providers.base import (AccountRef, CollectionRequest, FetchPage, ProviderAdapter, ProviderCapabilities,
                                ProviderError, RawItem)
from app.providers.http import HttpClient

API = "https://api.apify.com/v2"
TERMINAL = {"SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"}
PAGE_SIZE = 100


class ApifyActorClient:
    def __init__(self, http: HttpClient, token: str, max_wait_seconds: int = 900,
                 clock: Callable[[], float] = time.monotonic):
        if not token:
            raise ProviderError("config", "APIFY_TOKEN is not configured")
        self.http = http
        self.headers = {"Authorization": f"Bearer {token}"}
        self.max_wait = max_wait_seconds
        self.clock = clock

    def start(self, actor: str, actor_input: dict[str, Any]) -> dict[str, Any]:
        return self.http.post_json(f"{API}/acts/{actor}/runs", json=actor_input, headers=self.headers)["data"]

    def wait(self, run_id: str) -> dict[str, Any]:
        deadline = self.clock() + self.max_wait
        while True:
            run = self.http.get_json(f"{API}/actor-runs/{run_id}", params={"waitForFinish": 60},
                                     headers=self.headers)["data"]
            if run.get("status") in TERMINAL:
                return run
            if self.clock() >= deadline:
                raise ProviderError("timeout", f"Apify run {run_id} still {run.get('status')} after "
                                               f"{self.max_wait}s; re-run the task to resume", retryable=False)

    def dataset_pages(self, dataset_id: str, offset: int = 0) -> Iterator[tuple[list[dict[str, Any]], int, int]]:
        """Yields (items, next_offset, total)."""
        while True:
            resp = self.http.request("GET", f"{API}/datasets/{dataset_id}/items",
                                     params={"offset": offset, "limit": PAGE_SIZE, "clean": "true", "format": "json"},
                                     headers=self.headers)
            items = resp.json()
            total = int(resp.headers.get("X-Apify-Pagination-Total", offset + len(items)))
            offset += len(items)
            yield items, offset, total
            if not items or offset >= total:
                return


class _ApifyAdapterBase(ProviderAdapter):
    name = "apify"
    actor: str

    def __init__(self, http: HttpClient, token: str, actor: str, results_limit: int = 200,
                 max_wait_seconds: int = 900, label: str = "apify"):
        self.http = http
        self.client = ApifyActorClient(http, token, max_wait_seconds)
        self.actor = actor
        self.results_limit = results_limit
        self.name = label
        self._usage_usd = 0.0

    def passes(self, request: CollectionRequest) -> list[tuple[str, dict[str, Any]]]:
        raise NotImplementedError

    def fetch_pages(self, request: CollectionRequest) -> Iterator[FetchPage]:
        state: dict[str, Any] = dict(request.resume_state or {})
        state.setdefault("passes", {})
        for label, actor_input in self.passes(request):
            pstate = state["passes"].setdefault(label, {})
            if pstate.get("done"):
                continue
            if not pstate.get("run_id"):
                run = self.client.start(self.actor, actor_input)
                pstate.update(run_id=run["id"], dataset_id=run["defaultDatasetId"], offset=0, received=0)
                yield FetchPage(items=[], resume_state=_copy(state), note=f"{label}: started Apify run {run['id']}")
            run = self.client.wait(pstate["run_id"])
            usd = run.get("usageTotalUsd")
            if isinstance(usd, (int, float)):
                self._usage_usd += float(usd)
            status = run.get("status")
            for items, next_offset, total in self.client.dataset_pages(pstate["dataset_id"], pstate.get("offset", 0)):
                pstate["offset"] = next_offset
                pstate["received"] = pstate.get("received", 0) + len(items)
                raw = [RawItem(payload=i, external_id=self.external_id(i)) for i in items]
                limit_hit = pstate["received"] >= self.results_limit
                yield FetchPage(items=raw, limit_reached=limit_hit, resume_state=_copy(state),
                                usage={"apify_usage_usd": round(self._usage_usd, 4)},
                                note=f"{label}: {next_offset}/{total} dataset items")
            if status != "SUCCEEDED":
                raise ProviderError("provider", f"Apify run {pstate['run_id']} ended {status}; "
                                                f"{pstate.get('received', 0)} items kept as partial results")
            pstate["done"] = True

    @staticmethod
    def external_id(item: dict[str, Any]) -> Optional[str]:
        return None

    def usage_counters(self) -> dict[str, Any]:
        return {"apify_usage_usd": round(self._usage_usd, 4)}


def _copy(state: dict[str, Any]) -> dict[str, Any]:
    return {"passes": {k: dict(v) for k, v in state.get("passes", {}).items()}}


class ApifyInstagramAdapter(_ApifyAdapterBase):
    platform = "instagram"
    capabilities = ProviderCapabilities(
        platform="instagram", server_side_window=True, window_upper_bound=False, cursor_pagination=True,
        resumable=True, newest_first=None, may_include_pinned=True, async_job=True,
        notes="onlyPostsNewerThan is a lower bound only; pinned posts may still be returned. "
              "A second 'reels' pass is optional (INSTAGRAM_COLLECT_REELS_TAB).")

    def __init__(self, *args: Any, collect_reels_tab: bool = True, **kwargs: Any):
        super().__init__(*args, **kwargs)
        self.collect_reels_tab = collect_reels_tab

    def passes(self, request: CollectionRequest) -> list[tuple[str, dict[str, Any]]]:
        newer_than = (request.window_start_utc - timedelta(days=1)).strftime("%Y-%m-%d")
        base = {"directUrls": [request.account.url], "resultsLimit": self.results_limit,
                "onlyPostsNewerThan": newer_than, "addParentData": False}
        out = [("posts", {**base, "resultsType": "posts"})]
        if self.collect_reels_tab:
            out.append(("reels", {**base, "resultsType": "reels"}))
        return out

    @staticmethod
    def external_id(item: dict[str, Any]) -> Optional[str]:
        return item.get("shortCode") or item.get("id")

    def normalize(self, item: RawItem) -> Optional[NormalizedPublication]:
        return ig_norm.from_apify(item.payload, provider=self.name)


class ApifyFacebookAdapter(_ApifyAdapterBase):
    platform = "facebook"
    capabilities = ProviderCapabilities(
        platform="facebook", server_side_window=True, window_upper_bound=True, cursor_pagination=True,
        resumable=True, newest_first=None, may_include_pinned=True, async_job=True,
        notes="Uses onlyPostsNewerThan/onlyPostsOlderThan; only public Pages are supported by the actor.")

    def passes(self, request: CollectionRequest) -> list[tuple[str, dict[str, Any]]]:
        return [("posts", {
            "startUrls": [{"url": request.account.url}],
            "resultsLimit": self.results_limit,
            "onlyPostsNewerThan": (request.window_start_utc - timedelta(days=1)).strftime("%Y-%m-%d"),
            "onlyPostsOlderThan": (request.window_end_utc + timedelta(days=1)).strftime("%Y-%m-%d"),
            "captionText": False,
        })]

    @staticmethod
    def external_id(item: dict[str, Any]) -> Optional[str]:
        return str(item.get("postId")) if item.get("postId") else None

    def normalize(self, item: RawItem) -> Optional[NormalizedPublication]:
        return fb_norm.from_apify(item.payload, provider=self.name)


class ApifyXAdapter(_ApifyAdapterBase):
    platform = "x"
    capabilities = ProviderCapabilities(
        platform="x", server_side_window=True, window_upper_bound=True, cursor_pagination=True,
        resumable=True, newest_first=True, may_include_pinned=False, async_job=True,
        notes="X search 'from:handle since_time: until_time:' (search index may omit some posts; "
              "native retweets are excluded by X search by default).")

    def passes(self, request: CollectionRequest) -> list[tuple[str, dict[str, Any]]]:
        since = calendar.timegm(request.window_start_utc.timetuple())
        until = calendar.timegm(request.window_end_utc.timetuple())
        handle = request.account.handle.lstrip("@")
        return [("search", {"searchTerms": [f"from:{handle} since_time:{since} until_time:{until}"],
                            "maxItems": self.results_limit, "queryType": "Latest"})]

    @staticmethod
    def external_id(item: dict[str, Any]) -> Optional[str]:
        return str(item.get("id")) if item.get("id") else None

    def normalize(self, item: RawItem) -> Optional[NormalizedPublication]:
        pinned = item.payload.get("isPinned")
        return x_norm.from_twitterapi_io(item.payload, provider=self.name,
                                         pinned_ids={str(item.payload.get("id"))} if pinned else
                                         (set() if pinned is False else None))


__all__ = ["ApifyInstagramAdapter", "ApifyFacebookAdapter", "ApifyXAdapter", "AccountRef"]
