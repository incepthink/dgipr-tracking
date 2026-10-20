"""Move the old office entries (12 fixed columns per campaign) into report forms. Safe to re-run: campaigns that
already have a linked form are skipped. The web app also runs this once at startup when no form exists yet.
Back up the database first (on EC2: copy data/dgipr.sqlite3).

  python scripts/migrate_entries_to_forms.py --dry-run    # what would be migrated, no writes
  python scripts/migrate_entries_to_forms.py
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    from app.db import init_db, make_engine, make_session_factory
    from app.forms.migrate import migrate
    from app.registry.loader import bootstrap
    from app.settings import load_settings

    settings = load_settings()
    engine = make_engine(settings.database_url)
    init_db(engine)
    with make_session_factory(engine)() as s:
        bootstrap(s, settings.config_dir)
        report = migrate(s)
        print(json.dumps(report, ensure_ascii=False, indent=1))
        if args.dry_run:
            s.rollback()
            print("dry run: nothing written")
        else:
            s.commit()


if __name__ == "__main__":
    main()
