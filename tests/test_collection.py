"""Orchestration: safe reruns, dedup, coverage, partial/failed collections (fixture providers only)."""
from __future__ import annotations

from datetime import datetime
from typing import Iterator, Optional

from sqlalchemy import func, select

from app.collection import store
from app.collection.service import create_run, execute_run, mark_interrupted
from app.models import Account, CollectionRun, CollectionTask, Publication, PublicationAlias
from app.normalize.model import NormalizedPublication
from app.providers.base import (CollectionRequest, FetchPage, ProviderAdapter, ProviderCapabilities, ProviderError,
                                RawItem)
from app.providers.factory import build_adapter
from tests.conftest import PERIOD


def run_period(session_factory, settings, campaign, account_ids, adapter_factory=None, mode="window"):
    with session_factory() as s:
        run = create_run(s, settings, campaign_id=campaign.id, period_start=PERIOD, period_end=PERIOD,
                         account_ids=account_ids, actor="test", mode=mode)
        s.commit()
        rid = run.id
    status = execute_run(session_factory, rid, adapter_factory or (lambda p: build_adapter(settings, p)))
    return rid, status


def count(session, model) -> int:
    return session.scalar(select(func.count(model.id)))


def test_fixture_run_is_complete_and_rerun_does_not_duplicate(session_factory, settings, campaign, accounts):
    ids = [a.id for a in accounts.values()]
    rid, status = run_period(session_factory, settings, campaign, ids)
    assert status == "completed"
    with session_factory() as s:
        n1 = count(s, Publication)
        tasks = s.scalars(select(CollectionTask).where(CollectionTask.run_id == rid)).all()
        assert all(t.window_complete for t in tasks)
        # The duplicated Facebook reel and the Instagram reel returned by both 'posts' and 'reels' passes
        # are each stored once.
        assert s.scalar(select(func.count(Publication.id)).where(Publication.platform_post_id == "SAMPLEreel3")) == 1
        assert s.scalar(select(func.count(Publication.id)).where(Publication.platform_post_id == "900000000000002")) == 1
    rid2, status2 = run_period(session_factory, settings, campaign, ids)
    with session_factory() as s:
        assert count(s, Publication) == n1
        t2 = s.scalars(select(CollectionTask).where(CollectionTask.run_id == rid2)).all()
        assert sum(t.items_new for t in t2) == 0 and sum(t.items_updated for t in t2) > 0


def test_x_timeline_stops_after_streak_of_older_items(session_factory, settings, campaign, accounts):
    rid, _ = run_period(session_factory, settings, campaign, [accounts["x"].id])
    with session_factory() as s:
        t = s.scalar(select(CollectionTask).where(CollectionTask.run_id == rid))
        assert t.window_complete and "past window start" in t.coverage_note
        pinned = s.scalar(select(Publication).where(Publication.platform_post_id == "1800000000000000001"))
        assert pinned.is_pinned is True  # pinned old tweet did not stop paging and is marked


def test_incremental_mode_skips_covered_window(session_factory, settings, campaign, accounts):
    run_period(session_factory, settings, campaign, [accounts["youtube"].id])
    rid, _ = run_period(session_factory, settings, campaign, [accounts["youtube"].id], mode="incremental")
    with session_factory() as s:
        t = s.scalar(select(CollectionTask).where(CollectionTask.run_id == rid))
        assert t.status == "complete" and t.items_received == 0 and "already fully covered" in t.coverage_note
        first = s.scalars(select(CollectionTask).where(CollectionTask.run_id != rid)).first()
        assert t.items_in_window == first.items_in_window > 0  # stored posts still reported


def test_alias_dedup_merges_same_video_with_different_post_ids(session_factory, accounts, settings, campaign):
    with session_factory() as s:
        run = create_run(s, settings, campaign_id=campaign.id, period_start=PERIOD, period_end=PERIOD,
                         account_ids=[accounts["facebook"].id], actor="t")
        s.flush()
        task = run.tasks[0]
        acc = accounts["facebook"]
        acc = s.merge(acc)
        base = dict(platform="facebook", provider="p", author_handle="h", published_at_utc=datetime(2026, 10, 12, 5))
        n1 = NormalizedPublication(platform_post_id="111", url="https://www.facebook.com/x/posts/111",
                                   aliases=["video:555"], metrics={"views": 10, "shares": 2}, **base)
        n2 = NormalizedPublication(platform_post_id="555", url="https://www.facebook.com/reel/555",
                                   aliases=["video:555"], metrics={"views": 12, "shares": None}, **base)
        raw = store.save_raw(s, task, {"a": 1}, "111")
        p1, c1 = store.upsert_publication(s, n1, acc, task, raw)
        p2, c2 = store.upsert_publication(s, n2, acc, task, raw)
        assert c1 and not c2 and p1.id == p2.id
        assert p2.metrics == {"views": 12, "shares": 2}  # None never overwrites an observed value
        assert s.scalar(select(func.count(PublicationAlias.id)).where(PublicationAlias.publication_id == p1.id)) >= 3


