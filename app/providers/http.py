"""HTTP wrapper shared by adapters: retries with backoff, Retry-After handling, error
classification, request counting, and secret redaction for anything that is logged/stored."""
from __future__ import annotations

import logging
import re
import time
from typing import Any, Callable

import httpx

from app.providers.base import ProviderError

log = logging.getLogger("dgipr.http")

_SECRET_QUERY = re.compile(r"((?:key|token|api_key|apikey|access_token)=)[^&\s]+", re.I)


def redact(text: str) -> str:
    return _SECRET_QUERY.sub(r"\1***", text or "")


class HttpClient:
    def __init__(self, client: httpx.Client | None = None, *, max_retries: int = 4, timeout: float = 60,
                 base_backoff: float = 2.0, sleep: Callable[[float], None] = time.sleep):
        self.client = client or httpx.Client(timeout=timeout, follow_redirects=True)
        self.max_retries = max_retries
        self.base_backoff = base_backoff
        self.sleep = sleep
        self.requests_made = 0

    def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        attempt = 0
        while True:
            attempt += 1
            self.requests_made += 1
            try:
                resp = self.client.request(method, url, **kwargs)
            except httpx.TimeoutException as exc:
                err = ProviderError("timeout", f"timeout calling {redact(url)}", retryable=True)
                cause: Exception = exc
            except httpx.TransportError as exc:
                err = ProviderError("retryable", f"network error calling {redact(url)}: {type(exc).__name__}",
                                    retryable=True)
                cause = exc
            else:
                if resp.status_code < 400:
                    return resp
                err = self._classify(resp, url)
                cause = None  # type: ignore[assignment]
            if not err.retryable or attempt > self.max_retries:
                if cause is not None:
                    raise err from cause
                raise err
            delay = err.retry_after if err.retry_after is not None else self.base_backoff * (2 ** (attempt - 1))
            log.warning("retrying %s %s in %.1fs (%s)", method, redact(url), delay, err.kind)
            self.sleep(min(delay, 120))

    @staticmethod
    def _classify(resp: httpx.Response, url: str) -> ProviderError:
        code = resp.status_code
        body = redact(resp.text[:300]) if resp.text else ""
        where = f"HTTP {code} from {redact(str(httpx.URL(url).copy_with(query=None)))}"
        if code == 429:
            retry_after = resp.headers.get("Retry-After")
            try:
                ra = float(retry_after) if retry_after else None
            except ValueError:
                ra = None
            return ProviderError("rate_limited", f"{where}: rate limited", retryable=True, retry_after=ra)
        if code in (401,):
            return ProviderError("auth", f"{where}: authentication failed (check API key)")
        if code == 403:
            kind = "quota" if "quota" in body.lower() else "auth"
            return ProviderError(kind, f"{where}: {body}")
        if code == 402:
            return ProviderError("quota", f"{where}: payment/credit required")
        if code == 404:
            return ProviderError("not_found", f"{where}: {body}")
        if code in (408, 409, 425) or code >= 500:
            return ProviderError("retryable", f"{where}: {body}", retryable=True)
        return ProviderError("bad_request", f"{where}: {body}")

    def get_json(self, url: str, **kwargs: Any) -> Any:
        return self._json(self.request("GET", url, **kwargs), url)

    def post_json(self, url: str, **kwargs: Any) -> Any:
        return self._json(self.request("POST", url, **kwargs), url)

    @staticmethod
    def _json(resp: httpx.Response, url: str) -> Any:
        try:
            return resp.json()
        except ValueError as exc:
            raise ProviderError("provider", f"non-JSON response from {redact(url)}") from exc
