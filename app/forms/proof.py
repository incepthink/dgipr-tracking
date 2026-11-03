"""Proof behind reported figures (पुरावा): the post links or PDF/photo files an office attaches to a number.

A field's `proof` says what it takes: none, links (the number is typed and must equal the count of links), files,
or either (links or files; the number is typed and needs at least one item when above 0). Proof is required from
the form's `proof_from` day; earlier periods are exempt.

Links are compared in canonical form (host without www./m., twitter.com as x.com, youtu.be as a watch URL,
tracking parameters dropped), so the same post pasted twice — even from another phone's share sheet — is caught.

Files go straight from the browser to storage on a presigned PUT (the Vercel rewrite in front of the backend caps
request bodies at ~4.5 MB): a private S3 bucket in production, a folder under DATA_DIR for dev and tests."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qsl, quote, urlencode, urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Form, FormField, FormProof, FormSubmission
from app.reporting.columns import BY_KEY
from app.settings import Settings

PROOF_TYPES = ("none", "links", "files", "either")
FILE_TYPES = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}
MAX_FILE = 10 * 1024 * 1024
UPLOAD_SECONDS = 15 * 60
OPEN_SECONDS = 300

_LINK_RE = re.compile(r"(?:https?://|www\.)[^\s<>\"'`]+", re.IGNORECASE)
_TRAIL = ".,;:!?)]}>\"'。，、；：！？）」』】》"
_HOST_PREFIXES = ("www.", "m.", "mobile.")
_HOST_ALIASES = {"twitter.com": "x.com", "fb.com": "facebook.com", "instagr.am": "instagram.com"}
_TRACKING = {"fbclid", "igsh", "igshid", "mibextid", "si", "feature", "ref", "s", "t", "__cft__", "__tn__"}


# --------------------------------------------------------------------------- links
def extract_links(text: str) -> list[str]:
    """Every web link in pasted text (a whole WhatsApp message works), in order, duplicates kept."""
    out = []
    for m in _LINK_RE.finditer(text or ""):
        url = m.group(0).rstrip(_TRAIL)
        if url.lower().startswith("www."):
            url = "https://" + url
        if len(url) > len("https://"):
            out.append(url[:2000])
    return out


def _host(netloc: str) -> str:
    host = netloc.rsplit("@", 1)[-1].split(":", 1)[0].lower().rstrip(".")
    for p in _HOST_PREFIXES:
        if host.startswith(p):
            host = host[len(p):]
            break
    return _HOST_ALIASES.get(host, host)


def canonical(url: str) -> str:
    """The comparison key of a link: host/path?sorted-query, without scheme, fragment or tracking parameters."""
    parts = urlsplit(url.strip())
    host = _host(parts.netloc)
    path = parts.path
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
             if not k.lower().startswith("utm_") and k.lower() not in _TRACKING]
    if host == "youtu.be" and path.strip("/"):
        host, query, path = "youtube.com", [("v", path.strip("/").split("/")[0]), *query], "/watch"
    elif host == "youtube.com" and path.startswith("/shorts/"):
        query, path = [("v", path.split("/")[2]), *query], "/watch"
    path = path.rstrip("/")
    q = urlencode(sorted(query))
    return f"{host}{path}" + (f"?{q}" if q else "")


def host_of(url: str) -> str:
    return _host(urlsplit(url).netloc)


def link_problem(field: FormField, url: str) -> Optional[str]:
    """"not_link" or "wrong_platform" for a link this field can't take, else None."""
    parts = urlsplit(url)
    host = _host(parts.netloc)
    if parts.scheme.lower() not in ("http", "https") or "." not in host:
        return "not_link"
    col = BY_KEY.get(field.key)
    allowed = {_HOST_ALIASES.get(h, h) for h in col.link_hosts} if col else set()
    if allowed and not any(host == h or host.endswith("." + h) for h in allowed):
        return "wrong_platform"
    return None


