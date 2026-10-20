"""Shared provider contract.

Every data provider (Apify, Bright Data, TwitterAPI.io, YouTube Data API, ...) is wrapped in a
`ProviderAdapter`. The orchestrator (app/collection/service.py) only talks to this contract, and
everything downstream (classification, aggregation, UI, PDF) only sees `NormalizedPublication`
objects — so a provider can be swapped without touching those layers.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterator, Optional

from app.normalize.model import NormalizedPublication


@dataclass(frozen=True)
class ProviderCapabilities:
    platform: str
    server_side_window: bool        # provider can filter by date window itself
    window_upper_bound: bool        # ... including an upper bound
    cursor_pagination: bool         # pages are fetched with a cursor/offset
    resumable: bool                 # an interrupted collection can resume from saved state
    newest_first: Optional[bool]    # True/False if documented, None if not guaranteed
    may_include_pinned: bool        # pinned items may appear out of chronological order
    async_job: bool                 # provider runs a job we poll (Apify run, Bright Data snapshot)
    notes: str = ""


@dataclass
class AccountRef:
    account_id: int
    platform: str
    handle: str
    url: str
    external_id: Optional[str] = None
    provider_meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class CollectionRequest:
    account: AccountRef
    window_start_utc: datetime
    window_end_utc: datetime
    max_pages: int = 50
    resume_state: dict[str, Any] = field(default_factory=dict)


@dataclass
class RawItem:
    payload: dict[str, Any]
    external_id: Optional[str] = None


@dataclass
class FetchPage:
    items: list[RawItem]
    # True when the provider stopped because it hit a result limit we set (so the window
    # may be truncated), as opposed to running out of data.
    limit_reached: bool = False
    # Opaque state the adapter wants persisted so a retry can resume.
    resume_state: dict[str, Any] = field(default_factory=dict)
    usage: dict[str, Any] = field(default_factory=dict)
    note: str = ""


class ProviderError(Exception):
    """kind: auth | rate_limited | quota | retryable | not_found | bad_request | provider | config | timeout"""

    def __init__(self, kind: str, message: str, retryable: bool = False, retry_after: float | None = None):
        super().__init__(message)
        self.kind = kind
        self.retryable = retryable
        self.retry_after = retry_after


class ProviderAdapter(ABC):
    name: str = "abstract"
    platform: str = ""
    capabilities: ProviderCapabilities

    def resolve_account(self, account: AccountRef) -> dict[str, Any]:
        """Optionally resolve stable identifiers (e.g. YouTube channel ID). Returns fields to
        persist on the account: {'external_id': ..., 'provider_meta': {...}}."""
        return {}

    @abstractmethod
    def fetch_pages(self, request: CollectionRequest) -> Iterator[FetchPage]:
        """Yield pages of raw items. Raise ProviderError on failure (pages already yielded are kept).
        Return normally only when the provider has no more data for the request."""

    @abstractmethod
    def normalize(self, item: RawItem) -> Optional[NormalizedPublication]:
        """Map one raw item to the shared model; return None for non-publication items."""

    def usage_counters(self) -> dict[str, Any]:
        return {}
