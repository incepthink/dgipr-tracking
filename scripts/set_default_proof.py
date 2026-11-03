"""Switches proof on for one form: each field whose key is a report column gets that column's proof type
(app/reporting/columns.py: links for the social and video columns, files for clippings, links or files for
articles, news and activities). Other fields and fields that already ask for proof are left alone.

The change goes through schema.update_form, so it is audited, and proof becomes required from today (IST) if the
form had no proof yet; earlier days stay exempt. Prints what it would change and asks before saving.

  python scripts/set_default_proof.py mahatma_phule_bicentenary [--yes]
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main(argv: list[str]) -> int:
    from sqlalchemy import select

    from app.db import init_db, make_engine, make_session_factory
    from app.forms.schema import field_json, update_form
    from app.models import Form
    from app.reporting.columns import BY_KEY
    from app.settings import load_settings

    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 1:
        print(__doc__)
        return 2
    settings = load_settings()
    engine = make_engine(settings.database_url)
    init_db(engine)
    with make_session_factory(engine)() as s:
        form = s.scalar(select(Form).where(Form.slug == args[0]))
        if form is None:
            print(f"no form with slug {args[0]!r}")
            return 1
        fields = [field_json(f) for f in form.fields]
        changes = []
        for f in fields:
            col = BY_KEY.get(f["key"])
            if col and col.proof != "none" and f["proof"] == "none" and f["type"] == "number":
                f["proof"] = col.proof
                changes.append(f"  {f['key']:<18} {f['label_mr']}: {col.proof}")
        if not changes:
            print("nothing to change")
            return 0
        print(f"{form.title_mr} ({form.slug}):", *changes, sep="\n")
        if "--yes" not in argv and input("save? [y/N] ").strip().lower() != "y":
            print("not saved")
            return 1
        update_form(s, "script:set_default_proof", form, {"fields": fields})
        s.commit()
        print(f"saved; proof required from {form.proof_from}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
