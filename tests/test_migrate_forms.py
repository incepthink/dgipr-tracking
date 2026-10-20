"""Old office entries → forms: counts and sums match, values keep who/when, and re-running changes nothing."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import func, select

from app.forms import analytics
from app.forms.migrate import migrate, needed
from app.models import Form, FormSubmission, FormValue, OfficeEntry
from app.reporting.columns import COLUMN_KEYS


def test_migration_counts_sums_and_idempotence(session, campaign):
    rows = [("pune", date(2026, 10, 1), "articles", 3), ("pune", date(2026, 10, 1), "news", 0),
            ("pune", date(2026, 10, 2), "articles", 4), ("satara", date(2026, 10, 2), "clippings", 11)]
    for office, d, k, v in rows:
        session.add(OfficeEntry(campaign_id=campaign.id, office_code=office, entry_date=d, column_key=k, value=v,
                                entered_by="pune_user", entered_at=datetime(2026, 10, 2, 9, 0), note="n"))
    session.flush()
    assert needed(session)
    report = migrate(session)
    session.flush()
    assert report["forms"][0]["submissions"] == 3 and report["forms"][0]["values"] == 4
    form = session.scalar(select(Form).where(Form.campaign_id == campaign.id))
    assert form.status == "published" and form.frequency == "daily" and form.start_date == date(2026, 10, 1)
    assert [f.key for f in form.fields] == list(COLUMN_KEYS) and len(form.recipients) == 43
    assert session.scalar(select(func.count(FormSubmission.id)).where(FormSubmission.status == "submitted")) == 3
    v = session.scalar(select(FormValue).join(FormSubmission).where(FormSubmission.office_code == "satara"))
    assert v.value_num == 11 and v.entered_by == "pune_user" and v.entered_at == datetime(2026, 10, 2, 9, 0)
    totals = analytics.totals(session, form, ["pune", "satara"], date(2026, 10, 1), date(2026, 10, 2))
    assert totals["articles"] == 7 and totals["news"] == 0 and totals["clippings"] == 11
    # a confirmed zero stays a value (not missing)
    assert analytics.coverage(session, form, ["pune"], date(2026, 10, 1), date(2026, 10, 1))["filled_cells"] == 2

    again = migrate(session)
    assert again["forms"] == [] and again["skipped"] == [campaign.slug]
    assert session.scalar(select(func.count(Form.id))) == 1
    assert session.scalar(select(func.count(FormValue.id))) == 4
    assert session.scalar(select(func.count(OfficeEntry.id))) == 4  # the old table is left as a backup
    assert not needed(session)
