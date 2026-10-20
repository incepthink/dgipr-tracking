"""YouTube Data API v3 adapter.

  channels.list?part=id,snippet,contentDetails&forHandle=@handle   (1 quota unit) -> uploads playlist
  playlistItems.list?part=snippet,contentDetails,status&playlistId=UU...&maxResults=50&pageToken  (1 unit/page)
  videos.list?part=snippet,contentDetails,statistics,liveStreamingDetails,status&id=<=50 ids  (1 unit/call)
The uploads playlist ordering is not documented as guaranteed, so the orchestrator stops only after
a run of consecutive items older than the window rather than at the first old item.
"""
from __future__ import annotations

from typing import Any, Iterator, Optional

from app.normalize import youtube as yt_norm
from app.normalize.model import NormalizedPublication
from app.providers.base import (AccountRef, CollectionRequest, FetchPage, ProviderAdapter, ProviderCapabilities,
                                ProviderError, RawItem)
from app.providers.http import HttpClient

API = "https://www.googleapis.com/youtube/v3"


class YouTubeDataApiAdapter(ProviderAdapter):
    platform = "youtube"
    capabilities = ProviderCapabilities(
        platform="youtube", server_side_window=False, window_upper_bound=False, cursor_pagination=True,
        resumable=True, newest_first=None, may_include_pinned=False, async_job=False,
        notes="Uploads playlist + videos.list. No API field identifies Shorts.")

    def __init__(self, http: HttpClient, api_key: str, label: str = "youtube_data_api"):
        if not api_key:
            raise ProviderError("config", "YOUTUBE_API_KEY is not configured")
        self.http = http
        self.key = api_key
        self.name = label
        self.quota_units = 0

    def _get(self, path: str, **params: Any) -> dict[str, Any]:
        self.quota_units += 1
        return self.http.get_json(f"{API}/{path}", params={**params, "key": self.key})

    def resolve_account(self, account: AccountRef) -> dict[str, Any]:
        meta = account.provider_meta or {}
        if account.external_id and meta.get("uploads_playlist_id"):
            return {}
        handle = account.handle if account.handle.startswith("@") else f"@{account.handle}"
        data = self._get("channels", part="id,snippet,contentDetails", forHandle=handle)
        items = data.get("items") or []
        if not items:
            raise ProviderError("not_found", f"YouTube handle {handle} did not resolve to a channel")
        ch = items[0]
        uploads = ((ch.get("contentDetails") or {}).get("relatedPlaylists") or {}).get("uploads")
        if not uploads:
            raise ProviderError("provider", f"channel {ch.get('id')} has no uploads playlist")
        return {"external_id": ch["id"],
                "provider_meta": {**meta, "uploads_playlist_id": uploads,
                                  "channel_title": (ch.get("snippet") or {}).get("title")}}

    def fetch_pages(self, request: CollectionRequest) -> Iterator[FetchPage]:
        playlist = (request.account.provider_meta or {}).get("uploads_playlist_id")
        if not playlist:
            resolved = self.resolve_account(request.account)
            playlist = resolved["provider_meta"]["uploads_playlist_id"]
        token = (request.resume_state or {}).get("page_token")
        while True:
            params: dict[str, Any] = {"part": "snippet,contentDetails,status", "playlistId": playlist, "maxResults": 50}
            if token:
                params["pageToken"] = token
            page = self._get("playlistItems", **params)
            pitems = page.get("items") or []
            ids = [(p.get("contentDetails") or {}).get("videoId") for p in pitems]
            ids = [i for i in ids if i]
            videos: dict[str, dict[str, Any]] = {}
            if ids:
                vdata = self._get("videos", part="snippet,contentDetails,statistics,liveStreamingDetails,status",
                                  id=",".join(ids), maxResults=50)
                videos = {v["id"]: v for v in vdata.get("items") or []}
            raw = []
            for p in pitems:
                vid = (p.get("contentDetails") or {}).get("videoId")
                raw.append(RawItem(payload={"playlistItem": p, "video": videos.get(vid)}, external_id=vid))
            token = page.get("nextPageToken")
            yield FetchPage(items=raw, resume_state={"page_token": token} if token else {},
                            usage={"youtube_quota_units": self.quota_units}, note=f"{len(raw)} uploads")
            if not token:
                return

    def normalize(self, item: RawItem) -> Optional[NormalizedPublication]:
        return yt_norm.from_data_api(item.payload, provider=self.name)

    def usage_counters(self) -> dict[str, Any]:
        return {"youtube_quota_units": self.quota_units}
