"""Aggregation, missing vs confirmed zero, totals, snapshots and final-approval gating."""
from __future__ import annotations

import yaml
import pytest
from sqlalchemy import select

from app.classification.service import accept_auto_matches, set_manual_decision
from app.collection.service import create_run, execute_run
from app.models import Account, Classification, Office, Publication
from app.providers.factory import build_adapter
from app.reporting.aggregate import compute_report
from app.reporting.columns import BY_KEY, COLUMN_KEYS
from app.reporting.exports import evidence_csv, matrix_csv
from app.reporting.manual import ManualInputError, set_manual_value
from app.reporting.snapshot import IncompleteReportError, create_snapshot, verify_snapshot
from tests.conftest import PERIOD

REF = yaml.safe_load(open("config/sample/reference_2026-10-12.yaml", encoding="utf-8"))


def cell(data, office, col):
    for d in data["divisions"]:
        for o in d["offices"]:
            if o["code"] == office:
                return o["cells"][col]
    raise KeyError(office)


def division(data, code):
    return next(d for d in data["divisions"] if d["code"] == code)


def collect(session_factory, settings, campaign):
    with session_factory() as s:
        run = create_run(s, settings, campaign_id=campaign.id, period_start=PERIOD, period_end=PERIOD,
                         account_ids=[a.id for a in s.scalars(select(Account)).all()], actor="t")
        s.commit()
        rid = run.id
    execute_run(session_factory, rid, lambda p: build_adapter(settings, p))


def fill_manual(session, campaign, skip=()):
    hq = {a.platform for a in session.scalars(select(Account).where(Account.office_code == "mumbai_hq")).all()}
    # The reference predates the six विमाका offices added with office data entry: confirm zeros for them.
    added = {o.code: [0] * len(COLUMN_KEYS) for o in session.scalars(select(Office)).all()
             if o.code not in REF["values"]}
    for office, values in {**REF["values"], **added}.items():
        for key, v in zip(COLUMN_KEYS, values):
            if (office, key) in skip or (office == "mumbai_hq" and BY_KEY[key].platform in hq):
                continue
            set_manual_value(session, campaign_id=campaign.id, start=PERIOD, end=PERIOD, office_code=office,
                             column_key=key, value=v, confirm_zero=v == 0, actor="t")


def settle_review(session, campaign):
    for pid in ("SAMPLEig007", "SAMPLEreel8"):
        pub = session.scalar(select(Publication).where(Publication.platform_post_id == pid))
        cls = session.scalar(select(Classification).where(Classification.publication_id == pub.id))
        set_manual_decision(session, cls, "exclude", "t", note="not campaign")
    accept_auto_matches(session, session.scalars(select(Classification)).all(), "t")
    for a in session.scalars(select(Account)).all():
        a.mapping_confirmed = True
    session.flush()


def test_missing_is_not_zero_and_zero_requires_confirmation(session, campaign):
    data = compute_report(session, campaign, PERIOD, PERIOD)
    c = cell(data, "pune", "articles")
    assert c["state"] == "missing" and c["value"] is None
    assert division(data, "pune")["subtotal"]["articles"]["known"] == 0
    assert not data["complete"]
    with pytest.raises(ManualInputError):
        set_manual_value(session, campaign_id=campaign.id, start=PERIOD, end=PERIOD, office_code="pune",
                         column_key="articles", value=0, confirm_zero=False, actor="t")
    set_manual_value(session, campaign_id=campaign.id, start=PERIOD, end=PERIOD, office_code="pune",
                     column_key="articles", value=0, confirm_zero=True, actor="t")
    c = cell(compute_report(session, campaign, PERIOD, PERIOD), "pune", "articles")
    assert c["state"] == "confirmed_zero" and c["value"] == 0 and c["complete"]
    set_manual_value(session, campaign_id=campaign.id, start=PERIOD, end=PERIOD, office_code="pune",
                     column_key="articles", value=None, confirm_zero=False, actor="t")
    assert cell(compute_report(session, campaign, PERIOD, PERIOD), "pune", "articles")["state"] == "missing"


def test_uncollected_account_makes_cell_incomplete_not_zero(session, campaign):
    c = cell(compute_report(session, campaign, PERIOD, PERIOD), "mumbai_hq", "facebook")
    assert c["state"] == "auto" and c["value"] == 0 and not c["complete"]
    assert "collection_incomplete" in c["issues"] and "mapping_unconfirmed" in c["issues"]