class FailingAfterFirstPage(ProviderAdapter):
    name = "failing"
    platform = "x"
    capabilities = ProviderCapabilities("x", False, False, True, True, True, True, False)

    def __init__(self, kind="rate_limited", first_page=True):
        self.kind, self.first_page = kind, first_page

    def fetch_pages(self, request: CollectionRequest) -> Iterator[FetchPage]:
        if self.first_page:
            yield FetchPage(items=[RawItem({"id": "1", "createdAt": "Mon Oct 12 10:00:00 +0000 2026", "text": "दुष्काळ टंचाई",
                                            "author": {"userName": "MahaDGIPR"}}, "1")], resume_state={"cursor": "c1"})
        raise ProviderError(self.kind, "simulated provider failure", retryable=False)

    def normalize(self, item: RawItem) -> Optional[NormalizedPublication]:
        from app.normalize.x import from_twitterapi_io
        return from_twitterapi_io(item.payload, provider=self.name)


def test_partial_collection_is_recorded_and_never_complete(session_factory, settings, campaign, accounts):
    rid, status = run_period(session_factory, settings, campaign, [accounts["x"].id],
                             adapter_factory=lambda p: FailingAfterFirstPage())
    assert status == "partial"
    with session_factory() as s:
        t = s.scalar(select(CollectionTask).where(CollectionTask.run_id == rid))
        assert t.status == "partial" and t.window_complete is False and t.error_kind == "rate_limited"
        assert t.resume_state == {"cursor": "c1"}  # retry resumes from here
        assert not store.is_covered(s, accounts["x"].id, datetime(2026, 10, 11, 18, 30), datetime(2026, 10, 12, 18, 30))


def test_failed_collection_and_missing_credentials(session_factory, settings, campaign, accounts):
    rid, status = run_period(session_factory, settings, campaign, [accounts["x"].id],
                             adapter_factory=lambda p: FailingAfterFirstPage("auth", first_page=False))
    assert status == "failed"
    settings.provider_x = "twitterapi_io"
    settings.twitterapi_io_key = ""
    rid2, status2 = run_period(session_factory, settings, campaign, [accounts["x"].id])
    with session_factory() as s:
        t = s.scalar(select(CollectionTask).where(CollectionTask.run_id == rid2))
        assert status2 == "failed" and t.error_kind == "config" and "TWITTERAPI_IO_KEY" in t.error_message


def test_interrupted_runs_are_not_left_running(session_factory, settings, campaign, accounts):
    with session_factory() as s:
        run = create_run(s, settings, campaign_id=campaign.id, period_start=PERIOD, period_end=PERIOD,
                         account_ids=[accounts["x"].id], actor="t")
        run.status = "running"
        run.tasks[0].status = "running"
        s.commit()
        assert mark_interrupted(s) == 1
        s.commit()
        r = s.get(CollectionRun, run.id)
        assert r.status == "interrupted" and r.tasks[0].window_complete is False


def test_resolved_ids_are_not_reused_across_providers(session_factory, settings, campaign, accounts):
    """A channel ID resolved by one provider (e.g. a fixture run) must not be used by another."""
    yt = accounts["youtube"].id
    with session_factory() as s:
        acc = s.get(Account, yt)
        acc.external_id = "UCstale"
        acc.provider_meta = {"uploads_playlist_id": "UUstale", "resolved_by": "some_other_provider"}
        s.commit()
    rid, status = run_period(session_factory, settings, campaign, [yt])
    assert status == "completed"
    with session_factory() as s:
        acc = s.get(Account, yt)
        assert acc.provider_meta["uploads_playlist_id"] != "UUstale"
        assert acc.provider_meta["resolved_by"] == "youtube_data_api[FIXTURE]"


def test_latest_covered_day_ignores_fixture_coverage(session_factory, settings, campaign, accounts):
    from app.collection.store import latest_covered_day
    ids = [a.id for a in accounts.values()]
    run_period(session_factory, settings, campaign, ids)  # fixture providers
    with session_factory() as s:
        assert latest_covered_day(s, ids) is None
        for t in s.scalars(select(CollectionTask)).all():
            t.provider = t.provider.replace("[FIXTURE]", "")  # pretend these were live collections
        s.commit()
        assert latest_covered_day(s, ids) == PERIOD


def test_paced_replay_of_covered_window_runs_accounts_one_at_a_time(session_factory, settings, campaign, accounts):
    ids = [a.id for a in accounts.values()]
    run_period(session_factory, settings, campaign, ids)
    instant, _ = run_period(session_factory, settings, campaign, ids, mode="incremental")
    with session_factory() as s:
        run = create_run(s, settings, campaign_id=campaign.id, period_start=PERIOD, period_end=PERIOD,
                         account_ids=ids, actor="test", mode="incremental")
        s.commit()
        rid = run.id
    status = execute_run(session_factory, rid, lambda p: build_adapter(settings, p), parallelism=4,
                         replay_step_seconds=0.01)
    assert status == "completed"
    with session_factory() as s:
        expected = {t.account_id: t.items_in_window for t in s.get(CollectionRun, instant).tasks}
        tasks = sorted(s.get(CollectionRun, rid).tasks, key=lambda t: t.started_at)
        assert all(t.status == "complete" and t.window_complete and t.requests_made == 0 for t in tasks)
        assert {t.account_id: t.items_in_window for t in tasks} == expected
        assert all(a.finished_at <= b.started_at for a, b in zip(tasks, tasks[1:]))
