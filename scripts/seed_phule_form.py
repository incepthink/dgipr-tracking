"""Creates DGIPR's "महात्मा जोतीराव फुले द्विजन्मशताब्दी" publicity form and enters the offices' figures for
29 Oct 2026, as given in DGIPR's sheet (महात्मा फुले_प्रसिद्धी_अहवाल-23 To 29-10-2026).

The form is a daily form from 29 Oct 2026 with the sheet's 12 columns (the report columns, same keys and
wording) and every active office as recipient, published by the state admin. Each office's row of the sheet
is saved and submitted as that office's 29 Oct entry (zeros included: the sheet reports them), through the
normal service functions so it is audited like real entries. The state total is checked against the sheet's
"राज्य एकूण" row before anything is committed. Safe to run again: an existing form is reused and offices that
already have a 29 Oct submission are left alone.

  python scripts/seed_phule_form.py
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

SLUG = "mahatma_phule_bicentenary"
TITLE_MR = "महात्मा जोतीराव फुले यांच्या द्विजन्मशताब्दी वर्षानिमित्त प्रसिद्धी अहवाल"
TITLE_EN = "Mahatma Jotirao Phule birth bicentenary year: publicity report"
DAY = date(2026, 10, 29)

# One row per office in the sheet's order; columns in report order: लेख, वृत्त, कात्रणांची संख्या, व्हिडिओ बाईट्स,
# व्हिडिओ मुलाखत, फेसबुक, इन्सटाग्राम, एक्स, ब्लॉग, युट्युब, पब्लीक ॲप, उपक्रम/ मावजस होर्डिंग, महासंवाद
SHEET = """
nagpur_rio             0 0  0 0 0 0 0 0 0 0 0 0
bhandara               0 0  4 0 0 4 4 4 0 1 1 0
gondia                 0 0  0 0 0 0 0 0 0 0 0 0
wardha                 0 0  0 0 0 2 2 2 0 0 0 0
nagpur                 0 0  0 0 0 0 0 0 0 0 0 0
chandrapur             0 0  0 0 0 3 3 3 0 1 1 0
gadchiroli             0 0  0 0 0 2 1 1 0 0 0 0
pune_rio               0 0  0 0 0 0 0 0 0 0 0 0
pune                   0 1 13 0 0 2 2 4 0 1 0 0
solapur                0 0  1 0 0 0 0 0 0 0 0 0
satara                 0 0  3 0 0 2 2 2 0 2 2 0
chh_sambhajinagar_rio  0 0  0 0 0 2 1 0 0 0 1 0
chh_sambhajinagar      0 0  1 0 0 3 3 3 3 3 0 0
jalna                  0 0  1 0 0 1 1 1 0 0 1 0
parbhani               0 0  5 0 0 5 5 5 0 0 0 0
beed                   0 0  0 0 0 0 0 0 0 0 0 0
konkan_rio             0 0  0 0 0 1 1 1 0 0 1 0
raigad                 0 0  5 0 0 4 4 4 0 1 1 0
thane                  0 0  6 0 0 0 0 0 0 0 0 0
ratnagiri              0 0  5 0 0 3 0 3 0 0 0 0
palghar                0 0  0 0 0 0 0 0 0 0 0 0
kolhapur_rio           0 0  0 0 0 0 0 0 0 0 0 0
kolhapur               0 1  4 0 0 3 3 3 1 0 0 0
sangli                 0 0 19 0 0 1 1 1 0 0 0 0
sindhudurg             0 0  6 0 0 3 3 3 0 0 3 0
nashik_rio             0 0  0 0 0 0 0 0 0 0 0 0
nashik                 0 0  0 0 0 0 0 0 0 0 0 0
ahilyanagar            0 2  6 0 0 1 1 1 0 0 0 0
jalgaon                0 0  2 0 0 4 4 4 0 0 4 0
dhule                  0 0  0 0 0 0 0 0 0 0 0 0
nandurbar              0 0  1 0 0 7 7 7 0 0 0 0
amravati_rio           0 0  0 0 0 0 0 0 0 0 0 0
amravati               0 0  0 0 0 2 1 0 1 0 1 0
akola                  0 0  0 0 0 4 6 7 0 0 0 0
washim                 0 0  0 0 0 2 2 2 1 1 1 0
buldhana               0 0  0 0 0 2 2 2 2 0 0 0
yavatmal               0 0  0 0 0 2 2 2 0 0 0 0
latur_rio              0 0  0 0 0 0 0 0 0 0 0 0
latur                  0 0  4 0 0 0 0 0 0 0 0 0
dharashiv              0 0  2 0 0 1 0 0 0 0 0 0
nanded                 0 0  0 0 0 5 5 5 0 2 2 0
hingoli                0 0  3 0 0 1 1 1 0 0 1 0
mumbai_hq              0 1 15 0 0 2 2 2 0 0 1 1
"""
STATE_TOTAL = (0, 5, 106, 0, 0, 74, 69, 73, 8, 12, 21, 1)  # the sheet's राज्य एकूण row


def main() -> None:
    from sqlalchemy import select

    from app.db import init_db, make_engine, make_session_factory
    from app.forms import schema, service
    from app.forms.migrate import INSTRUCTIONS_EN, INSTRUCTIONS_MR
    from app.models import Form, User
    from app.reporting.columns import COLUMNS
    from app.settings import load_settings

    rows = {line.split()[0]: [int(x) for x in line.split()[1:]] for line in SHEET.strip().splitlines()}
    assert all(len(v) == len(COLUMNS) for v in rows.values())
    total = tuple(sum(col) for col in zip(*rows.values()))
    if total != STATE_TOTAL:
        sys.exit(f"sheet rows add up to {total}, not the sheet's state total {STATE_TOTAL}")

    settings = load_settings()
    engine = make_engine(settings.database_url)
    init_db(engine)
    SessionF = make_session_factory(engine)
    with SessionF() as s:
        admin = s.scalar(select(User).where(User.role == "state", User.active.is_(True)).order_by(User.id))
        actor = admin.username if admin else "system"
        offices = schema.all_office_codes(s)
        if offices != list(rows):
            sys.exit(f"office list differs from the sheet: {sorted(set(offices) ^ set(rows))}")

        form = s.scalar(select(Form).where(Form.slug == SLUG))
        if form is None:
            form = schema.create_form(s, actor, {
                "slug": SLUG, "title_mr": TITLE_MR, "title_en": TITLE_EN,
                "instructions_mr": INSTRUCTIONS_MR, "instructions_en": INSTRUCTIONS_EN,
                "frequency": "daily", "start_date": DAY.isoformat(), "recipients": offices,
                "fields": [{"key": c.key, "label_mr": c.label_mr, "label_en": c.label_en, "type": "number",
                            "min_value": 0, "integer": True, "group": c.group, "aggregate": "sum"}
                           for c in COLUMNS]})
            schema.set_status(s, actor, form, "published")
            s.flush()
            print(f"created form {form.id} ({SLUG})")
        else:
            print(f"form {form.id} ({SLUG}) exists")

        users = {u.office_code: u for u in s.scalars(select(User).where(User.role == "district")).all()}
        added = 0
        for code, vals in rows.items():
            if service.find(s, form, code, DAY) is not None:
                continue
            user = users.get(code)
            service.save(s, user, form, code, DAY, {c.key: v for c, v in zip(COLUMNS, vals)}, confirm_zero=True,
                         submit=True, actor=user.username if user else code, check=False)
            added += 1
        s.flush()

        totals = {c.key: 0.0 for c in COLUMNS}
        for code in offices:
            sub = service.find(s, form, code, DAY)
            for v in sub.values:
                totals[v.field.key] += v.value_num or 0
        if tuple(int(totals[c.key]) for c in COLUMNS) != STATE_TOTAL:
            s.rollback()
            sys.exit(f"stored 29 Oct totals {totals} don't match the sheet; nothing saved")
        s.commit()
        print(f"{added} office submissions added for {DAY}; state total matches the sheet: {STATE_TOTAL}")


if __name__ == "__main__":
    main()
