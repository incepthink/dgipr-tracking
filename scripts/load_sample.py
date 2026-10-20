"""Builds the clearly labelled SAMPLE report end to end, without credentials.

  1. fresh sample database (DATA_DIR/sample by default)
  2. fixture providers (synthetic responses through the real adapters)
  3. collection run for 2026-10-12 (Asia/Kolkata) over the four registered accounts
  4. a DRAFT snapshot while manual columns are still missing  -> samples/sample_draft_incomplete.pdf
  5. review decisions + manual inputs transcribed from the reference PDF
  6. a FINAL snapshot flagged is_sample                       -> samples/sample_report_2026-10-12.pdf

Every PDF produced here carries a "नमुना माहिती · SAMPLE DATA" watermark.
Usage:  python scripts/load_sample.py [--data-dir PATH] [--keep]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

SAMPLE_ACTOR = "sample-loader (SAMPLE DATA)"
PERIOD = date(2026, 10, 12)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=None)
    ap.add_argument("--out", default=str(ROOT / "samples"))
    ap.add_argument("--keep", action="store_true", help="do not wipe an existing sample database")
    args = ap.parse_args()

    from app.settings import load_settings
    base = load_settings()
    data_dir = Path(args.data_dir) if args.data_dir else base.data_dir / "sample"
    if data_dir.exists() and not args.keep:
        shutil.rmtree(data_dir)
    os.environ.update({"DATA_DIR": str(data_dir), "DATABASE_URL": "", "PROVIDER_FACEBOOK": "fixture",
                       "PROVIDER_INSTAGRAM": "fixture", "PROVIDER_X": "fixture", "PROVIDER_YOUTUBE": "fixture"})
    settings = load_settings()
    settings.data_dir, settings.database_url = data_dir, f"sqlite:///{(data_dir / 'dgipr.sqlite3').as_posix()}"
    for p in ("facebook", "instagram", "x", "youtube"):
        setattr(settings, f"provider_{p}", "fixture")
    data_dir.mkdir(parents=True, exist_ok=True)

    import yaml
    from sqlalchemy import select

    from app import audit
    from app.classification.service import accept_auto_matches, set_manual_decision
    from app.collection.service import create_run, execute_run
    from app.db import init_db, make_engine, make_session_factory
    from app.models import Account, Campaign, Classification, Publication
    from app.providers.factory import build_adapter
    from app.registry.loader import bootstrap, report_format
    from app.reporting.columns import COLUMN_KEYS, BY_KEY
    from app.reporting.exports import evidence_csv, matrix_csv
    from app.reporting.manual import set_manual_value
    from app.reporting.snapshot import create_snapshot

    engine = make_engine(settings.database_url)
    init_db(engine)
    SessionF = make_session_factory(engine)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    fmt = report_format(settings.config_dir)

    with SessionF() as s:
        bootstrap(s, settings.config_dir)
        campaign = s.scalar(select(Campaign).where(Campaign.slug == "drought_measures"))
        for acc in s.scalars(select(Account)).all():
            acc.mapping_confirmed = True
            audit.record(s, SAMPLE_ACTOR, "account.confirm_mapping", "account", acc.id,
                         after={"office": acc.office_code}, note="SAMPLE: mapping confirmed for the demo dataset")
        run = create_run(s, settings, campaign_id=campaign.id, period_start=PERIOD, period_end=PERIOD,
                         account_ids=[a.id for a in s.scalars(select(Account)).all()], actor=SAMPLE_ACTOR)
        s.commit()
        run_id, campaign_id = run.id, campaign.id

    status = execute_run(SessionF, run_id, lambda p: build_adapter(settings, p), max_pages=settings.max_pages_per_account)
    print("collection run", run_id, status)

    with SessionF() as s:
        campaign = s.get(Campaign, campaign_id)
        draft = create_snapshot(s, campaign, PERIOD, PERIOD, kind="draft", actor=SAMPLE_ACTOR, fmt=fmt,
                                pdf_dir=settings.pdf_dir, browser_channel=settings.pdf_browser_channel,
                                is_sample=True, note="SAMPLE draft before review and manual inputs")
        s.commit()
        shutil.copy(draft.pdf_path, out / "sample_draft_incomplete.pdf")

        # Review: decide the in-period items the classifier could not settle, then accept proposed matches.
        decisions = {("instagram", "SAMPLEig007"): ("exclude", "SAMPLE review: image-only post; image shows an unrelated event"),
                     ("instagram", "SAMPLEreel8"): ("exclude", "SAMPLE review: general water-conservation visit, not the drought campaign")}
        for (platform, pid), (decision, note) in decisions.items():
            pub = s.scalar(select(Publication).where(Publication.platform == platform, Publication.platform_post_id == pid))
            cls = s.scalar(select(Classification).where(Classification.publication_id == pub.id,
                                                        Classification.campaign_id == campaign_id))
            set_manual_decision(s, cls, decision, SAMPLE_ACTOR, note=note)
        rows = s.scalars(select(Classification).join(Publication).where(
            Classification.campaign_id == campaign_id, Publication.reporting_date == PERIOD)).all()
        accept_auto_matches(s, rows, SAMPLE_ACTOR)

        ref = yaml.safe_load((settings.config_dir / "sample" / "reference_2026-10-12.yaml").read_text(encoding="utf-8"))
        hq_accounts = {a.platform for a in s.scalars(select(Account).where(Account.office_code == "mumbai_hq")).all()}
        for office, values in ref["values"].items():
            for key, value in zip(COLUMN_KEYS, values):
                if office == "mumbai_hq" and BY_KEY[key].platform in hq_accounts:
                    continue  # automated from the fixture collection
                set_manual_value(s, campaign_id=campaign_id, start=PERIOD, end=PERIOD, office_code=office,
                                 column_key=key, value=value, confirm_zero=(value == 0), actor=SAMPLE_ACTOR,
                                 note="SAMPLE: transcribed from reference PDF 13.10.2026")
        s.commit()

        final = create_snapshot(s, campaign, PERIOD, PERIOD, kind="final", actor=SAMPLE_ACTOR, fmt=fmt,
                                pdf_dir=settings.pdf_dir, browser_channel=settings.pdf_browser_channel,
                                is_sample=True, note="SAMPLE final report built from fixtures + reference values")
        s.commit()
        shutil.copy(final.pdf_path, out / "sample_report_2026-10-12.pdf")
        (out / "sample_snapshot_2026-10-12.json").write_text(json.dumps(final.data, ensure_ascii=False, indent=1),
                                                             encoding="utf-8")
        (out / "sample_evidence_2026-10-12.csv").write_text(evidence_csv(final.data), encoding="utf-8")
        (out / "sample_matrix_2026-10-12.csv").write_text(matrix_csv(final.data), encoding="utf-8")
        print("draft snapshot", draft.id, "issues:", len(draft.data["issues"]))
        print("final snapshot", final.id, "complete:", final.data["complete"], "pdf:", final.pdf_path)
        hq = next(d for d in final.data["divisions"] if d["code"] == "mumbai_hq")["offices"][0]["cells"]
        print("HQ automated cells:", {k: hq[k]["value"] for k in ("facebook", "instagram", "x", "youtube")})
        print("grand total:", {k: v["value"] for k, v in final.data["grand_total"].items()})


if __name__ == "__main__":
    main()
