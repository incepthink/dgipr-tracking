"""Collection orchestration.

`create_run` records what the operator asked for; `execute_run` performs it. `execute_run` has no
web dependencies, so a future scheduler can call it directly (see executor.py).

Window completeness per account (CollectionTask.window_complete):
  * True  — the provider ran out of data, or applied the date window server-side without hitting our
            result limit, or paging reached a run of non-pinned items older than the window start.
  * False — stopped by a result/page cap, an error, or a timeout before the window was covered.
A task that fails or is incomplete is never reported as zero activity: the report marks the
affected cells incomplete and blocks final approval.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import date, timedelta
from typing import Callable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app import audit
from app.classification.service import classify_publication
from app.collection import store
from app.models import Account, Campaign, CollectionRun, CollectionTask
from app.providers.base import AccountRef, CollectionRequest, ProviderAdapter, ProviderError
from app.providers.factory import configured_provider
from app.settings import Settings
from app.timeutil import fetch_window_utc, utcnow

log = logging.getLogger("dgipr.collection")

OLDER_STREAK_TO_STOP = 5   # consecutive non-pinned items older than the window before we stop paging

AdapterFactory = Callable[[str], ProviderAdapter]


def create_run(session: Session, settings: Settings, *, campaign_id: Optional[int], period_start: date,
               period_end: date, account_ids: list[int], actor: str, overlap_hours: Optional[int] = None,
               mode: str = "window", trigger_source: str = "manual") -> CollectionRun:
    if period_end < period_start:
        raise ValueError("period end is before period start")
    if not account_ids:
        raise ValueError("select at least one account")
    overlap = settings.overlap_hours if overlap_hours is None else overlap_hours
    w_start, w_end = fetch_window_utc(period_start, period_end, overlap)
    run = CollectionRun(campaign_id=campaign_id, period_start=period_start, period_end=period_end,
                        window_start_utc=w_start, window_end_utc=w_end, overlap_hours=overlap, mode=mode,
                        status="queued", triggered_by=actor, trigger_source=trigger_source)
    session.add(run)
    session.flush()
    for acc in session.scalars(select(Account).where(Account.id.in_(account_ids))).all():
        session.add(CollectionTask(run_id=run.id, account_id=acc.id, platform=acc.platform,
                                   provider=configured_provider(settings, acc.platform),
                                   requested_start_utc=w_start, requested_end_utc=w_end))
    audit.record(session, actor, "run.create", "collection_run", run.id,
                 after={"period": [str(period_start), str(period_end)], "accounts": account_ids,
                        "overlap_hours": overlap, "mode": mode})
    return run


def execute_run(session_factory: sessionmaker[Session], run_id: int, adapter_factory: AdapterFactory,
                *, max_pages: int = 50, parallelism: int = 1, only_task_ids: Optional[list[int]] = None,
                replay_step_seconds: float = 0.0) -> str:
    with session_factory() as s:
        run = s.get(CollectionRun, run_id)
        if run is None:
            raise ValueError(f"run {run_id} not found")
        run.status, run.started_at = "running", run.started_at or utcnow()
        task_ids = [t.id for t in run.tasks if (only_task_ids is None or t.id in only_task_ids)]
        s.commit()

    replay_lock = threading.Lock()   # paced replays run one account at a time; live tasks stay parallel

    def work(tid: int) -> None:
        try:
            execute_task(session_factory, tid, adapter_factory, max_pages=max_pages,
                         replay_step_seconds=replay_step_seconds, replay_lock=replay_lock)
        except Exception:  # never let one account break the run
            log.exception("task %s crashed", tid)
            with session_factory() as s2:
                t = s2.get(CollectionTask, tid)
                if t and t.status in ("pending", "running"):
                    t.status, t.error_kind = "failed", "internal"
                    t.error_message = "internal error (see server log)"
                    t.window_complete, t.finished_at = False, utcnow()
                    s2.commit()

    if parallelism > 1 and len(task_ids) > 1:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=parallelism) as pool:
            list(pool.map(work, task_ids))
    else:
        for tid in task_ids:
            work(tid)

    with session_factory() as s:
        run = s.get(CollectionRun, run_id)
        assert run is not None
        statuses = [t.status for t in run.tasks]
        if all(st == "complete" for st in statuses):
            run.status = "completed"
        elif any(st in ("complete", "partial") for st in statuses):
            run.status = "partial"
        else:
            run.status = "failed"
        run.finished_at = utcnow()
        s.commit()
        return run.status


def execute_task(session_factory: sessionmaker[Session], task_id: int, adapter_factory: AdapterFactory,
                 *, max_pages: int = 50, replay_step_seconds: float = 0.0,
                 replay_lock: Optional[threading.Lock] = None) -> None:
    with session_factory() as s:
        task = s.get(CollectionTask, task_id)
        assert task is not None
        run = task.run
        account = task.account
        campaign = s.get(Campaign, run.campaign_id) if run.campaign_id else None
        task.status, task.started_at, task.finished_at = "running", utcnow(), None
        task.error_kind = task.error_message = None
        s.commit()

        w_start, w_end = task.requested_start_utc or run.window_start_utc, task.requested_end_utc or run.window_end_utc
        if run.mode == "incremental":
            first_gap = store.uncovered_start(s, account.id, w_start, w_end)
            if first_gap is None:
                # No provider calls, but report what is already stored and classify it for this campaign.
                if replay_step_seconds > 0 and replay_lock is not None:
                    task.status, task.progress_message = "pending", "waiting for the previous account"
                    s.commit()
                    with replay_lock:
                        _replay_covered(s, task, campaign, w_start, w_end, replay_step_seconds)
                    return
                stored = store.publications_in_window(s, account.id, w_start, w_end)
                task.items_in_window = len(stored)
                if campaign is not None:
                    for pub in stored:
                        classify_publication(s, pub, campaign)
                _finish(s, task, "complete", True, f"window already fully covered by earlier collections; "
                                                   f"{len(stored)} stored post(s) in window, no provider calls")
                return
            w_start = max(w_start, first_gap - timedelta(hours=run.overlap_hours))

        try:
            adapter = adapter_factory(account.platform)
        except ProviderError as exc:
            _finish(s, task, "failed", False, "", exc.kind, str(exc))
            return
        task.provider = adapter.name
        # Resolved IDs are only reused by the provider that resolved them, so a fixture run can never
        # leave synthetic channel IDs behind for a live provider (or vice versa).
        meta = dict(account.provider_meta or {})
        same_provider = meta.get("resolved_by") == adapter.name
        ref = AccountRef(account_id=account.id, platform=account.platform, handle=account.handle, url=account.url,
                         external_id=account.external_id if same_provider else None,
                         provider_meta=meta if same_provider else {})
        try:
            resolved = adapter.resolve_account(ref)
        except ProviderError as exc:
            _finish(s, task, "failed", False, "could not resolve account", exc.kind, str(exc))
            return
        if resolved:
            account.external_id = resolved.get("external_id", account.external_id)
            account.provider_meta = {**resolved.get("provider_meta", {}), "resolved_by": adapter.name}
            ref.external_id, ref.provider_meta = account.external_id, dict(account.provider_meta or {})
            s.commit()

        request = CollectionRequest(account=ref, window_start_utc=w_start, window_end_utc=w_end,
                                    max_pages=max_pages, resume_state=dict(task.resume_state or {}))
        older_streak = 0
        reached_before_window = False
        limit_reached = False
        stopped_by_cap = False
        error: Optional[ProviderError] = None
        pages = adapter.fetch_pages(request)
        try:
            for page in pages:
                task.pages_fetched += 1
                task.resume_state = page.resume_state or {}
                if page.limit_reached:
                    limit_reached = True
                for item in page.items:
                    task.items_received += 1
                    raw = store.save_raw(s, task, item.payload, item.external_id)
                    try:
                        n = adapter.normalize(item)
                    except Exception as exc:  # malformed provider item: keep raw, count it, carry on
                        log.warning("normalise failed for raw %s: %s", raw.id, exc)
                        n = None
                    if n is None:
                        task.items_unparseable += 1
                        continue
                    if w_start <= n.published_at_utc < w_end:
                        task.items_in_window += 1
                    pub, created = store.upsert_publication(s, n, account, task, raw)
                    task.items_new += int(created)
                    task.items_updated += int(not created)
                    if campaign is not None:
                        classify_publication(s, pub, campaign)
                    if n.published_at_utc < w_start and not n.is_pinned:
                        older_streak += 1
                    elif n.published_at_utc >= w_start:
                        older_streak = 0
                task.progress_message = page.note
                task.usage = {**(task.usage or {}), **page.usage, **adapter.usage_counters()}
                s.commit()
                if not adapter.capabilities.server_side_window and older_streak >= OLDER_STREAK_TO_STOP:
                    reached_before_window = True
                    break
                if task.pages_fetched >= max_pages and not adapter.capabilities.async_job:
                    stopped_by_cap = True
                    break
        except ProviderError as exc:
            error = exc
        finally:
            close = getattr(pages, "close", None)
            if close:
                close()

        task.requests_made = getattr(getattr(adapter, "http", None), "requests_made", task.requests_made)
        task.usage = {**(task.usage or {}), **adapter.usage_counters()}
        if error is not None:
            got = task.items_received > 0
            _finish(s, task, "partial" if got else "failed", False,
                    "collection interrupted; earlier pages kept" if got else "", error.kind, str(error))
            return
        if reached_before_window:
            _finish(s, task, "complete", True, f"paged back past window start ({OLDER_STREAK_TO_STOP} consecutive "
                                               f"older non-pinned items)", window=(w_start, w_end))
        elif stopped_by_cap:
            _finish(s, task, "partial", False, f"stopped at page cap ({max_pages}) before reaching window start")
        elif limit_reached and older_streak == 0:
            _finish(s, task, "partial", False, "provider result limit reached before older items were seen; "
                                               "window may be truncated — raise the results limit")
        else:
            note = "provider applied the date window and returned all results" if adapter.capabilities.server_side_window \
                else "provider has no more items"
            _finish(s, task, "complete", True, note, window=(w_start, w_end))


def _replay_covered(s: Session, task: CollectionTask, campaign: Optional[Campaign], w_start, w_end,
                    step: float) -> None:
    """POC pacing for an already-covered window: same result as the instant path, shown in visible stages."""
    def stage(msg: str) -> None:
        task.progress_message = msg
        s.commit()
        time.sleep(step)

    task.status, task.started_at = "running", utcnow()
    stage(f"connecting to {task.provider}…")
    stage("checking stored coverage for the period…")
    stored = store.publications_in_window(s, task.account_id, w_start, w_end)
    stage(f"fetching posts… {len(stored)} found in the period")
    chunk = max(1, -(-len(stored) // 3))   # at most three visible steps
    for i in range(0, len(stored), chunk):
        part = stored[i:i + chunk]
        if campaign is not None:
            for pub in part:
                classify_publication(s, pub, campaign)
        task.items_in_window = i + len(part)
        stage(f"classifying posts… {task.items_in_window}/{len(stored)}")
    _finish(s, task, "complete", True, f"window already fully covered by earlier collections; "
                                       f"{len(stored)} stored post(s) in window, no provider calls")


def _finish(s: Session, task: CollectionTask, status: str, complete: bool, note: str,
            error_kind: Optional[str] = None, error_message: Optional[str] = None,
            window: Optional[tuple] = None) -> None:
    task.status, task.window_complete, task.coverage_note = status, complete, note
    task.error_kind, task.error_message = error_kind, error_message
    task.finished_at = utcnow()
    if complete and window:
        store.record_coverage(s, task.account_id, window[0], window[1], task.id)
        task.resume_state = {}
    s.commit()


def mark_interrupted(session: Session) -> int:
    """Called at startup: runs left 'running' by a crash/restart are marked interrupted, not complete."""
    n = 0
    for run in session.scalars(select(CollectionRun).where(CollectionRun.status.in_(("running", "queued")))).all():
        for t in run.tasks:
            if t.status in ("pending", "running"):
                t.status, t.window_complete = "failed", False
                t.error_kind, t.error_message = "interrupted", "server stopped during collection; re-run to resume"
        run.status = "interrupted"
        n += 1
    return n
