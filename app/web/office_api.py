"""JSON API for login and user administration (report forms are in app.web.forms_api).

Auth endpoints are open to every logged-in user; /api/users is state-only (AuthMiddleware also denies it to
other roles, as it does every path not listed in app.auth.OFFICE_PREFIXES)."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.auth import (COOKIE, LoginThrottle, check_password_policy, create_session, current_user, editable_office_codes,
                      end_all_sessions, end_session, hash_password, require_role, set_session_cookie, temp_password,
                      validate_assignment, verify_password)
from app.models import Division, Office, User
from app.web.main import _404, _ist, app, get_session, settings

throttle = LoginThrottle()


# --------------------------------------------------------------------------- serializers
def _me(s: Session, u: User) -> dict[str, Any]:
    office = s.get(Office, u.office_code) if u.office_code else None
    div = s.get(Division, u.division_code) if u.division_code else None
    return {"id": u.id, "username": u.username, "display_name": u.display_name, "role": u.role,
            "office": {"code": office.code, "name_mr": office.name_mr, "name_en": office.name_en,
                       "kind": office.kind} if office else None,
            "division": {"code": div.code, "label_mr": div.summary_label_mr} if div else None,
            "must_change_password": u.must_change_password,
            "editable_offices": editable_office_codes(s, u)}


def _user(u: User) -> dict[str, Any]:
    return {"id": u.id, "username": u.username, "display_name": u.display_name, "role": u.role,
            "office_code": u.office_code, "division_code": u.division_code, "active": u.active,
            "must_change_password": u.must_change_password, "created_at": _ist(u.created_at),
            "last_login_at": _ist(u.last_login_at) if u.last_login_at else None}


# --------------------------------------------------------------------------- auth
class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
def api_login(request: Request, body: LoginIn, s: Session = Depends(get_session)):
    username = body.username.strip().lower()
    key = f"{username}|{request.client.host if request.client else ''}"
    if throttle.blocked(key):
        raise HTTPException(429, "Too many failed attempts. Try again in 15 minutes.")
    user = s.scalar(select(User).where(User.username == username))
    if not user or not user.active or not verify_password(body.password, user.password_hash):
        throttle.fail(key)
        raise HTTPException(401, "Wrong username or password.")
    throttle.clear(key)
    token = create_session(s, user, settings.session_days)
    audit.record(s, user.username, "user.login", "user", user.id)
    s.commit()
    resp = JSONResponse(_me(s, user))
    set_session_cookie(request, resp, token, settings.session_days)
    return resp


@app.post("/api/auth/logout")
def api_logout(request: Request, s: Session = Depends(get_session)):
    token = request.cookies.get(COOKIE)
    if token:
        end_session(s, token)
        s.commit()
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE, path="/")
    return resp


@app.get("/api/auth/me")
def api_me(request: Request, s: Session = Depends(get_session)):
    return _me(s, current_user(request))


class PasswordIn(BaseModel):
    current_password: str
    new_password: str


@app.post("/api/auth/password")
def api_password(request: Request, body: PasswordIn, s: Session = Depends(get_session)):
    user = s.get(User, current_user(request).id) or _404()
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is wrong.")
    check_password_policy(body.new_password)
    if body.new_password == body.current_password:
        raise HTTPException(400, "Choose a password different from the current one.")
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    end_all_sessions(s, user.id, keep_token=request.cookies.get(COOKIE))
    audit.record(s, user.username, "user.password_change", "user", user.id)
    s.commit()
    return _me(s, user)


# --------------------------------------------------------------------------- users (state admin)
state_only = require_role("state")


@app.get("/api/users")
def api_users(_: User = Depends(state_only), s: Session = Depends(get_session)):
    return [_user(u) for u in s.scalars(select(User).order_by(User.role.desc(), User.username)).all()]


class UserIn(BaseModel):
    username: str
    display_name: str = ""
    role: str
    office_code: Optional[str] = None
    division_code: Optional[str] = None
    password: Optional[str] = None  # blank: generate a temporary password


def _clean_username(name: str) -> str:
    name = name.strip().lower()
    if not name or len(name) > 64 or not all(ch.isalnum() or ch in "._-" for ch in name):
        raise HTTPException(400, "username: letters, digits, '.', '_' or '-' only")
    return name


@app.post("/api/users")
def api_user_create(body: UserIn, admin: User = Depends(state_only), s: Session = Depends(get_session)):
    username = _clean_username(body.username)
    if s.scalar(select(User).where(User.username == username)):
        raise HTTPException(400, "username already exists")
    office = body.office_code or None
    division = body.division_code or None
    if body.role == "district" and office and not division:
        division = (s.get(Office, office) or _404()).division_code
    if body.role != "district":
        office = None
    validate_assignment(s, body.role, office, division)
    password = body.password or temp_password()
    if body.password:
        check_password_policy(password)
    u = User(username=username, display_name=body.display_name.strip(), role=body.role, office_code=office,
             division_code=division if body.role != "state" else None, password_hash=hash_password(password),
             must_change_password=True, active=True)
    s.add(u)
    s.flush()
    audit.record(s, admin.username, "user.create", "user", u.id,
                 after={"username": u.username, "role": u.role, "office": u.office_code, "division": u.division_code})
    s.commit()
    return {**_user(u), "temp_password": password}


class UserPatch(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None
    office_code: Optional[str] = None
    division_code: Optional[str] = None
    active: Optional[bool] = None


@app.patch("/api/users/{user_id}")
def api_user_update(user_id: int, body: UserPatch, admin: User = Depends(state_only),
                    s: Session = Depends(get_session)):
    u = s.get(User, user_id) or _404()
    before = _user(u)
    role = body.role or u.role
    office = (body.office_code or None) if body.office_code is not None else u.office_code
    division = (body.division_code or None) if body.division_code is not None else u.division_code
    if role == "district" and office:
        division = (s.get(Office, office) or _404()).division_code
    if role != "district":
        office = None
    if role == "state":
        division = None
    validate_assignment(s, role, office, division)
    if u.id == admin.id and (role != "state" or body.active is False):
        raise HTTPException(400, "you cannot demote or deactivate yourself")
    u.role, u.office_code, u.division_code = role, office, division
    if body.display_name is not None:
        u.display_name = body.display_name.strip()
    if body.active is not None:
        u.active = body.active
        if not u.active:
            end_all_sessions(s, u.id)
    audit.record(s, admin.username, "user.update", "user", u.id, before=before, after=_user(u))
    s.commit()
    return _user(u)


@app.post("/api/users/{user_id}/reset-password")
def api_user_reset(user_id: int, admin: User = Depends(state_only), s: Session = Depends(get_session)):
    u = s.get(User, user_id) or _404()
    password = temp_password()
    u.password_hash = hash_password(password)
    u.must_change_password = True
    end_all_sessions(s, u.id)
    audit.record(s, admin.username, "user.password_reset", "user", u.id)
    s.commit()
    return {**_user(u), "temp_password": password}


@app.post("/api/users/bulk-create")
def api_users_bulk(admin: User = Depends(state_only), s: Session = Depends(get_session)):
    """One district account per office, विमाका offices included (username = office code), and one view-only
    zone account per division (username = zone_<division>). Existing usernames are skipped."""
    created = []
    taken = set(s.scalars(select(User.username)).all())
    divisions = s.scalars(select(Division).where(Division.active.is_(True)).order_by(Division.sort_order)).all()
    for d in divisions:
        offices = [o for o in d.offices if o.active]
        plan = [(f"zone_{d.code}", "zone", None, d.summary_label_mr)]
        plan += [(o.code, "district", o.code, o.name_mr) for o in offices]
        for username, role, office, label in plan:
            if username in taken:
                continue
            password = temp_password()
            u = User(username=username, display_name=label, role=role, office_code=office, division_code=d.code,
                     password_hash=hash_password(password), must_change_password=True, active=True)
            s.add(u)
            s.flush()
            taken.add(username)
            created.append({**_user(u), "temp_password": password})
    audit.record(s, admin.username, "user.bulk_create", "user", "bulk",
                 after={"usernames": [c["username"] for c in created]})
    s.commit()
    return {"created": created}
