"""Creates demo district logins and fills every due period of every published form for them with made-up values.

Existing submissions are left untouched; only missing periods (from each form's start to today) are filled and
submitted, through the normal save/submit path so they are audited like any office entry.

  python scripts/seed_demo_districts.py                       # default: solapur satara nagpur nashik (+ pune)
  python scripts/seed_demo_districts.py --password Secret123 --offices solapur nagpur
"""
from __future__ import annotations

import argparse
import random
import sys
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

NEW_OFFICES = ["solapur", "satara", "nagpur", "nashik"]
EXISTING = ["pune"]
NOTE = "DEMO: made-up values"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offices", nargs="+", default=NEW_OFFICES)
    ap.add_argument("--password", default="12345678")
    ap.add_argument("--seed", type=int, default=19)
    args = ap.parse_args()

    from sqlalchemy import select

    from app import audit
    from app.auth import hash_password
    from app.db import make_engine, make_session_factory
    from app.forms import service
    from app.forms.periods import periods
    from app.forms.schema import active_fields, recipient_codes
    from app.models import Form, Office, User
    from app.settings import load_settings
    from app.timeutil import today_ist

    settings = load_settings()
    SessionF = make_session_factory(make_engine(settings.database_url))
    rng = random.Random(args.seed)
    today = today_ist()

    with SessionF() as s:
        users: dict[str, User] = {}
        for code in args.offices:
            office = s.get(Office, code)
            if office is None:
                sys.exit(f"unknown office {code}")
            u = s.scalar(select(User).where(User.username == code))
            if u is None:
                u = User(username=code, display_name=office.name_en, role="district", office_code=code,
                         division_code=office.division_code, password_hash=hash_password(args.password),
                         must_change_password=False, active=True)
                s.add(u)
                s.flush()
                audit.record(s, "seed", "user.create", "user", u.id,
                             after={"username": code, "role": "district", "office": code})
                print(f"created user {code} ({office.division_code})")
            users[code] = u
        for code in EXISTING:
            if (u := s.scalar(select(User).where(User.username == code))) is not None:
                users.setdefault(code, u)

        forms = s.scalars(select(Form).where(Form.status == "published")).all()
        for form in forms:
            recipients = set(recipient_codes(s, form))
            fields = [f for f in active_fields(form) if f.type == "number"]
            end = min(today, form.end_date) if form.end_date else today
            for code, u in users.items():
                if code not in recipients:
                    continue
                scale = rng.uniform(0.6, 1.8)  # bigger and smaller offices
                for ps in periods(form, form.start_date, end):
                    if service.find(s, form, code, ps) is not None:
                        continue
                    values = {f.key: max(0, round(rng.gauss(6, 4) * scale)) for f in fields}
                    service.save(s, u, form, code, ps, values, confirm_zero=True, note=NOTE,
                                 submit=True, check=False)
                    print(f"  {form.slug} {code} {ps}: submitted")
        s.commit()
    print(f"done; new logins use password {args.password!r}")


if __name__ == "__main__":
    main()
