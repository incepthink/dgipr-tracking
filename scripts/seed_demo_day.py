"""Fills one day's period of every published form with made-up values, for demos.

Every recipient office without a submission for that period gets one: most submit (at a time during the day),
a few leave a draft and the rest send nothing, so the responses page looks like a real day. Values follow each
office's own recent figures when it has any. A few submitted values are then edited by the state office (one of
them undone) so the change history has something to show. Everything goes through the normal service functions,
so it is audited like real entries.

  python scripts/seed_demo_day.py                     # today
  python scripts/seed_demo_day.py --date 2026-10-29 --edits 0
"""
from __future__ import annotations

import argparse
import random
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

NOTE = "DEMO: made-up values"
EDIT_NOTES = ["जिल्हा कार्यालयाशी फोनवर खात्री केली", "आकडे उलटे नोंदले होते", "कात्रणांची संख्या पुन्हा मोजली", ""]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="")
    ap.add_argument("--seed", type=int, default=29)
    ap.add_argument("--edits", type=int, default=4, help="state-office edits to make on the new submissions")
    args = ap.parse_args()

    from sqlalchemy import select

    from app.db import init_db, make_engine, make_session_factory
    from app.forms import service
    from app.forms.periods import is_period_start
    from app.forms.schema import active_fields, recipient_codes
    from app.models import Form, FormSubmission, User
    from app.settings import load_settings
    from app.timeutil import today_ist, utcnow

    settings = load_settings()
    engine = make_engine(settings.database_url)
    init_db(engine)
    SessionF = make_session_factory(engine)
    rng = random.Random(args.seed)
    day = date.fromisoformat(args.date) if args.date else today_ist()
    # submission times: 09:30 IST on the day until now (or 19:00 for a past day), stored as naive UTC
    first = datetime.combine(day, datetime.min.time()) + timedelta(hours=9, minutes=30) - timedelta(hours=5, minutes=30)
    last = min(utcnow(), first + timedelta(hours=9, minutes=30))

    with SessionF() as s:
        admin = s.scalar(select(User).where(User.role == "state").order_by(User.id))
        made: list[tuple[Form, FormSubmission]] = []
        for form in s.scalars(select(Form).where(Form.status == "published")).all():
            if not is_period_start(form, day) or day < form.start_date or (form.end_date and day > form.end_date):
                print(f"{form.slug}: no period on {day}, skipped")
                continue
            fields = [f for f in active_fields(form) if f.type == "number"]
            for code in recipient_codes(s, form):
                if service.find(s, form, code, day) is not None:
                    continue
                roll = rng.random()
                if roll > 0.9:
                    continue  # nothing sent yet
                past = s.scalars(select(FormSubmission).where(
                    FormSubmission.form_id == form.id, FormSubmission.office_code == code,
                    FormSubmission.status.in_(service.COUNTED)).order_by(FormSubmission.period_start.desc()).limit(5)).all()
                values = {}
                for f in fields:
                    seen = [v.value_num for p in past for v in p.values if v.field_id == f.id and v.value_num is not None]
                    mean = sum(seen) / len(seen) if seen else rng.uniform(2, 10)
                    values[f.key] = max(0, round(rng.gauss(mean, max(1.0, mean / 4))))
                draft = roll > 0.85
                sub = service.save(s, None, form, code, day, values, confirm_zero=True, note=NOTE, submit=not draft,
                                   actor=code, check=False)
                at = first + timedelta(seconds=rng.uniform(0, max(60, (last - first).total_seconds())))
                for v in sub.values:
                    v.entered_at = at
                sub.updated_at = at
                if not draft:
                    sub.submitted_at = at
                    made.append((form, sub))
                print(f"  {form.slug} {code} {day}: {'draft' if draft else 'submitted'}")
        s.flush()

        if admin is not None:
            for i, (form, sub) in enumerate(rng.sample(made, min(args.edits, len(made)))):
                f = rng.choice([x for x in active_fields(form) if x.type == "number"])
                cur = int(next((v.value_num for v in sub.values if v.field_id == f.id), 0) or 0)
                new = cur + rng.choice([-2, -1, 1, 2, 3])
                edit = service.correct(s, admin, form, sub.office_code, day, f.key, new if new >= 0 else cur + 2,
                                       EDIT_NOTES[i % len(EDIT_NOTES)])
                print(f"  edited {form.slug} {sub.office_code} {f.key}: {edit.before_num} -> {edit.after_num}")
                if i == 0:
                    service.revert(s, admin, form, sub.office_code, day, edit.id)
                    print("    ...and undid it")
        s.commit()


if __name__ == "__main__":
    main()
