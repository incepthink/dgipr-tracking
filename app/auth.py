"""Username/password login, cookie sessions and the three access levels.

  district  reads and writes its own office (fills the forms sent to it)
  zone      reads every office of its division (submissions and analytics); writes nothing
  state     everything, including the Social Monitoring pipeline and administration

Access is default-deny: AuthMiddleware lets anonymous requests reach only the login endpoint and static
files, lets any logged-in user reach the report-forms API (OFFICE_PREFIXES), and requires the state role
for every other path — so routes added later are state-only unless deliberately opened up."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from datetime import timedelta
from typing import Callable, Iterable, Optional

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware

from app import audit
from app.models import Division, Office, User, UserSession
from app.timeutil import utcnow

ROLES = ("district", "zone", "state")
COOKIE = "dgipr_session"

PUBLIC_PATHS = {"/", "/healthz", "/api/auth/login", "/api/auth/logout", "/app"}
PUBLIC_PREFIXES = ("/app/", "/static/", "/fonts/")
# Reachable by every logged-in user (each endpoint scopes its data to the user).
OFFICE_PREFIXES = ("/api/auth/", "/api/meta", "/api/forms")
# Reachable while a password change is still pending.
PASSWORD_PENDING_PATHS = {"/api/auth/me", "/api/auth/password", "/api/auth/logout", "/api/meta"}


# --------------------------------------------------------------------------- passwords
_SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=32, **_SCRYPT)
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), dklen=len(digest) // 2,
                             n=int(n), r=int(r), p=int(p))
        return hmac.compare_digest(got.hex(), digest)
    except (ValueError, TypeError):
        return False


def check_password_policy(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")


def temp_password() -> str:
    alphabet = "abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789"  # no look-alikes (l/1, O/0)
    return "".join(secrets.choice(alphabet) for _ in range(10))


# --------------------------------------------------------------------------- sessions
def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(s: Session, user: User, days: int) -> str:
    token = secrets.token_urlsafe(32)
    now = utcnow()
    s.add(UserSession(token_hash=_token_hash(token), user_id=user.id, created_at=now, last_seen_at=now,
                      expires_at=now + timedelta(days=days)))
    user.last_login_at = now
    return token


def end_session(s: Session, token: str) -> None:
    row = s.scalar(select(UserSession).where(UserSession.token_hash == _token_hash(token)))
    if row:
        s.delete(row)


def end_all_sessions(s: Session, user_id: int, keep_token: Optional[str] = None) -> None:
    keep = _token_hash(keep_token) if keep_token else None
    for row in s.scalars(select(UserSession).where(UserSession.user_id == user_id)).all():
        if row.token_hash != keep:
            s.delete(row)


def resolve_session(factory: sessionmaker[Session], token: str) -> Optional[User]:
    """The active user behind a session token (detached, with office/division loaded), or None."""
    with factory() as s:
        row = s.scalar(select(UserSession).where(UserSession.token_hash == _token_hash(token)))
        now = utcnow()
        if not row or row.expires_at <= now or not row.user.active:
            return None
        if (now - row.last_seen_at).total_seconds() > 300:
            row.last_seen_at = now
            s.commit()
        user = row.user
        _ = user.office, user.division  # load before the session closes
        s.expunge_all()
        return user


def set_session_cookie(request: Request, response, token: str, days: int) -> None:
    response.set_cookie(COOKIE, token, max_age=days * 86400, httponly=True, samesite="lax",
                        secure=request.url.scheme == "https", path="/")


class LoginThrottle:
    """At most `limit` failed logins per username+client within `window` seconds (in-process)."""

    def __init__(self, limit: int = 10, window: int = 900):
        self.limit, self.window = limit, window
        self.failures: dict[str, deque[float]] = defaultdict(deque)

    def _recent(self, key: str) -> deque[float]:
        q = self.failures[key]
        while q and q[0] < time.monotonic() - self.window:
            q.popleft()
        return q

    def blocked(self, key: str) -> bool:
        return len(self._recent(key)) >= self.limit

    def fail(self, key: str) -> None:
        self._recent(key).append(time.monotonic())

    def clear(self, key: str) -> None:
        self.failures.pop(key, None)


# --------------------------------------------------------------------------- middleware + dependencies
def _is_public(path: str) -> bool:
    return path in PUBLIC_PATHS or path.startswith(PUBLIC_PREFIXES)


def _is_office(path: str) -> bool:
    return path.startswith(OFFICE_PREFIXES)


class AuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, session_factory: Callable[[], sessionmaker[Session]]):
        super().__init__(app)
        self.session_factory = session_factory

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        request.state.user = None
        if _is_public(path):
            return await call_next(request)
        token = request.cookies.get(COOKIE)
        user = await run_in_threadpool(resolve_session, self.session_factory(), token) if token else None
        request.state.user = user
        if user is None:
            if path.startswith("/api/"):
                return JSONResponse({"detail": "login required"}, status_code=401)
            return RedirectResponse("/app/login")
        if user.must_change_password and path not in PASSWORD_PENDING_PATHS:
            return JSONResponse({"detail": "password change required"}, status_code=403)
        if user.role != "state" and not _is_office(path):
            return JSONResponse({"detail": "not allowed for your role"}, status_code=403)
        return await call_next(request)


def current_user(request: Request) -> User:
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(401, "login required")
    return user


def require_role(*roles: str) -> Callable[[Request], User]:
    def dep(request: Request) -> User:
        user = current_user(request)
        if user.role not in roles:
            raise HTTPException(403, "not allowed for your role")
        return user
    return dep


# --------------------------------------------------------------------------- scope
def visible_office_codes(s: Session, user: User) -> list[str]:
    """Active offices the user may read, in report order."""
    q = (select(Office.code).join(Division, Division.code == Office.division_code)
         .where(Office.active.is_(True), Division.active.is_(True))
         .order_by(Division.sort_order, Office.sort_order))
    if user.role == "zone":
        q = q.where(Office.division_code == user.division_code)
    elif user.role == "district":
        q = q.where(Office.code == user.office_code)
    elif user.role != "state":
        return []
    return list(s.scalars(q).all())


def editable_office_codes(s: Session, user: User) -> list[str]:
    if user.role == "state":
        return visible_office_codes(s, user)
    if user.role == "district" and user.office_code:
        return [user.office_code]
    return []


def can_edit(user: User, office_code: str) -> bool:
    return user.role == "state" or (user.role == "district" and bool(user.office_code) and office_code == user.office_code)


def require_visible(s: Session, user: User, office_codes: Iterable[str]) -> None:
    allowed = set(visible_office_codes(s, user))
    if any(o not in allowed for o in office_codes):
        raise HTTPException(403, "office outside your access")


def validate_assignment(s: Session, role: str, office_code: Optional[str], division_code: Optional[str]) -> None:
    """district needs an office; zone needs a division and has no office."""
    if role not in ROLES:
        raise HTTPException(400, "role must be district, zone or state")
    office = s.get(Office, office_code) if office_code else None
    if office_code and office is None:
        raise HTTPException(400, f"unknown office {office_code}")
    if division_code and s.get(Division, division_code) is None:
        raise HTTPException(400, f"unknown division {division_code}")
    if role == "district" and not office:
        raise HTTPException(400, "a district user needs an office")
    if role == "zone":
        if not division_code:
            raise HTTPException(400, "a zone user needs a division")
        if office:
            raise HTTPException(400, "a zone user views its division and has no office")


def bootstrap_admin(s: Session, username: str, password: str) -> Optional[User]:
    """Create the first state admin from ADMIN_USERNAME / ADMIN_PASSWORD when no state user exists."""
    if not username or not password:
        return None
    if s.scalar(select(User).where(User.role == "state")):
        return None
    if s.scalar(select(User).where(User.username == username)):
        return None
    user = User(username=username, password_hash=hash_password(password), display_name="State admin",
                role="state", must_change_password=False, active=True)
    s.add(user)
    s.flush()
    audit.record(s, "system:bootstrap", "user.create", "user", user.id, after={"username": username, "role": "state"})
    s.commit()
    return user
