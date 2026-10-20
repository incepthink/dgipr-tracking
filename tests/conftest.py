"""Shared test fixtures. All provider traffic in tests uses httpx.MockTransport or the synthetic
fixture server — no test calls a live API."""
from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import select

from app.db import init_db, make_engine, make_session_factory
from app.models import Account, Campaign
from app.registry.loader import bootstrap, report_format
from app.settings import BASE_DIR, Settings

PERIOD = date(2026, 10, 12)


@pytest.fixture()
def settings(tmp_path: Path) -> Settings:
    s = Settings(data_dir=tmp_path, config_dir=BASE_DIR / "config",
                 database_url=f"sqlite:///{(tmp_path / 'test.sqlite3').as_posix()}")
    for p in ("facebook", "instagram", "x", "youtube"):
        setattr(s, f"provider_{p}", "fixture")
    s.http_max_retries = 1
    return s


@pytest.fixture()
def session_factory(settings: Settings):
    engine = make_engine(settings.database_url)
    init_db(engine)
    factory = make_session_factory(engine)
    with factory() as s:
        bootstrap(s, settings.config_dir)
    yield factory
    engine.dispose()


@pytest.fixture()
def session(session_factory):
    with session_factory() as s:
        yield s


@pytest.fixture()
def campaign(session) -> Campaign:
    return session.scalar(select(Campaign).where(Campaign.slug == "drought_measures"))


@pytest.fixture()
def accounts(session) -> dict[str, Account]:
    return {a.platform: a for a in session.scalars(select(Account)).all()}


@pytest.fixture()
def fmt(settings):
    return report_format(settings.config_dir)


# --------------------------------------------------------------------------- web app (login, office reports)
ADMIN = ("admin", "admin-pass-1")


@pytest.fixture(scope="session")
def web(tmp_path_factory):
    """The FastAPI app on a fresh temp database with a bootstrapped state admin. app.web.main reads settings at
    import, so it is imported once per test session, after pointing DATA_DIR at a temp directory."""
    import os
    data = tmp_path_factory.mktemp("web")
    os.environ.update({"DATA_DIR": str(data), "DATABASE_URL": "", "ADMIN_USERNAME": ADMIN[0],
                       "ADMIN_PASSWORD": ADMIN[1], "PROVIDER_FACEBOOK": "fixture", "PROVIDER_INSTAGRAM": "fixture",
                       "PROVIDER_X": "fixture", "PROVIDER_YOUTUBE": "fixture"})
    import app.web.main as main
    return main


def login(web, username: str, password: str):
    from fastapi.testclient import TestClient
    c = TestClient(web.app)
    r = c.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return c


@pytest.fixture(scope="session")
def admin_client(web):
    return login(web, *ADMIN)


def make_user(admin_client, web, username: str, role: str, office: str | None = None, division: str | None = None):
    """Create (or reuse) a user and return a logged-in client whose password change is already done."""
    r = admin_client.post("/api/users", json={"username": username, "role": role, "office_code": office,
                                              "division_code": division, "password": "temp-pass-1"})
    assert r.status_code == 200, r.text
    c = login(web, username, "temp-pass-1")
    r = c.post("/api/auth/password", json={"current_password": "temp-pass-1", "new_password": "real-pass-1"})
    assert r.status_code == 200, r.text
    return c


# --------------------------------------------------------------------------- forms
FORM_START = date(2026, 9, 1)


def drought_fields() -> list[dict]:
    from app.reporting.columns import COLUMNS
    return [{"key": c.key, "label_mr": c.label_mr, "label_en": c.label_en, "type": "number", "min_value": 0,
             "group": c.group} for c in COLUMNS]


@pytest.fixture()
def drought_form(session, campaign):
    """A published daily form with the 12 report columns, sent to every office and linked to the campaign."""
    from app.forms.schema import create_form, set_status
    form = create_form(session, "t", {"title_mr": campaign.title_mr, "title_en": "Drought", "frequency": "daily",
                                      "start_date": FORM_START.isoformat(), "campaign_id": campaign.id,
                                      "fields": drought_fields()})
    set_status(session, "t", form, "published")
    session.flush()
    return form
