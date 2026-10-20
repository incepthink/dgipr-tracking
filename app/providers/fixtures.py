"""Offline fixture transport.

Serves SYNTHETIC, clearly labelled provider responses (fixtures/sample_api/*.json) to the *real*
adapters through httpx.MockTransport, so pagination and normalisation code paths are exercised
without credentials. Nothing served here is live data, and publications collected this way carry
a provider label ending in "[FIXTURE]".
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

import httpx

from app.settings import BASE_DIR

FIXTURE_DIR = BASE_DIR / "fixtures" / "sample_api"


@lru_cache(maxsize=None)
def _load(name: str, directory: str) -> Any:
    return json.loads((Path(directory) / name).read_text(encoding="utf-8"))


class FixtureServer:
    def __init__(self, directory: Path = FIXTURE_DIR):
        self.dir = str(directory)
        self.apify_runs: dict[str, str] = {}

    def load(self, name: str) -> Any:
        return _load(name, self.dir)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        host, path = request.url.host, request.url.path
        q = {k: v[0] for k, v in parse_qs(request.url.query.decode()).items()}
        if host == "api.apify.com":
            return self._apify(request, path, q)
        if host == "api.twitterapi.io":
            return self._twitter(path, q)
        if host == "www.googleapis.com":
            return self._youtube(path, q)
        if host == "api.brightdata.com":
            return self._brightdata(request, path, q)
        return httpx.Response(404, json={"error": f"no fixture for {host}{path}"})

    # ---- Apify
    def _apify(self, request: httpx.Request, path: str, q: dict[str, str]) -> httpx.Response:
        if path.endswith("/runs") and request.method == "POST":
            body = json.loads(request.content or b"{}")
            actor = path.split("/acts/")[1].split("/")[0]
            if "instagram" in actor:
                kind = "apify_instagram_reels.json" if body.get("resultsType") == "reels" else "apify_instagram_posts.json"
            else:
                kind = "apify_facebook_posts.json"
            run_id = f"run{len(self.apify_runs) + 1}"
            self.apify_runs[run_id] = kind
            return httpx.Response(201, json={"data": {"id": run_id, "status": "RUNNING",
                                                      "defaultDatasetId": f"ds-{run_id}"}})
        if path.startswith("/v2/actor-runs/"):
            run_id = path.rsplit("/", 1)[1]
            return httpx.Response(200, json={"data": {"id": run_id, "status": "SUCCEEDED",
                                                      "defaultDatasetId": f"ds-{run_id}", "usageTotalUsd": 0.0}})
        if path.startswith("/v2/datasets/"):
            run_id = path.split("/")[3].removeprefix("ds-")
            items = self.load(self.apify_runs[run_id])["items"]
            offset, limit = int(q.get("offset", 0)), int(q.get("limit", 100))
            page = items[offset:offset + limit]
            return httpx.Response(200, json=page, headers={"X-Apify-Pagination-Total": str(len(items))})
        return httpx.Response(404, json={"error": "unknown apify fixture path"})

    # ---- TwitterAPI.io
    def _twitter(self, path: str, q: dict[str, str]) -> httpx.Response:
        pages = self.load("twitterapi_last_tweets.json")["pages"]
        idx = int(q.get("cursor") or 0) if (q.get("cursor") or "0").isdigit() else 0
        page = pages[idx]
        has_next = idx + 1 < len(pages)
        return httpx.Response(200, json={"status": "success", "tweets": page["tweets"], "has_next_page": has_next,
                                         "next_cursor": str(idx + 1) if has_next else ""})

    # ---- YouTube
    def _youtube(self, path: str, q: dict[str, str]) -> httpx.Response:
        data = self.load("youtube.json")
        if path.endswith("/channels"):
            return httpx.Response(200, json=data["channels"])
        if path.endswith("/playlistItems"):
            idx = int(q.get("pageToken") or 0)
            page = dict(data["playlistItems"][idx])
            if idx + 1 < len(data["playlistItems"]):
                page["nextPageToken"] = str(idx + 1)
            return httpx.Response(200, json=page)
        if path.endswith("/videos"):
            ids = q.get("id", "").split(",")
            return httpx.Response(200, json={"items": [v for v in data["videos"] if v["id"] in ids]})
        return httpx.Response(404, json={"error": "unknown youtube fixture path"})

    # ---- Bright Data
    def _brightdata(self, request: httpx.Request, path: str, q: dict[str, str]) -> httpx.Response:
        if path.endswith("/trigger"):
            name = "brightdata_instagram.json" if q.get("type") == "discover_new" else "brightdata_facebook.json"
            return httpx.Response(200, json={"snapshot_id": f"sd_{name.split('.')[0]}"})
        if "/progress/" in path:
            return httpx.Response(200, json={"status": "ready"})
        if "/snapshot/" in path:
            name = path.rsplit("/", 1)[1].removeprefix("sd_") + ".json"
            return httpx.Response(200, json=self.load(name)["items"])
        return httpx.Response(404, json={"error": "unknown brightdata fixture path"})


def fixture_client(directory: Path = FIXTURE_DIR) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(FixtureServer(directory)))
