"""Server-side configuration. Secrets come only from environment variables (or a local
.env file that is never committed) and are never sent to templates or written to logs."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader: KEY=VALUE lines; existing environment variables win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw not in (None, "") else default


@dataclass
class Settings:
    data_dir: Path
    config_dir: Path
    database_url: str
    # Provider selection per platform. Changing these never affects classification,
    # aggregation, UI or PDF code — see app/providers/factory.py.
    provider_facebook: str = "apify"
    provider_instagram: str = "apify"
    provider_x: str = "twitterapi_io"
    provider_youtube: str = "youtube_data_api"
    # Credentials (server-side only).
    apify_token: str = field(default="", repr=False)
    brightdata_api_key: str = field(default="", repr=False)
    twitterapi_io_key: str = field(default="", repr=False)
    youtube_api_key: str = field(default="", repr=False)
    # Provider tuning.
    apify_instagram_actor: str = "apify~instagram-scraper"
    apify_facebook_actor: str = "apify~facebook-posts-scraper"
    apify_x_actor: str = "kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest"
    apify_x_results_limit: int = 500
    apify_max_wait_seconds: int = 900
    apify_results_limit: int = 200
    apify_facebook_results_limit: int = 200  # busy Pages post ~40/day; the date filter is day-granular
    instagram_collect_reels_tab: bool = True
    brightdata_facebook_dataset: str = "gd_lkaxegm826bjpoo9m5"
    brightdata_instagram_dataset: str = "gd_lk5ns7kz21pck8jpis"
    brightdata_date_format: str = "%m-%d-%Y"
    brightdata_max_wait_seconds: int = 1200
    brightdata_num_of_posts: int = 200
    twitterapi_io_mode: str = "timeline"  # timeline | search
    max_pages_per_account: int = 50
    http_timeout_seconds: int = 60
    http_max_retries: int = 4
    overlap_hours: int = 6
    collection_parallelism: int = 4
    # Already-covered tasks make no provider calls and would finish instantly; for the POC they are replayed
    # one account at a time in visible stages, each lasting this long. 0 disables the pacing.
    replay_step_seconds: float = 1.2
    # PDF
    pdf_browser_channel: str = ""  # "" = Playwright's bundled Chromium; "msedge" / "chrome" use an installed browser
    # Login. The first state admin is created from these on start if no state user exists yet.
    admin_username: str = ""
    admin_password: str = field(default="", repr=False)
    session_days: int = 14
    # Analytics AI (daily brief, ask-a-question). No key or no model: the template brief and the fixed question
    # list are used. The model only words text and picks a question type; every number comes from code.
    openai_api_key: str = field(default="", repr=False)
    openai_model: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    ai_daily_call_limit: int = 200

    @property
    def pdf_dir(self) -> Path:
        return self.data_dir / "reports"


def load_settings(env_file: Path | None = None) -> Settings:
    _load_dotenv(env_file or BASE_DIR / ".env")
    data_dir = Path(os.environ.get("DATA_DIR") or BASE_DIR / "data").resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    config_dir = Path(os.environ.get("CONFIG_DIR") or BASE_DIR / "config").resolve()
    db_url = os.environ.get("DATABASE_URL") or f"sqlite:///{(data_dir / 'dgipr.sqlite3').as_posix()}"
    env = os.environ.get
    return Settings(
        data_dir=data_dir,
        config_dir=config_dir,
        database_url=db_url,
        provider_facebook=env("PROVIDER_FACEBOOK", "apify"),
        provider_instagram=env("PROVIDER_INSTAGRAM", "apify"),
        provider_x=env("PROVIDER_X", "twitterapi_io"),
        provider_youtube=env("PROVIDER_YOUTUBE", "youtube_data_api"),
        apify_token=env("APIFY_TOKEN", "") or env("APIFY_API_KEY", ""),
        brightdata_api_key=env("BRIGHTDATA_API_KEY", ""),
        twitterapi_io_key=env("TWITTERAPI_IO_KEY", ""),
        youtube_api_key=env("YOUTUBE_API_KEY", ""),
        apify_instagram_actor=env("APIFY_INSTAGRAM_ACTOR", "apify~instagram-scraper"),
        apify_facebook_actor=env("APIFY_FACEBOOK_ACTOR", "apify~facebook-posts-scraper"),
        apify_x_actor=env("APIFY_X_ACTOR", "kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest"),
        apify_x_results_limit=_int("APIFY_X_RESULTS_LIMIT", 500),
        apify_max_wait_seconds=_int("APIFY_MAX_WAIT_SECONDS", 900),
        apify_results_limit=_int("APIFY_RESULTS_LIMIT", 200),
        apify_facebook_results_limit=_int("APIFY_FACEBOOK_RESULTS_LIMIT", 200),
        instagram_collect_reels_tab=_bool("INSTAGRAM_COLLECT_REELS_TAB", True),
        brightdata_facebook_dataset=env("BRIGHTDATA_FACEBOOK_DATASET", "gd_lkaxegm826bjpoo9m5"),
        brightdata_instagram_dataset=env("BRIGHTDATA_INSTAGRAM_DATASET", "gd_lk5ns7kz21pck8jpis"),
        brightdata_date_format=env("BRIGHTDATA_DATE_FORMAT", "%m-%d-%Y"),
        brightdata_max_wait_seconds=_int("BRIGHTDATA_MAX_WAIT_SECONDS", 1200),
        brightdata_num_of_posts=_int("BRIGHTDATA_NUM_OF_POSTS", 200),
        twitterapi_io_mode=env("TWITTERAPI_IO_MODE", "timeline"),
        max_pages_per_account=_int("MAX_PAGES_PER_ACCOUNT", 50),
        http_timeout_seconds=_int("HTTP_TIMEOUT_SECONDS", 60),
        http_max_retries=_int("HTTP_MAX_RETRIES", 4),
        overlap_hours=_int("OVERLAP_HOURS", 6),
        collection_parallelism=_int("COLLECTION_PARALLELISM", 4),
        replay_step_seconds=float(env("REPLAY_STEP_SECONDS", "") or 1.2),
        pdf_browser_channel=env("PDF_BROWSER_CHANNEL", ""),
        admin_username=env("ADMIN_USERNAME", ""),
        admin_password=env("ADMIN_PASSWORD", ""),
        session_days=_int("SESSION_DAYS", 14),
        openai_api_key=env("OPENAI_API_KEY", ""),
        openai_model=env("OPENAI_MODEL", ""),
        openai_base_url=env("OPENAI_BASE_URL", "") or "https://api.openai.com/v1",
        ai_daily_call_limit=_int("AI_DAILY_CALL_LIMIT", 200),
    )