def allowed_hosts(field: FormField) -> list[str]:
    col = BY_KEY.get(field.key)
    return list(col.link_hosts) if col else []


# --------------------------------------------------------------------------- rules
def exempt(form: Form, ps: date) -> bool:
    """A period before proof became required."""
    return form.proof_from is not None and ps < form.proof_from


def applies(form: Form, ps: date) -> bool:
    return form.proof_from is not None and ps >= form.proof_from


def needs_proof(form: Form, ps: date, field: FormField, value: Optional[float]) -> bool:
    return field.proof != "none" and applies(form, ps) and value is not None and value > 0


def live(sub: Optional[FormSubmission], rows: Optional[list[FormProof]] = None) -> list[FormProof]:
    rows = rows if rows is not None else (sub.proofs if sub is not None else [])
    return sorted((p for p in rows if p.removed_at is None), key=lambda p: (p.sort_order, p.id or 0))


def missing_proof(form: Form, sub: FormSubmission, rows: Optional[list[FormProof]] = None) -> list[FormField]:
    """Active fields whose figure needs proof and has none."""
    have = {p.field_id for p in live(sub, rows)}
    values = {v.field_id: v.value_num for v in sub.values}
    return [f for f in form.fields if not f.archived and f.id not in have
            and needs_proof(form, sub.period_start, f, values.get(f.id))]


def duplicates(s: Session, form: Form, url_keys: list[str],
               exclude_submission_id: Optional[int]) -> dict[str, tuple[str, date]]:
    """Live links of this form, from another submission, with these keys: url_key → (office, period)."""
    if not url_keys:
        return {}
    q = (select(FormProof.url_key, FormSubmission.office_code, FormSubmission.period_start)
         .join(FormSubmission, FormSubmission.id == FormProof.submission_id)
         .where(FormSubmission.form_id == form.id, FormProof.kind == "link", FormProof.removed_at.is_(None),
                FormProof.url_key.in_(set(url_keys))))
    if exclude_submission_id is not None:
        q = q.where(FormProof.submission_id != exclude_submission_id)
    return {k: (o, ps) for k, o, ps in s.execute(q).all()}


def check_links(s: Session, form: Form, field: FormField, office: str, sub: Optional[FormSubmission],
                links: list[str]) -> list[dict[str, Any]]:
    """Each link with its problem (None, not_link, wrong_platform, repeated, used_here, used_other) — the same
    checks save() applies, so the page can show them while the office types. used_here names the day; a link
    another office counted only says so."""
    keys = [canonical(u) for u in links]
    used = duplicates(s, form, keys, sub.id if sub is not None else None)
    seen: set[str] = set()
    out = []
    for url, key in zip(links, keys):
        problem = link_problem(field, url)
        where = None
        if problem is None and key in seen:
            problem = "repeated"
        elif problem is None and key in used:
            o, ps = used[key]
            problem = "used_here" if o == office else "used_other"
            where = ps.isoformat() if o == office else None
        seen.add(key)
        out.append({"url": url, "key": key, "host": host_of(url), "problem": problem, "day": where})
    return out


def object_prefix(form: Form, office: str, ps: date) -> str:
    return f"proofs/{form.id}/{office}/{ps.isoformat()}/"


def new_object_key(form: Form, office: str, ps: date, content_type: str) -> str:
    return object_prefix(form, office, ps) + f"{secrets.token_hex(16)}.{FILE_TYPES[content_type]}"


def proof_json(p: FormProof) -> dict[str, Any]:
    """`key` names a file in private storage (it opens only through the file endpoint); the page sends it back to keep
    the file on the next save."""
    return {"id": p.id, "kind": p.kind, "url": p.url, "key": p.file_key, "name": p.file_name, "type": p.file_type,
            "size": p.file_size, "added_by": p.added_by, "added_at": p.added_at.isoformat() + "Z"}


