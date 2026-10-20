"""JSON API for the React operator UI (frontend/), plus serving its build at /app/.

Business rules live in app.web.main helpers shared with the server-rendered forms, so both UIs
validate and audit identically. Errors are HTTPException -> {"detail": "..."}.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any, Optional

import yaml
from fastapi import Depends, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import audit
from app.auth import current_user, visible_office_codes
from app.classification.base import ClassificationInput
from app.classification.count_rules import effective_rules
from app.classification.service import accept_auto_matches, classify_period, get_classifier
from app.collection.service import create_run
from app.collection.store import latest_covered_day
from app.models import (Account, AuditLog, Campaign, Classification, CollectionRun, Division, Publication, RawRecord,
                        ReportSnapshot)
from app.providers.factory import PLATFORMS, provider_status
from app.registry.loader import report_format
from app.reporting.columns import COLUMNS
from app.reporting.snapshot import IncompleteReportError, create_snapshot, preview_data, verify_snapshot
from app.web.main import (WEB_DIR, _404, _campaign, _date, _default_day, _ist, _run_json, app, create_account,
                          decide, executor, get_session, require_operator, retry_task_ids, review_rows,
                          save_manual_values, settings, update_account, update_campaign)

SPA_DIR = WEB_DIR / "spa"


# --------------------------------------------------------------------------- serializers
def _campaign_brief(c: Campaign) -> dict[str, Any]:
    return {"id": c.id, "slug": c.slug, "title_mr": c.title_mr, "title_en": c.title_en, "active": c.active,
            "version": c.version}


def _office(o) -> Optional[dict[str, Any]]:
    return {"code": o.code, "name_mr": o.name_mr, "name_en": o.name_en} if o else None


def _account(a: Account) -> dict[str, Any]:
    return {"id": a.id, "platform": a.platform, "handle": a.handle, "url": a.url, "display_name": a.display_name,
            "office_code": a.office_code, "office": _office(a.office), "mapping_confirmed": a.mapping_confirmed,
            "mapping_note": a.mapping_note, "active": a.active, "external_id": a.external_id}


def _snap_brief(sn: ReportSnapshot) -> dict[str, Any]:
    return {"id": sn.id, "campaign_id": sn.campaign_id, "period_start": sn.period_start.isoformat(),
            "period_end": sn.period_end.isoformat(), "kind": sn.kind, "is_sample": sn.is_sample,
            "created_by": sn.created_by, "created_at": _ist(sn.created_at), "note": sn.note,
            "superseded_by_id": sn.superseded_by_id}


def _run_brief(r: CollectionRun) -> dict[str, Any]:
    return {"id": r.id, "campaign_id": r.campaign_id, "period_start": r.period_start.isoformat(),
            "period_end": r.period_end.isoformat(), "status": r.status, "mode": r.mode,
            "triggered_by": r.triggered_by, "created_at": _ist(r.created_at), "tasks": len(r.tasks)}


def _audit(r: AuditLog) -> dict[str, Any]:
    return {"id": r.id, "at": _ist(r.at), "actor": r.actor, "action": r.action, "entity_type": r.entity_type,
            "entity_id": r.entity_id, "before": r.before, "after": r.after, "note": r.note}


def _pub_brief(p: Publication) -> dict[str, Any]:
    return {"id": p.id, "platform": p.platform, "platform_post_id": p.platform_post_id, "provider": p.provider,
            "url": p.url, "published_at": _ist(p.published_at_utc), "reporting_date": p.reporting_date.isoformat(),
            "content_type": p.content_type, "is_repost": p.is_repost, "is_reply": p.is_reply, "is_quote": p.is_quote,
            "is_pinned": p.is_pinned, "is_short": p.is_short, "media_count": len(p.media or []),
            "account": {"id": p.account.id, "handle": p.account.handle, "platform": p.account.platform},
            "office": _office(p.account.office)}


def _cls(c: Optional[Classification]) -> Optional[dict[str, Any]]:
    if not c:
        return None
    return {"id": c.id, "campaign_id": c.campaign_id, "auto_decision": c.auto_decision, "auto_score": c.auto_score,
            "auto_evidence": c.auto_evidence or {}, "classifier": c.classifier,
            "classifier_version": c.classifier_version, "rules_version": c.rules_version,
            "manual_decision": c.manual_decision, "manual_note": c.manual_note, "manual_by": c.manual_by,
            "manual_at": _ist(c.manual_at) if c.manual_at else None, "report_tag": c.report_tag,
            "effective_decision": c.effective_decision}


def _divisions(s: Session, visible: Optional[set[str]] = None) -> list[dict[str, Any]]:
    """Active divisions and offices; with `visible`, only those offices (and divisions that contain one)."""
    divs = s.scalars(select(Division).where(Division.active.is_(True)).order_by(Division.sort_order)).all()
    out = []
    for d in divs:
        offices = [o for o in d.offices if o.active and (visible is None or o.code in visible)]
        if offices or visible is None:
            out.append({"code": d.code, "label_mr": d.summary_label_mr,
                        "offices": [{**_office(o), "kind": o.kind} for o in offices]})
    return out


# --------------------------------------------------------------------------- meta / operator / dashboard
@app.get("/api/meta")
def api_meta(request: Request, s: Session = Depends(get_session)):
    user = current_user(request)
    columns = [{"key": c.key, "label_mr": c.label_mr, "label_en": c.label_en, "source": c.source,
                "group": c.group} for c in COLUMNS]
    base = {"operator": user.username, "default_day": _default_day().isoformat(), "columns": columns,
            "divisions": _divisions(s, None if user.role == "state" else set(visible_office_codes(s, user)))}
    if user.role != "state":
        return {**base, "campaigns": [_campaign_brief(c) for c in s.scalars(
            select(Campaign).where(Campaign.active.is_(True)).order_by(Campaign.id)).all()]}
    active = list(s.scalars(select(Account.id).where(Account.active.is_(True))).all())
    covered = latest_covered_day(s, active)
    return {**base, "platforms": list(PLATFORMS), "covered_day": covered.isoformat() if covered else None,
            "overlap_hours": settings.overlap_hours, "providers": provider_status(settings),
            "campaigns": [_campaign_brief(c) for c in s.scalars(select(Campaign).order_by(Campaign.id)).all()]}


@app.get("/api/dashboard")
def api_dashboard(s: Session = Depends(get_session)):
    runs = s.scalars(select(CollectionRun).order_by(CollectionRun.id.desc()).limit(8)).all()
    snaps = s.scalars(select(ReportSnapshot).order_by(ReportSnapshot.id.desc()).limit(8)).all()
    day = _default_day()
    pending = sum(1 for _, c in s.execute(
        select(Publication, Classification).join(Classification, Classification.publication_id == Publication.id)
        .where(Publication.reporting_date == day)).all() if c.effective_decision == "pending")
    return {
        "runs": [_run_brief(r) for r in runs], "snapshots": [_snap_brief(x) for x in snaps],
        "stats": {
            "publications": s.scalar(select(func.count(Publication.id))) or 0,
            "accounts": s.scalar(select(func.count(Account.id)).where(Account.active.is_(True))) or 0,
            "unconfirmed": s.scalar(select(func.count(Account.id)).where(
                Account.active.is_(True), Account.mapping_confirmed.is_(False))) or 0,
            "pending_review_day": pending,
            "day": day.isoformat(),
        },
    }


# --------------------------------------------------------------------------- accounts
@app.get("/api/accounts")
def api_accounts(s: Session = Depends(get_session)):
    return [_account(a) for a in s.scalars(select(Account).order_by(Account.platform, Account.handle)).all()]


class AccountIn(BaseModel):
    platform: str
    handle: str
    url: str
    display_name: str = ""
    office_code: str = ""
    mapping_note: str = ""


@app.post("/api/accounts")
def api_account_create(request: Request, body: AccountIn, s: Session = Depends(get_session)):
    acc = create_account(s, require_operator(request), **body.model_dump())
    s.commit()
    return _account(acc)


class AccountPatch(BaseModel):
    office_code: str = ""
    mapping_note: str = ""
    active: bool = True
    confirm_mapping: bool = False


@app.patch("/api/accounts/{account_id}")
def api_account_update(request: Request, account_id: int, body: AccountPatch, s: Session = Depends(get_session)):
    acc = s.get(Account, account_id) or _404()
    update_account(s, acc, require_operator(request), **body.model_dump())
    s.commit()
    return _account(acc)


# --------------------------------------------------------------------------- campaigns
def _campaign_full(c: Campaign) -> dict[str, Any]:
    return {**_campaign_brief(c), "updated_at": _ist(c.updated_at), "updated_by": c.updated_by,
            "rules_yaml": yaml.safe_dump(c.rules, allow_unicode=True, sort_keys=False),
            "count_yaml": yaml.safe_dump(effective_rules(c.count_rules), allow_unicode=True, sort_keys=False)}


@app.get("/api/campaigns/{campaign_id}")
def api_campaign(campaign_id: int, s: Session = Depends(get_session)):
    return _campaign_full(s.get(Campaign, campaign_id) or _404())


class CampaignIn(BaseModel):
    title_mr: str
    title_en: str = ""
    rules_yaml: str
    count_yaml: str


@app.put("/api/campaigns/{campaign_id}")
def api_campaign_update(request: Request, campaign_id: int, body: CampaignIn, s: Session = Depends(get_session)):
    c = s.get(Campaign, campaign_id) or _404()
    update_campaign(s, c, require_operator(request), **body.model_dump())
    s.commit()
    return _campaign_full(c)


class TestIn(BaseModel):
    text: str


@app.post("/api/campaigns/{campaign_id}/test")
def api_campaign_test(campaign_id: int, body: TestIn, s: Session = Depends(get_session)):
    c = s.get(Campaign, campaign_id) or _404()
    r = get_classifier().classify(ClassificationInput(text=body.text), c.rules or {})
    return {"decision": r.decision, "score": r.score, "reasons": r.reasons,
            "evidence": [e.as_dict() for e in r.evidence]}


class PeriodIn(BaseModel):
    start: date
    end: date


@app.post("/api/campaigns/{campaign_id}/reclassify")
def api_campaign_reclassify(request: Request, campaign_id: int, body: PeriodIn, s: Session = Depends(get_session)):
    actor = require_operator(request)
    c = s.get(Campaign, campaign_id) or _404()
    n = classify_period(s, c, body.start, body.end)
    audit.record(s, actor, "campaign.reclassify", "campaign", c.id,
                 after={"period": [body.start.isoformat(), body.end.isoformat()], "count": n,
                        "rules_version": c.version},
                 note="automatic decisions recomputed; manual decisions preserved")
    s.commit()
    return {"count": n}


# --------------------------------------------------------------------------- collection runs
@app.get("/api/runs")
def api_runs(limit: int = 50, s: Session = Depends(get_session)):
    rows = s.scalars(select(CollectionRun).order_by(CollectionRun.id.desc()).limit(min(limit, 500))).all()
    return [_run_brief(r) for r in rows]


@app.get("/api/collect/accounts")
def api_collect_accounts(s: Session = Depends(get_session)):
    return [_account(a) for a in s.scalars(select(Account).where(Account.active.is_(True))
                                           .order_by(Account.platform, Account.handle)).all()]


class RunIn(BaseModel):
    campaign_id: Optional[int] = None  # none: collect only, classify later from Campaign rules
    start: date
    end: date
    account_ids: list[int]
    overlap_hours: Optional[int] = None
    mode: str = "window"


@app.post("/api/runs")
def api_run_create(request: Request, body: RunIn, s: Session = Depends(get_session)):
    actor = require_operator(request)
    if not body.account_ids:
        raise HTTPException(400, "select at least one account")
    try:
        run = create_run(s, settings, campaign_id=body.campaign_id or None, period_start=body.start, period_end=body.end,
                         account_ids=body.account_ids, actor=actor,
                         overlap_hours=body.overlap_hours if body.overlap_hours is not None else settings.overlap_hours,
                         mode=body.mode)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    s.commit()
    executor.submit(run.id)
    return {"id": run.id}


@app.post("/api/runs/{run_id}/retry")
def api_run_retry(request: Request, run_id: int, s: Session = Depends(get_session)):
    actor = require_operator(request)
    run = s.get(CollectionRun, run_id) or _404()
    if executor.is_active(run_id):
        raise HTTPException(400, "run is still active")
    ids = retry_task_ids(run)
    if not ids:
        raise HTTPException(400, "no failed or partial tasks to retry")
    run.status = "queued"
    audit.record(s, actor, "run.retry", "collection_run", run.id, after={"task_ids": ids})
    s.commit()
    executor.submit(run_id, only_task_ids=ids)
    return _run_json(run)


# --------------------------------------------------------------------------- review
@app.get("/api/review")
def api_review(campaign_id: Optional[int] = None, start: Optional[str] = None, end: Optional[str] = None,
               platform: str = "", decision: str = "", office: str = "", s: Session = Depends(get_session)):
    # The search term is optional: without one, show the period's publications unclassified (no default campaign).
    c = _campaign(s, campaign_id) if campaign_id else None
    d0 = _date(start, _default_day())
    d1 = _date(end, d0)
    rows, summary = review_rows(s, c, d0, d1, platform=platform, decision=decision, office=office)
    return {
        "campaign": _campaign_brief(c) if c else None, "start": d0.isoformat(), "end": d1.isoformat(), "summary": summary,
        "rows": [{"pub": _pub_brief(r["pub"]), "cls": _cls(r["cls"]), "eff": r["eff"], "counts": r["counts"],
                  "count_reason": r["count_reason"],
                  "highlight": {k: [[seg, hit] for seg, hit in parts] for k, parts in r["highlight"].items()}}
                 for r in rows],
    }


class BulkIn(BaseModel):
    campaign_id: int
    start: date
    end: date


@app.post("/api/review/bulk-accept")
def api_review_accept(request: Request, body: BulkIn, s: Session = Depends(get_session)):
    actor = require_operator(request)
    rows = s.scalars(select(Classification).join(Publication).where(
        Classification.campaign_id == body.campaign_id, Publication.reporting_date >= body.start,
        Publication.reporting_date <= body.end)).all()
    n = accept_auto_matches(s, rows, actor)
    s.commit()
    return {"accepted": n}


class DecisionIn(BaseModel):
    action: str
    note: str = ""
    report_tag: str = "__keep__"


@app.post("/api/review/{cls_id}")
def api_review_decide(request: Request, cls_id: int, body: DecisionIn, s: Session = Depends(get_session)):
    cls = s.get(Classification, cls_id) or _404()
    decide(s, cls, require_operator(request), **body.model_dump())
    s.commit()
    return _cls(cls)


@app.get("/api/publications/{pub_id}")
def api_publication(pub_id: int, s: Session = Depends(get_session)):
    pub = s.get(Publication, pub_id) or _404()
    raw = s.get(RawRecord, pub.latest_raw_id) if pub.latest_raw_id else None
    classes = s.scalars(select(Classification).where(Classification.publication_id == pub.id)).all()
    history = s.scalars(select(AuditLog).where(AuditLog.entity_type == "classification",
                                               AuditLog.entity_id.in_([str(c.id) for c in classes] or ["-"]))
                        .order_by(AuditLog.id)).all()
    return {
        **_pub_brief(pub), "published_at_utc": pub.published_at_utc.isoformat(), "title": pub.title,
        "text": pub.text, "description": pub.description, "media": pub.media or [], "metrics": pub.metrics or {},
        "metrics_observed_at": _ist(pub.metrics_observed_at), "attributes": pub.attributes or {},
        "first_collected_at": _ist(pub.first_collected_at), "last_collected_at": _ist(pub.last_collected_at),
        "first_run_id": pub.first_run_id, "last_run_id": pub.last_run_id, "provenance": pub.provenance or [],
        "classifications": [_cls(c) for c in classes], "history": [_audit(h) for h in history],
        "raw": {"provider": raw.provider, "fetched_at": _ist(raw.fetched_at), "sha256": raw.payload_sha256,
                "payload": raw.payload} if raw else None,
    }


# --------------------------------------------------------------------------- report
@app.get("/api/report")
def api_report(campaign_id: Optional[int] = None, start: Optional[str] = None, end: Optional[str] = None,
               s: Session = Depends(get_session)):
    # Like Review, the search term is optional: without one every countable publication counts (no default campaign).
    c = _campaign(s, campaign_id) if campaign_id else None
    d0 = _date(start, _default_day())
    d1 = _date(end, d0)
    data = preview_data(s, c, d0, d1, report_format(settings.config_dir))
    data.pop("evidence", None)  # large; the matrix only needs per-cell publication ids
    snaps = s.scalars(select(ReportSnapshot).where(ReportSnapshot.campaign_id == (c.id if c else None),
                                                   ReportSnapshot.period_start == d0, ReportSnapshot.period_end == d1)
                      .order_by(ReportSnapshot.id.desc())).all()
    return {"campaign": _campaign_brief(c) if c else None, "start": d0.isoformat(), "end": d1.isoformat(), "data": data,
            "snapshots": [_snap_brief(x) for x in snaps]}


class ManualCell(BaseModel):
    office: str
    column: str
    value: Optional[int] = None
    confirm_zero: bool = False


class ManualIn(BaseModel):
    campaign_id: Optional[int] = None
    start: date
    end: date
    note: str = ""
    cells: list[ManualCell]


@app.post("/api/report/manual")
def api_report_manual(request: Request, body: ManualIn, s: Session = Depends(get_session)):
    actor = require_operator(request)
    cells = [(c.office, c.column, "" if c.value is None else str(c.value), c.confirm_zero) for c in body.cells]
    errors = save_manual_values(s, actor, body.campaign_id, body.start, body.end, cells, body.note)
    s.commit()
    return {"errors": errors}


class SnapshotIn(BaseModel):
    campaign_id: Optional[int] = None
    start: date
    end: date
    kind: str
    note: str = ""


@app.post("/api/reports")
def api_report_create(request: Request, body: SnapshotIn, s: Session = Depends(get_session)):
    actor = require_operator(request)
    c = _campaign(s, body.campaign_id) if body.campaign_id else None
    try:
        snap = create_snapshot(s, c, body.start, body.end, kind=body.kind, actor=actor,
                               fmt=report_format(settings.config_dir), pdf_dir=settings.pdf_dir,
                               browser_channel=settings.pdf_browser_channel, note=body.note)
    except IncompleteReportError as exc:
        s.rollback()
        raise HTTPException(400, " · ".join([str(exc)] + [i["message"] for i in exc.issues[:20]]))
    except ValueError as exc:
        s.rollback()
        raise HTTPException(400, str(exc))
    s.commit()
    return {"id": snap.id}


@app.get("/api/reports/{snap_id}")
def api_snapshot(snap_id: int, s: Session = Depends(get_session)):
    snap = s.get(ReportSnapshot, snap_id) or _404()
    data = dict(snap.data)
    data.pop("evidence", None)
    return {**_snap_brief(snap), "data_sha256": snap.data_sha256, "pdf_sha256": snap.pdf_sha256,
            "intact": verify_snapshot(snap), "data": data}


# --------------------------------------------------------------------------- audit
@app.get("/api/audit")
def api_audit(limit: int = 300, s: Session = Depends(get_session)):
    rows = s.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 2000))).all()
    return [_audit(r) for r in rows]


# --------------------------------------------------------------------------- React UI (frontend/ build output)
if (SPA_DIR / "index.html").is_file():
    app.mount("/app/assets", StaticFiles(directory=SPA_DIR / "assets"), name="spa-assets")

    @app.get("/", include_in_schema=False)
    def root():
        return RedirectResponse("/app/")

    @app.get("/app", include_in_schema=False)
    @app.get("/app/{path:path}", include_in_schema=False)
    def spa(path: str = ""):
        f = (SPA_DIR / path).resolve()
        if path and f.is_file() and SPA_DIR.resolve() in f.parents:
            return FileResponse(f)
        return FileResponse(SPA_DIR / "index.html", headers={"Cache-Control": "no-cache"})
else:
    @app.get("/", include_in_schema=False)
    def root():
        return RedirectResponse("/classic")
