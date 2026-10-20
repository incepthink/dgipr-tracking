"""Login, sessions, password change and role-based lock-down of the existing routes."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.auth import hash_password, verify_password
from tests.conftest import ADMIN, login, make_user


@pytest.fixture(scope="module")
def district(web, admin_client):
    return make_user(admin_client, web, "auth_pune", "district", office="pune")


@pytest.fixture(scope="module")
def zone(web, admin_client):
    return make_user(admin_client, web, "auth_zone_pune", "zone", division="pune")


def test_password_hash_roundtrip():
    h = hash_password("s3cret-pass")
    assert h.startswith("scrypt$") and verify_password("s3cret-pass", h)
    assert not verify_password("wrong", h) and not verify_password("x", "garbage")


def test_login_and_bad_password(web):
    c = TestClient(web.app)
    assert c.get("/api/auth/me").status_code == 401
    assert c.post("/api/auth/login", json={"username": ADMIN[0], "password": "nope"}).status_code == 401
    r = c.post("/api/auth/login", json={"username": ADMIN[0].upper(), "password": ADMIN[1]})
    assert r.status_code == 200 and r.json()["role"] == "state"
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert c.get("/api/auth/me").json()["username"] == ADMIN[0]
    c.post("/api/auth/logout")
    assert c.get("/api/auth/me").status_code == 401


def test_anonymous_is_locked_out(web):
    c = TestClient(web.app)
    for path in ("/api/runs", "/api/meta", "/api/forms/mine", "/api/audit", "/api/users"):
        assert c.get(path).status_code == 401, path
    r = c.get("/classic", follow_redirects=False)
    assert r.status_code in (302, 307) and r.headers["location"] == "/app/login"
    assert c.get("/healthz").status_code == 200


def test_temporary_password_must_be_changed(web, admin_client):
    r = admin_client.post("/api/users", json={"username": "auth_tmp", "role": "district", "office_code": "satara"})
    temp = r.json()["temp_password"]
    c = login(web, "auth_tmp", temp)
    assert c.get("/api/auth/me").json()["must_change_password"] is True
    assert c.get("/api/forms/mine").status_code == 403
    assert c.post("/api/auth/password", json={"current_password": "bad", "new_password": "longenough"}).status_code == 400
    assert c.post("/api/auth/password", json={"current_password": temp, "new_password": "short"}).status_code == 400
    assert c.post("/api/auth/password", json={"current_password": temp, "new_password": "longenough"}).status_code == 200
    assert c.get("/api/forms/mine").status_code == 200


def test_existing_routes_are_state_only(admin_client, district, zone):
    for path in ("/api/runs", "/api/accounts", "/api/dashboard", "/api/audit", "/api/review", "/api/report",
                 "/api/users", "/api/collect/accounts"):
        assert district.get(path).status_code == 403, path
        assert zone.get(path).status_code == 403, path
        assert admin_client.get(path).status_code == 200, path
    assert district.post("/api/runs", json={}).status_code == 403
    assert district.get("/report/preview.pdf?start=2026-10-12&end=2026-10-12").status_code == 403


def test_meta_is_scoped(admin_client, district, zone):
    m = district.get("/api/meta").json()
    assert [o["code"] for d in m["divisions"] for o in d["offices"]] == ["pune"]
    assert "providers" not in m and m["operator"] == "auth_pune"
    z = zone.get("/api/meta").json()
    assert [d["code"] for d in z["divisions"]] == ["pune"]
    assert {o["code"] for o in z["divisions"][0]["offices"]} == {"pune_rio", "pune", "solapur", "satara"}
    assert len(admin_client.get("/api/meta").json()["divisions"]) == 9


def test_deactivated_user_is_logged_out(web, admin_client):
    c = make_user(admin_client, web, "auth_gone", "district", office="beed")
    uid = c.get("/api/auth/me").json()["id"]
    assert admin_client.patch(f"/api/users/{uid}", json={"active": False}).status_code == 200
    assert c.get("/api/auth/me").status_code == 401


def test_audit_actor_is_logged_in_user(admin_client):
    acc = admin_client.get("/api/accounts").json()[0]
    r = admin_client.patch(f"/api/accounts/{acc['id']}", json={"office_code": acc["office_code"] or "",
                                                               "mapping_note": "checked", "active": True})
    assert r.status_code == 200
    assert admin_client.get("/api/audit?limit=1").json()[0]["actor"] == ADMIN[0]
