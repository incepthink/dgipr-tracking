"""Runs one collection from the command line (same code path as the UI's "Collect" button) and
dumps what came back, so live provider responses can be inspected outside the database.

  python scripts/collect.py --date 2026-10-15                      # all accounts, configured providers
  python scripts/collect.py --date 2026-10-15 --platforms youtube   # just one platform
  python scripts/collect.py --date 2026-10-15 --platforms facebook --overlap-hours 0   # tighter window, fewer results needed
  python scripts/collect.py --dump-only --date 2026-10-15           # re-export the latest run, no API calls

Writes to samples/live_<date>/:
  raw/<platform>_task<id>.json   provider payloads exactly as stored in raw_records
  publications.json              normalised publications for the period, with classification
  run_summary.json               per-task status, coverage, counts, usage, errors
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

ACTOR = "cli-collect"


def _jsonable(v):
    return v.isoformat() if hasattr(v, "isoformat") else str(v)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True, help="reporting date (Asia/Kolkata), YYYY-MM-DD")
    ap.add_argument("--end", default=None, help="optional period end date")
    ap.add_argument("--campaign", default="drought_measures")
    ap.add_argument("--platforms", default="facebook,instagram,x,youtube")
    ap.add_argument("--overlap-hours", type=int, default=None, help="override OVERLAP_HOURS for this run")
    ap.add_argument("--dump-only", action="store_true")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    start = date.fromisoformat(args.date)
    end = date.fromisoformat(args.end) if args.end else start
    platforms = [p.strip() for p in args.platforms.split(",") if p.strip()]

    from sqlalchemy import select

    from app.collection.service import create_run, execute_run
    from app.db import init_db, make_engine, make_session_factory
    from app.models import Account, Campaign, Classification, CollectionRun, CollectionTask, Publication, RawRecord
    from app.providers.factory import build_adapter, provider_status
    from app.registry.loader import bootstrap
    from app.settings import load_settings

    settings = load_settings()
    engine = make_engine(settings.database_url)
    init_db(engine)
    SessionF = make_session_factory(engine)
    print("database:", settings.database_url)
    for row in provider_status(settings):
        print(f"  {row['platform']:<10} {row['provider']:<18} credentials: {row['credentials']}")

    with SessionF() as s:
        bootstrap(s, settings.config_dir)
        campaign = s.scalar(select(Campaign).where(Campaign.slug == args.campaign))
        if campaign is None:
            sys.exit(f"campaign {args.campaign!r} not found")
        campaign_id = campaign.id
        if args.dump_only:
            run = s.scalar(select(CollectionRun).where(CollectionRun.period_start == start,
                                                       CollectionRun.period_end == end)
                           .order_by(CollectionRun.id.desc()))
            if run is None:
                sys.exit("no run for that period")
            run_id = run.id
        else:
            accounts = s.scalars(select(Account).where(Account.platform.in_(platforms))).all()
            run = create_run(s, settings, campaign_id=campaign_id, period_start=start, period_end=end,
                             account_ids=[a.id for a in accounts], actor=ACTOR,
                             overlap_hours=args.overlap_hours)
            s.commit()
            run_id = run.id

    if not args.dump_only:
        print(f"run {run_id}: collecting {start}..{end} for {', '.join(platforms)} (this can take a few minutes)")
        status = execute_run(SessionF, run_id, lambda p: build_adapter(settings, p),
                             max_pages=settings.max_pages_per_account, parallelism=settings.collection_parallelism)
        print("run status:", status)

    out = Path(args.out) if args.out else ROOT / "samples" / f"live_{start.isoformat()}"
    (out / "raw").mkdir(parents=True, exist_ok=True)
    with SessionF() as s:
        run = s.get(CollectionRun, run_id)
        summary = {"run_id": run.id, "status": run.status, "period": [str(run.period_start), str(run.period_end)],
                   "window_utc": [_jsonable(run.window_start_utc), _jsonable(run.window_end_utc)], "tasks": []}
        for t in s.scalars(select(CollectionTask).where(CollectionTask.run_id == run_id)).all():
            acc = s.get(Account, t.account_id)
            summary["tasks"].append({
                "task_id": t.id, "platform": t.platform, "provider": t.provider, "account": acc.handle,
                "status": t.status, "window_complete": t.window_complete, "coverage_note": t.coverage_note,
                "items_received": t.items_received, "items_in_window": t.items_in_window, "items_new": t.items_new,
                "items_updated": t.items_updated, "items_unparseable": t.items_unparseable,
                "requests_made": t.requests_made, "usage": t.usage, "error_kind": t.error_kind,
                "error_message": t.error_message})
            raws = s.scalars(select(RawRecord).where(RawRecord.task_id == t.id).order_by(RawRecord.id)).all()
            (out / "raw" / f"{t.platform}_task{t.id}.json").write_text(
                json.dumps([r.payload for r in raws], ensure_ascii=False, indent=2), encoding="utf-8")
        pubs = []
        q = (select(Publication, Classification)
             .outerjoin(Classification, (Classification.publication_id == Publication.id)
                        & (Classification.campaign_id == campaign_id))
             .where(Publication.reporting_date >= start, Publication.reporting_date <= end,
                    ~Publication.provider.like("%FIXTURE%"))
             .order_by(Publication.platform, Publication.published_at_utc))
        for p, c in s.execute(q).all():
            pubs.append({"platform": p.platform, "provider": p.provider, "id": p.platform_post_id, "url": p.url,
                         "author": p.author_handle, "published_at_utc": _jsonable(p.published_at_utc),
                         "reporting_date": str(p.reporting_date), "content_type": p.content_type,
                         "is_repost": p.is_repost, "is_reply": p.is_reply, "is_pinned": p.is_pinned,
                         "is_short": p.is_short, "title": p.title, "text": p.text, "metrics": p.metrics,
                         "attributes": p.attributes, "office_code": p.office_code,
                         "auto_decision": c.auto_decision if c else None})
        (out / "publications.json").write_text(json.dumps(pubs, ensure_ascii=False, indent=2), encoding="utf-8")
        (out / "run_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=_jsonable),
                                              encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2, default=_jsonable))
    by = {}
    for p in pubs:
        by.setdefault(p["platform"], {}).setdefault(p["auto_decision"], 0)
        by[p["platform"]][p["auto_decision"]] += 1
    print("publications in period by platform/decision:", json.dumps(by))
    print("written to", out)


if __name__ == "__main__":
    main()
