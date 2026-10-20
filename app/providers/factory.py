"""Provider selection. The only place that knows which concrete provider serves a platform.

PROVIDER_<PLATFORM> values:
  facebook : apify | brightdata | fixture | fixture:brightdata
  instagram: apify | brightdata | fixture | fixture:brightdata
  x        : twitterapi_io | apify | fixture
  youtube  : youtube_data_api | fixture
To add a provider: implement ProviderAdapter (app/providers/base.py) plus a normaliser that returns
NormalizedPublication, then register a builder in BUILDERS below.
"""
from __future__ import annotations

from typing import Callable

import httpx

from app.providers.apify import ApifyFacebookAdapter, ApifyInstagramAdapter, ApifyXAdapter
from app.providers.base import ProviderAdapter, ProviderError
from app.providers.brightdata import BrightDataFacebookAdapter, BrightDataInstagramAdapter
from app.providers.fixtures import fixture_client
from app.providers.http import HttpClient
from app.providers.twitterapi_io import TwitterApiIoAdapter
from app.providers.youtube import YouTubeDataApiAdapter
from app.settings import Settings

PLATFORMS = ("facebook", "instagram", "x", "youtube")

Builder = Callable[[Settings, HttpClient, bool], ProviderAdapter]


def _label(base: str, fixture: bool) -> str:
    return f"{base}[FIXTURE]" if fixture else base


def _key(value: str, fixture: bool) -> str:
    return "fixture-key" if fixture else value


BUILDERS: dict[tuple[str, str], Builder] = {
    ("instagram", "apify"): lambda s, h, f: ApifyInstagramAdapter(
        h, _key(s.apify_token, f), s.apify_instagram_actor, results_limit=s.apify_results_limit,
        max_wait_seconds=s.apify_max_wait_seconds, label=_label("apify", f),
        collect_reels_tab=s.instagram_collect_reels_tab),
    ("facebook", "apify"): lambda s, h, f: ApifyFacebookAdapter(
        h, _key(s.apify_token, f), s.apify_facebook_actor, results_limit=s.apify_facebook_results_limit,
        max_wait_seconds=s.apify_max_wait_seconds, label=_label("apify", f)),
    ("facebook", "brightdata"): lambda s, h, f: BrightDataFacebookAdapter(
        h, _key(s.brightdata_api_key, f), s.brightdata_facebook_dataset, date_format=s.brightdata_date_format,
        num_of_posts=s.brightdata_num_of_posts, max_wait_seconds=s.brightdata_max_wait_seconds,
        label=_label("brightdata", f), poll_interval=0 if f else 10),
    ("instagram", "brightdata"): lambda s, h, f: BrightDataInstagramAdapter(
        h, _key(s.brightdata_api_key, f), s.brightdata_instagram_dataset, date_format=s.brightdata_date_format,
        num_of_posts=s.brightdata_num_of_posts, max_wait_seconds=s.brightdata_max_wait_seconds,
        label=_label("brightdata", f), poll_interval=0 if f else 10),
    ("x", "apify"): lambda s, h, f: ApifyXAdapter(
        h, _key(s.apify_token, f), s.apify_x_actor, results_limit=s.apify_x_results_limit,
        max_wait_seconds=s.apify_max_wait_seconds, label=_label("apify", f)),
    ("x", "twitterapi_io"): lambda s, h, f: TwitterApiIoAdapter(
        h, _key(s.twitterapi_io_key, f), mode=s.twitterapi_io_mode, label=_label("twitterapi_io", f)),
    ("youtube", "youtube_data_api"): lambda s, h, f: YouTubeDataApiAdapter(
        h, _key(s.youtube_api_key, f), label=_label("youtube_data_api", f)),
}

DEFAULT_REAL = {"facebook": "apify", "instagram": "apify", "x": "twitterapi_io", "youtube": "youtube_data_api"}


def configured_provider(settings: Settings, platform: str) -> str:
    return getattr(settings, f"provider_{platform}")


def build_adapter(settings: Settings, platform: str, client: httpx.Client | None = None) -> ProviderAdapter:
    spec = configured_provider(settings, platform).strip().lower()
    fixture = spec == "fixture" or spec.startswith("fixture:")
    provider = (spec.split(":", 1)[1] if ":" in spec else DEFAULT_REAL[platform]) if fixture else spec
    builder = BUILDERS.get((platform, provider))
    if builder is None:
        raise ProviderError("config", f"unknown provider {spec!r} for platform {platform!r}")
    if client is None:
        client = fixture_client() if fixture else httpx.Client(timeout=settings.http_timeout_seconds,
                                                                follow_redirects=True)
    http = HttpClient(client, max_retries=settings.http_max_retries, timeout=settings.http_timeout_seconds)
    return builder(settings, http, fixture)


def provider_status(settings: Settings) -> list[dict[str, str]]:
    """For the UI: which provider each platform uses and whether credentials are present
    (never the credentials themselves)."""
    cred = {"apify": bool(settings.apify_token), "brightdata": bool(settings.brightdata_api_key),
            "twitterapi_io": bool(settings.twitterapi_io_key), "youtube_data_api": bool(settings.youtube_api_key)}
    out = []
    for p in PLATFORMS:
        spec = configured_provider(settings, p)
        fixture = spec.startswith("fixture")
        out.append({"platform": p, "provider": spec,
                    "credentials": "not needed (synthetic fixtures)" if fixture else
                    ("configured" if cred.get(spec) else "MISSING")})
    return out
