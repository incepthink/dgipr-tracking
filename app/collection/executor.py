"""Background execution of collection runs for the web UI.

The executor is a thin wrapper around `execute_run`; a scheduler (cron, APScheduler, Celery...) can
be added later by calling `create_run(..., trigger_source="scheduler")` and `submit(run_id)`."""
from __future__ import annotations

import logging
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Optional

from sqlalchemy.orm import Session, sessionmaker

from app.collection.service import execute_run
from app.providers.factory import build_adapter
from app.settings import Settings

log = logging.getLogger("dgipr.executor")


class RunExecutor:
    def __init__(self, settings: Settings, session_factory: sessionmaker[Session], max_concurrent_runs: int = 2):
        self.settings = settings
        self.session_factory = session_factory
        self.pool = ThreadPoolExecutor(max_workers=max_concurrent_runs, thread_name_prefix="collect")
        self.futures: dict[int, Future] = {}

    def submit(self, run_id: int, only_task_ids: Optional[list[int]] = None) -> None:
        def job() -> str:
            return execute_run(self.session_factory, run_id, lambda p: build_adapter(self.settings, p),
                               max_pages=self.settings.max_pages_per_account,
                               parallelism=self.settings.collection_parallelism, only_task_ids=only_task_ids,
                               replay_step_seconds=self.settings.replay_step_seconds)

        fut = self.pool.submit(job)
        fut.add_done_callback(lambda f: f.exception() and log.error("run %s failed: %s", run_id, f.exception()))
        self.futures[run_id] = fut

    def is_active(self, run_id: int) -> bool:
        f = self.futures.get(run_id)
        return bool(f and not f.done())
