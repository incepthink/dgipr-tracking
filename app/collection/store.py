"""Persistence of raw records and normalised publications, deduplication, and the coverage ledger."""
from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Account, CollectionTask, CoverageInterval, Publication, PublicationAlias, RawRecord
from app.normalize.model import NormalizedPublication
from app.timeutil import period_bounds_utc, reporting_date, utcnow

MAX_PROVENANCE = 25


def payload_hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def save_raw(session: Session, task: CollectionTask, payload: dict[str, Any], external_id: Optional[str]) -> RawRecord:
    raw = RawRecord(task_id=task.id, provider=task.provider, platform=task.platform, external_id=external_id,
                    payload=payload, payload_sha256=payload_hash(payload))
    session.add(raw)
    session.flush()
    return raw


def _find_existing(session: Session, n: NormalizedPublication) -> Optional[Publication]:
    pub = session.scalar(select(Publication).where(Publication.platform == n.platform,
                                                   Publication.platform_post_id == n.platform_post_id))
    if pub:
        return pub
    keys = [f"id:{n.platform_post_id}", *n.aliases]
    alias = session.scalar(select(PublicationAlias).where(PublicationAlias.platform == n.platform,
                                                          PublicationAlias.alias_key.in_(keys)))
    return session.get(Publication, alias.publication_id) if alias else None


def upsert_publication(session: Session, n: NormalizedPublication, account: Account, task: CollectionTask,
                       raw: RawRecord) -> tuple[Publication, bool]:
    """Insert or update by (platform, stable id) or any alias. Returns (publication, created)."""
    now = utcnow()
    pub = _find_existing(session, n)
    created = pub is None
    prov = {"run_id": task.run_id, "task_id": task.id, "provider": n.provider, "raw_id": raw.id,
            "fetched_at": now.isoformat(timespec="seconds")}
    if created:
        pub = Publication(platform=n.platform, platform_post_id=n.platform_post_id, first_collected_at=now,
                          first_run_id=task.run_id, provenance=[])
        session.add(pub)
    assert pub is not None
    pub.provider = n.provider
    pub.account_id = account.id
    pub.office_code = account.office_code
    pub.author_handle = n.author_handle or account.handle
    pub.url = n.url or pub.url
    pub.published_at_utc = n.published_at_utc
    pub.reporting_date = reporting_date(n.published_at_utc)
    pub.text, pub.title, pub.description = n.text, n.title, n.description
    pub.content_type = n.content_type
    pub.is_repost, pub.is_reply, pub.is_quote = n.is_repost, n.is_reply, n.is_quote
    if n.is_pinned is not None:
        pub.is_pinned = n.is_pinned
    if n.is_short is not None:
        pub.is_short = n.is_short
    pub.media = n.media
    # Metrics: keep previously observed values when this response lacks them (None never overwrites a
    # known value, and is never converted to 0).
    merged = dict(pub.metrics or {})
    for k, v in n.metrics.items():
        if v is not None or k not in merged:
            merged[k] = v
    pub.metrics = merged
    pub.metrics_observed_at = now
    pub.attributes = {**(pub.attributes or {}), **n.attributes}
    pub.last_collected_at = now
    pub.last_run_id = task.run_id
    pub.latest_raw_id = raw.id
    pub.provenance = ([*(pub.provenance or []), prov])[-MAX_PROVENANCE:]
    session.flush()
    for key in {f"id:{n.platform_post_id}", *n.aliases}:
        exists = session.scalar(select(PublicationAlias).where(PublicationAlias.platform == n.platform,
                                                               PublicationAlias.alias_key == key))
        if not exists:
            session.add(PublicationAlias(platform=n.platform, alias_key=key, publication_id=pub.id))
    session.flush()
    return pub, created


# --------------------------------------------------------------------------- coverage ledger
def record_coverage(session: Session, account_id: int, start: datetime, end: datetime, task_id: int) -> None:
    session.add(CoverageInterval(account_id=account_id, start_utc=start, end_utc=end, task_id=task_id))


def merged_coverage(session: Session, account_id: int) -> list[tuple[datetime, datetime]]:
    rows = session.scalars(select(CoverageInterval).where(CoverageInterval.account_id == account_id)
                           .order_by(CoverageInterval.start_utc)).all()
    out: list[list[datetime]] = []
    for r in rows:
        if out and r.start_utc <= out[-1][1]:
            out[-1][1] = max(out[-1][1], r.end_utc)
        else:
            out.append([r.start_utc, r.end_utc])
    return [(a, b) for a, b in out]


def is_covered(session: Session, account_id: int, start: datetime, end: datetime) -> bool:
    return any(a <= start and b >= end for a, b in merged_coverage(session, account_id))


def uncovered_start(session: Session, account_id: int, start: datetime, end: datetime) -> Optional[datetime]:
    """Earliest instant in [start, end) not covered by the ledger (None if fully covered)."""
    cursor = start
    for a, b in merged_coverage(session, account_id):
        if a <= cursor < b:
            cursor = b
    return None if cursor >= end else cursor


def publications_in_window(session: Session, account_id: int, start: datetime, end: datetime) -> list[Publication]:
    return list(session.scalars(select(Publication).where(Publication.account_id == account_id,
                                                          Publication.published_at_utc >= start,
                                                          Publication.published_at_utc < end)).all())


def latest_covered_day(session: Session, account_ids: list[int]) -> Optional[date]:
    """Latest reporting day (Asia/Kolkata, no overlap) that every given account has fully covered by
    live collections. Coverage recorded by fixture runs is ignored. Re-collecting that day in incremental
    mode with overlap 0 makes no provider calls."""
    if not account_ids:
        return None
    common: Optional[set[date]] = None
    for account_id in account_ids:
        rows = session.execute(
            select(CoverageInterval.start_utc, CoverageInterval.end_utc)
            .join(CollectionTask, CollectionTask.id == CoverageInterval.task_id)
            .where(CoverageInterval.account_id == account_id,
                   func.lower(CollectionTask.provider).not_like("%fixture%"))
            .order_by(CoverageInterval.start_utc)).all()
        merged: list[list[datetime]] = []
        for a, b in rows:
            if merged and a <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], b)
            else:
                merged.append([a, b])
        days: set[date] = set()
        for a, b in merged:
            d = reporting_date(a) - timedelta(days=1)
            while d <= reporting_date(b):
                lo, hi = period_bounds_utc(d, d)
                if a <= lo and hi <= b:
                    days.add(d)
                d += timedelta(days=1)
        common = days if common is None else common & days
        if not common:
            return None
    return max(common) if common else None