# --------------------------------------------------------------------------- storage
def content_disposition(filename: str) -> str:
    ascii_name = filename.encode("ascii", "ignore").decode().replace('"', "") or "proof"
    return f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


class LocalStorage:
    """DATA_DIR/proofs/<key>. The 'presigned' PUT is a backend URL carrying an HMAC-signed token."""
    kind = "local"

    def __init__(self, settings: Settings):
        self.root = settings.data_dir
        self.secret = _secret(settings)

    def path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not str(p).startswith(str((self.root / "proofs").resolve())):
            raise ValueError("bad key")
        return p

    def presign_put(self, key: str, content_type: str, size: int) -> dict[str, Any]:
        body = base64.urlsafe_b64encode(json.dumps(
            {"k": key, "t": content_type, "n": size, "e": int(time.time()) + UPLOAD_SECONDS}).encode()).decode()
        sig = hmac.new(self.secret, body.encode(), hashlib.sha256).hexdigest()
        return {"url": f"/api/forms/proof-uploads/{body}.{sig}", "headers": {"Content-Type": content_type}}

    def read_token(self, token: str) -> dict[str, Any]:
        body, _, sig = token.rpartition(".")
        good = hmac.new(self.secret, body.encode(), hashlib.sha256).hexdigest()
        if not body or not hmac.compare_digest(sig, good):
            raise ValueError("bad upload link")
        data = json.loads(base64.urlsafe_b64decode(body.encode()))
        if data["e"] < time.time():
            raise ValueError("upload link expired; pick the file again")
        return data

    def write(self, key: str, data: bytes) -> None:
        p = self.path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(p)

    def head(self, key: str) -> Optional[int]:
        p = self.path(key)
        return p.stat().st_size if p.is_file() else None


class S3Storage:
    """A private bucket; the browser PUTs and GETs on short-lived presigned URLs. Credentials come from boto3's
    default chain (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, or an instance role)."""
    kind = "s3"

    def __init__(self, settings: Settings):
        if not settings.proof_s3_bucket:
            raise RuntimeError("PROOF_S3_BUCKET is not set")
        self.bucket = settings.proof_s3_bucket
        self.client = _s3_client(settings.proof_s3_region)

    def presign_put(self, key: str, content_type: str, size: int) -> dict[str, Any]:
        url = self.client.generate_presigned_url("put_object", ExpiresIn=UPLOAD_SECONDS, Params={
            "Bucket": self.bucket, "Key": key, "ContentType": content_type})
        return {"url": url, "headers": {"Content-Type": content_type}}

    def head(self, key: str) -> Optional[int]:
        from botocore.exceptions import ClientError
        try:
            return int(self.client.head_object(Bucket=self.bucket, Key=key)["ContentLength"])
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise

    def open_url(self, key: str, filename: str, content_type: str) -> str:
        return self.client.generate_presigned_url("get_object", ExpiresIn=OPEN_SECONDS, Params={
            "Bucket": self.bucket, "Key": key, "ResponseContentType": content_type,
            "ResponseContentDisposition": content_disposition(filename)})


@lru_cache(maxsize=4)
def _s3_client(region: str):
    import boto3
    from botocore.config import Config
    # the regional endpoint: presigned URLs on the global one are redirected (307) for a new bucket, and browsers
    # don't follow a redirect on a PUT
    return boto3.client("s3", region_name=region, endpoint_url=f"https://s3.{region}.amazonaws.com",
                        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}))


def _secret(settings: Settings) -> bytes:
    """PROOF_SECRET, or a random one kept in DATA_DIR (local storage only signs upload links with it)."""
    if settings.proof_secret:
        return settings.proof_secret.encode()
    p = settings.data_dir / ".proof_secret"
    if not p.is_file():
        p.write_text(secrets.token_hex(32), encoding="utf-8")
    return p.read_text(encoding="utf-8").strip().encode()


def storage(settings: Settings):
    if settings.proof_storage == "s3":
        return S3Storage(settings)
    return LocalStorage(settings)