def test_full_flow_totals_and_snapshot(session_factory, settings, campaign, fmt, tmp_path):
    collect(session_factory, settings, campaign)
    with session_factory() as s:
        camp = s.merge(campaign)
        data = compute_report(s, camp, PERIOD, PERIOD)
        hq = {k: cell(data, "mumbai_hq", k) for k in ("facebook", "instagram", "x", "youtube")}
        assert {"pending_review", "mapping_unconfirmed"} <= set(hq["instagram"]["issues"])
        settle_review(s, camp)
        fill_manual(s, camp)
        s.commit()
        data = compute_report(s, camp, PERIOD, PERIOD)
        assert data["complete"], [i for i in data["issues"] if i["severity"] == "blocker"][:3]
        assert {k: cell(data, "mumbai_hq", k)["value"] for k in ("facebook", "instagram", "x", "youtube")} == \
               {"facebook": 3, "instagram": 3, "x": 3, "youtube": 0}
        # every subtotal equals the sum of its rows; grand total equals the sum of subtotals
        for d in data["divisions"]:
            for k in COLUMN_KEYS:
                assert d["subtotal"][k]["value"] == sum(o["cells"][k]["value"] for o in d["offices"])
        for k in COLUMN_KEYS:
            assert data["grand_total"][k]["value"] == sum(d["subtotal"][k]["value"] for d in data["divisions"])
        # matches the reference page 1 except where the reference's Konkan subtotal omits "विमाका कोकण"
        page1 = REF["reference_page1"]
        for code, values in page1.items():
            if code in ("total", "konkan"):
                continue
            assert [division(data, code)["subtotal"][k]["value"] for k in COLUMN_KEYS] == values, code
        konkan = [division(data, "konkan")["subtotal"][k]["value"] for k in COLUMN_KEYS]
        assert konkan == [0, 1, 47, 0, 0, 4, 4, 4, 0, 0, 3, 0]

        snap = create_snapshot(s, camp, PERIOD, PERIOD, kind="final", actor="t", fmt=fmt, pdf_dir=tmp_path,
                               render=False)
        s.commit()
        frozen = snap.data["grand_total"]["clippings"]["value"]
        # later changes must not alter the approved snapshot
        set_manual_value(s, campaign_id=camp.id, start=PERIOD, end=PERIOD, office_code="pune", column_key="clippings",
                         value=999, confirm_zero=False, actor="t")
        s.commit()
        s.refresh(snap)
        assert snap.data["grand_total"]["clippings"]["value"] == frozen and verify_snapshot(snap)
        assert compute_report(s, camp, PERIOD, PERIOD)["grand_total"]["clippings"]["value"] != frozen
        assert snap.data["presentation"]["date_label"] == "१२ ऑक्टोबर २०२६"
        assert snap.data["presentation"]["summary_title"].endswith("विभागनिहाय प्रसिद्धी अहवाल दि. १२ ऑक्टोबर २०२६")
        assert snap.data["presentation"]["generated_at_utc"] != snap.data["period"]["start"]
        ev = evidence_csv(snap.data)
        assert "https://www.instagram.com/p/SAMPLEig002/" in ev and "चारा छावणी" not in ev  # links, not post text
        assert "MISSING" not in matrix_csv(snap.data)
        # a second final supersedes the first
        snap2 = create_snapshot(s, camp, PERIOD, PERIOD, kind="final", actor="t", fmt=fmt, pdf_dir=tmp_path, render=False)
        s.commit()
        s.refresh(snap)
        assert snap.superseded_by_id == snap2.id


def test_final_is_blocked_but_draft_allowed_when_incomplete(session, campaign, fmt, tmp_path):
    with pytest.raises(IncompleteReportError) as e:
        create_snapshot(session, campaign, PERIOD, PERIOD, kind="final", actor="t", fmt=fmt, pdf_dir=tmp_path,
                        render=False)
    assert e.value.issues
    session.rollback()
    d = create_snapshot(session, campaign, PERIOD, PERIOD, kind="draft", actor="t", fmt=fmt, pdf_dir=tmp_path,
                        render=False)
    assert d.kind == "draft" and d.data["complete"] is False
    assert "DRAFT" in d.data["presentation"]["watermark"]


def test_reviewer_tag_rule_counts_video_bites_only_when_configured(session_factory, settings, campaign):
    collect(session_factory, settings, campaign)
    with session_factory() as s:
        camp = s.merge(campaign)
        pub = s.scalar(select(Publication).where(Publication.platform_post_id == "900000000000002"))  # FB video
        cls = s.scalar(select(Classification).where(Classification.publication_id == pub.id))
        set_manual_decision(s, cls, "include", "t", report_tag="video_bite")
        assert cell(compute_report(s, camp, PERIOD, PERIOD), "mumbai_hq", "video_bites")["state"] == "missing"
        camp.count_rules = {**camp.count_rules, "video_bites_source": "reviewer_tag"}
        c = cell(compute_report(s, camp, PERIOD, PERIOD), "mumbai_hq", "video_bites")
        assert c["state"] == "auto" and c["value"] == 1 and c["publication_ids"] == [pub.id]
