"""Fills the MANUAL report cells for one reporting date with made-up demo values, for POC demos.

Values are the reference PDF's per-office figures (config/sample/reference_2026-10-12.yaml) with a
small seeded random variation, so the report looks realistic without copying the reference.
Automated cells (platform columns of offices with registered accounts) are left to the collection.
Every value is stored with a "DEMO" note and actor, and is audited like any manual entry.
Values are stored both for the campaign and for the report without a search term, with the same numbers.

  python scripts/load_demo_values.py --date 2026-10-15
  python scripts/load_demo_values.py --date 2026-10-15 --clear     # remove the demo values again
"""
from __future__ import annotations

import argparse
import random
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

ACTOR = "demo-data (POC, made-up values)"
NOTE = "DEMO: made-up value for POC demo, based on reference report figures; not real data"


def vary(rng: random.Random, v: int) -> int:
    if v == 0:
        return 1 if rng.random() < 0.08 else 0
    spread = max(1, v // 4)
    return max(0, v + rng.randint(-spread, spread))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True)
    ap.add_argument("--campaign", default="drought_measures")
    ap.add_argument("--seed", type=int, default=15)
    ap.add_argument("--clear", action="store_true")
    args = ap.parse_args()
    day = date.fromisoformat(args.date)

    import yaml
    from sqlalchemy import select

    from app.db import make_engine, make_session_factory
    from app.models import Campaign
    from app.settings import load_settings

    settings = load_settings()
    SessionF = make_session_factory(make_engine(settings.database_url))
    ref = yaml.safe_load((settings.config_dir / "sample" / "reference_2026-10-12.yaml").read_text(encoding="utf-8"))

    with SessionF() as s:
        campaign = s.scalar(select(Campaign).where(Campaign.slug == args.campaign))
        for cid in (campaign.id, None):
            load(s, cid, day, args, ref, random.Random(args.seed))
        s.commit()


def load(s, cid, day, args, ref, rng) -> None:
    from sqlalchemy import select

    from app.models import Account, ManualInput
    from app.reporting.columns import BY_KEY, COLUMN_KEYS
    from app.reporting.manual import set_manual_value

    label = args.campaign if cid else "no search term"
    if args.clear:
        rows = s.scalars(select(ManualInput).where(
            ManualInput.campaign_id == cid, ManualInput.period_start == day,
            ManualInput.period_end == day, ManualInput.entered_by == ACTOR)).all()
        for r in rows:
            set_manual_value(s, campaign_id=cid, start=day, end=day, office_code=r.office_code,
                             column_key=r.column_key, value=None, confirm_zero=False, actor=ACTOR,
                             note="DEMO values removed")
        print(f"cleared {len(rows)} demo values for {day} ({label})")
        return
    automated = {(a.office_code, a.platform)
                 for a in s.scalars(select(Account).where(Account.active.is_(True))).all()}
    n = 0
    for office, values in ref["values"].items():
        for key, value in zip(COLUMN_KEYS, values):
            if (office, BY_KEY[key].platform) in automated:
                continue  # comes from the live collection
            v = vary(rng, value)
            set_manual_value(s, campaign_id=cid, start=day, end=day, office_code=office,
                             column_key=key, value=v, confirm_zero=(v == 0), actor=ACTOR, note=NOTE)
            n += 1
    print(f"entered {n} demo values for {day} ({label})")


if __name__ == "__main__":
    main()
