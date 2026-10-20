"""Operator web UI (server-rendered). Run: uvicorn app.web.main:app"""
from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlencode

import yaml
from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import (FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse,
                               Response)
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import func, select
from sqlalchemy.orm import Session, object_session

from app import audit
from app.auth import AuthMiddleware, bootstrap_admin
from app.classification.base import ClassificationInput
from app.classification.count_rules import countable, effective_rules
from app.classification.service import accept_auto_matches, classify_period, get_classifier, set_manual_decision
from app.collection.executor import RunExecutor
from app.collection.service import create_run, mark_interrupted
from app.collection.store import is_covered
from app.db import init_db, make_engine, make_session_factory
from app.forms.migrate import migrate_if_needed as migrate_entries_if_needed
from app.models import (Account, AuditLog, Campaign, Classification, CollectionRun, CollectionTask, Division,
                        ManualInput, Office, Publication, RawRecord, ReportSnapshot)
from app.providers.factory import PLATFORMS, provider_status
from app.registry.loader import bootstrap, handle_key, report_format
from app.reporting.columns import COLUMNS
from app.reporting.exports import evidence_csv, matrix_csv
from app.reporting.manual import ManualInputError, set_manual_value
from app.reporting.marathi import num
from app.reporting.pdf import render_pdf
from app.reporting.snapshot import IncompleteReportError, create_snapshot, preview_data, verify_snapshot, write_pdf
from app.settings import load_settings
from app.timeutil import IST, as_aware_utc, utcnow

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

settings = load_settings()
engine = make_engine(settings.database_url)
init_db(engine)
SessionF = make_session_factory(engine)
with SessionF() as _s:
    bootstrap(_s, settings.config_dir)
    bootstrap_admin(_s, settings.admin_username, settings.admin_password)
    if (_migrated := migrate_entries_if_needed(_s)):
        logging.getLogger(__name__).info("office entries migrated to forms: %s", _migrated)
    if mark_interrupted(_s):
        _s.commit()
executor = RunExecutor(settings, SessionF)

WEB_DIR = Path(__file__).parent
app = FastAPI(title="DGIPR publicity tracking", docs_url=None, redoc_url=None)
app.add_middleware(AuthMiddleware, session_factory=lambda: SessionF)
app.mount("/static", StaticFiles(directory=WEB_DIR / "static"), name="static")
app.mount("/fonts", StaticFiles(directory=WEB_DIR.parent / "static" / "fonts"), name="fonts")
templates = Jinja2Templates(directory=WEB_DIR / "templates")
templates.env.globals.update(num=num, COLUMNS=COLUMNS, PLATFORMS=PLATFORMS)


def _ist(dt) -> str:
    return as_aware_utc(dt).astimezone(IST).strftime("%Y-%m-%d %H:%M IST") if dt else "—"


templates.env.filters["ist"] = _ist
templates.env.filters["tojson_pretty"] = lambda v: json.dumps(v, ensure_ascii=False, indent=1, default=str)


# --------------------------------------------------------------------------- operator identity
def get_session():
    with SessionF() as s:
        yield s


def operator(request: Request) -> str:
    """The logged-in user's username: the actor recorded in the audit trail (AuthMiddleware sets it)."""
    user = getattr(request.state, "user", None)
    return user.username if user else ""


def require_operator(request: Request) -> str:
    name = operator(request)
    if not name:
        raise HTTPException(401, "login required")
    return name


def page(request: Request, name: str, **ctx: Any) -> HTMLResponse:
    return templates.TemplateResponse(request, name, {"operator": operator(request), **ctx})


def back(url: str, **params: Any) -> RedirectResponse:
    q = urlencode({k: v for k, v in params.items() if v not in (None, "")})
    return RedirectResponse(f"{url}?{q}" if q else url, status_code=303)


def _date(value: Optional[str], default: date) -> date:
    return date.fromisoformat(value) if value else default


def _default_day() -> date:
    return (as_aware_utc(utcnow()).astimezone(IST) - timedelta(days=1)).date()


def _campaign(s: Session, campaign_id: Optional[int]) -> Campaign:
    c = s.get(Campaign, campaign_id) if campaign_id else s.scalar(select(Campaign).where(Campaign.active.is_(True))
                                                                   .order_by(Campaign.id))
    if not c:
        raise HTTPException(404, "campaign not found")
    return c


# --------------------------------------------------------------------------- dashboard
@app.get("/classic", response_class=HTMLResponse)
def dashboard(request: Request, s: Session = Depends(get_session)):
    runs = s.scalars(select(CollectionRun).order_by(CollectionRun.id.desc()).limit(10)).all()
    snaps = s.scalars(select(ReportSnapshot).order_by(ReportSnapshot.id.desc()).limit(10)).all()
    campaigns = s.scalars(select(Campaign).order_by(Campaign.id)).all()
    return page(request, "dashboard.html", runs=runs, snaps=snaps, campaigns=campaigns,
                providers=provider_status(settings), default_day=_default_day())


# --------------------------------------------------------------------------- accounts
@app.get("/accounts", response_class=HTMLResponse)
def accounts_page(request: Request, s: Session = Depends(get_session)):
    accounts = s.scalars(select(Account).order_by(Account.platform, Account.handle)).all()
    divisions = s.scalars(select(Division).where(Division.active.is_(True)).order_by(Division.sort_order)).all()
    return page(request, "accounts.html", accounts=accounts, divisions=divisions)


@app.post("/accounts")
def account_add(request: Request, platform: str = Form(...), handle: str = Form(...), url: str = Form(...),
                display_name: str = Form(""), office_code: str = Form(""), mapping_note: str = Form(""),
                s: Session = Depends(get_session)):
    create_account(s, require_operator(request), platform=platform, handle=handle, url=url,
                   display_name=display_name, office_code=office_code, mapping_note=mapping_note)
    s.commit()
    return back("/accounts")


def create_account(s: Session, actor: str, *, platform: str, handle: str, url: str, display_name: str = "",
                   office_code: str = "", mapping_note: str = "") -> Account:
    if platform not in PLATFORMS:
        raise HTTPException(400, "unknown platform")
    if not handle.strip() or not url.strip():
        raise HTTPException(400, "handle and URL are required")
    key = handle_key(handle)
    if s.scalar(select(Account).where(Account.platform == platform, Account.handle_key == key)):
        raise HTTPException(400, "account already registered")
    acc = Account(platform=platform, handle=handle.strip(), handle_key=key, url=url.strip(),
                  display_name=display_name, office_code=office_code or None, mapping_confirmed=False,
                  mapping_note=mapping_note, provider_meta={})
    s.add(acc)
    s.flush()
    audit.record(s, actor, "account.create", "account", acc.id,
                 after={"platform": platform, "handle": acc.handle, "office": acc.office_code})
    return acc


@app.post("/accounts/{account_id}")
def account_update(request: Request, account_id: int, office_code: str = Form(""), mapping_note: str = Form(""),
                   active: Optional[str] = Form(None), confirm_mapping: Optional[str] = Form(None),
                   s: Session = Depends(get_session)):
    acc = s.get(Account, account_id) or _404()
    update_account(s, acc, require_operator(request), office_code=office_code, mapping_note=mapping_note,
                   active=bool(active), confirm_mapping=bool(confirm_mapping))
    s.commit()
    return back("/accounts")


def update_account(s: Session, acc: Account, actor: str, *, office_code: str, mapping_note: str, active: bool,
                   confirm_mapping: bool) -> None:
    before = {"office": acc.office_code, "confirmed": acc.mapping_confirmed, "active": acc.active,
              "note": acc.mapping_note}
    new_office = office_code or None
    if new_office != acc.office_code:
        acc.office_code = new_office
        acc.mapping_confirmed = False
        # Keep the publication-level mapping consistent with the registry.
        for pub in s.scalars(select(Publication).where(Publication.account_id == acc.id)).all():
            pub.office_code = new_office
    if confirm_mapping and acc.office_code:
        acc.mapping_confirmed = True
    acc.mapping_note = mapping_note
    acc.active = active
    audit.record(s, actor, "account.update", "account", acc.id, before=before,
                 after={"office": acc.office_code, "confirmed": acc.mapping_confirmed, "active": acc.active,
                        "note": acc.mapping_note})


def _404():
    raise HTTPException(404, "not found")


# --------------------------------------------------------------------------- campaigns
@app.get("/campaigns/{campaign_id}", response_class=HTMLResponse)
def campaign_page(request: Request, campaign_id: int, test_text: str = "", s: Session = Depends(get_session)):
    c = s.get(Campaign, campaign_id) or _404()
    result = None
    if test_text:
        result = get_classifier().classify(ClassificationInput(text=test_text), c.rules or {})
    return page(request, "campaign.html", c=c, rules_yaml=yaml.safe_dump(c.rules, allow_unicode=True, sort_keys=False),
                count_yaml=yaml.safe_dump(effective_rules(c.count_rules), allow_unicode=True, sort_keys=False),
                test_text=test_text, result=result, campaigns=s.scalars(select(Campaign)).all())


@app.post("/campaigns/{campaign_id}")
def campaign_update(request: Request, campaign_id: int, title_mr: str = Form(...), title_en: str = Form(""),
                    rules_yaml: str = Form(...), count_yaml: str = Form(...), s: Session = Depends(get_session)):
    c = s.get(Campaign, campaign_id) or _404()
    update_campaign(s, c, require_operator(request), title_mr=title_mr, title_en=title_en, rules_yaml=rules_yaml,
                    count_yaml=count_yaml)
    s.commit()
    return back(f"/campaigns/{campaign_id}")


def update_campaign(s: Session, c: Campaign, actor: str, *, title_mr: str, title_en: str, rules_yaml: str,
                    count_yaml: str) -> None:
    try:
        rules = yaml.safe_load(rules_yaml) or {}
        count_rules = yaml.safe_load(count_yaml) or {}
        assert isinstance(rules, dict) and isinstance(count_rules, dict)
    except Exception as exc:
        raise HTTPException(400, f"invalid YAML: {exc}")
    before = {"title_mr": c.title_mr, "rules": c.rules, "count_rules": c.count_rules, "version": c.version}
    c.title_mr, c.title_en, c.rules, c.count_rules = title_mr, title_en, rules, count_rules
    c.version += 1
    c.updated_at, c.updated_by = utcnow(), actor
    audit.record(s, actor, "campaign.update", "campaign", c.id, before=before,
                 after={"title_mr": c.title_mr, "rules": rules, "count_rules": count_rules, "version": c.version})


@app.post("/campaigns/{campaign_id}/reclassify")
def campaign_reclassify(request: Request, campaign_id: int, start: str = Form(...), end: str = Form(...),
                        s: Session = Depends(get_session)):
    actor = require_operator(request)
    c = s.get(Campaign, campaign_id) or _404()
    n = classify_period(s, c, date.fromisoformat(start), date.fromisoformat(end))
    audit.record(s, actor, "campaign.reclassify", "campaign", c.id, after={"period": [start, end], "count": n,
                                                                           "rules_version": c.version},
                 note="automatic decisions recomputed; manual decisions preserved")
    s.commit()
    return back("/review", campaign_id=campaign_id, start=start, end=end)


# --------------------------------------------------------------------------- collection runs
@app.get("/runs/new", response_class=HTMLResponse)
def run_new(request: Request, start: Optional[str] = None, end: Optional[str] = None,
            campaign_id: Optional[int] = None, s: Session = Depends(get_session)):
    d0 = _date(start, _default_day())
    accounts = s.scalars(select(Account).where(Account.active.is_(True)).order_by(Account.platform)).all()
    return page(request, "run_new.html", start=d0, end=_date(end, d0), accounts=accounts,
                campaigns=s.scalars(select(Campaign).where(Campaign.active.is_(True))).all(),
                campaign_id=campaign_id, overlap=settings.overlap_hours, providers=provider_status(settings))


@app.post("/runs")
async def run_create(request: Request, s: Session = Depends(get_session)):
    actor = require_operator(request)
    form = await request.form()
    try:
        run = create_run(s, settings, campaign_id=int(form["campaign_id"]),
                         period_start=date.fromisoformat(str(form["start"])),
                         period_end=date.fromisoformat(str(form["end"])),
                         account_ids=[int(x) for x in form.getlist("account_ids")], actor=actor,
                         overlap_hours=int(form.get("overlap_hours") or settings.overlap_hours),
                         mode=str(form.get("mode") or "window"))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    s.commit()
    executor.submit(run.id)
    return back(f"/runs/{run.id}")


def _superseded(t: CollectionTask) -> bool:
    """A failed/partial task whose window a later collection has since covered no longer needs attention."""
    s = object_session(t)
    return (t.status in ("failed", "partial") and s is not None and t.requested_start_utc is not None
            and is_covered(s, t.account_id, t.requested_start_utc, t.requested_end_utc))


def _task_json(t: CollectionTask) -> dict[str, Any]:
    sup = _superseded(t)
    return {"id": t.id, "platform": t.platform, "handle": t.account.handle, "provider": t.provider,
            "status": "complete" if sup else t.status, "window_complete": True if sup else t.window_complete,
            "coverage_note": "window covered by a later collection" if sup else t.coverage_note,
            "pages": t.pages_fetched, "received": t.items_received, "in_window": t.items_in_window,
            "new": t.items_new, "updated": t.items_updated, "unparseable": t.items_unparseable,
            "requests": t.requests_made, "usage": t.usage, "progress": t.progress_message,
            "error_kind": None if sup else t.error_kind, "error": None if sup else t.error_message}


def retry_task_ids(run: CollectionRun) -> list[int]:
    """Mark a run's failed/partial tasks pending again. A failed task keeps resume_state so an interrupted
    async provider job is resumed; a partial task's provider job already finished, so resuming it would only
    re-read the same (capped) dataset — it starts a fresh job instead."""
    ids = []
    for t in run.tasks:
        if t.status in ("failed", "partial") and not _superseded(t):
            if t.status == "partial":
                t.resume_state = {}
            t.status = "pending"
            ids.append(t.id)
    return ids


def _run_json(run: CollectionRun) -> dict[str, Any]:
    return {
        "id": run.id, "status": run.status, "active": executor.is_active(run.id),
        "campaign_id": run.campaign_id, "period_start": run.period_start.isoformat(),
        "period_end": run.period_end.isoformat(), "window_start_utc": run.window_start_utc.isoformat(),
        "window_end_utc": run.window_end_utc.isoformat(), "overlap_hours": run.overlap_hours, "mode": run.mode,
        "triggered_by": run.triggered_by, "trigger_source": run.trigger_source, "created_at": _ist(run.created_at),
        "started_at": _ist(run.started_at), "finished_at": _ist(run.finished_at),
        "tasks": [_task_json(t) for t in run.tasks],
    }


@app.get("/runs/{run_id}", response_class=HTMLResponse)
def run_page(request: Request, run_id: int, s: Session = Depends(get_session)):
    run = s.get(CollectionRun, run_id) or _404()
    return page(request, "run.html", run=run, data=_run_json(run))


@app.get("/api/runs/{run_id}")
def run_api(run_id: int, s: Session = Depends(get_session)):
    run = s.get(CollectionRun, run_id) or _404()
    return JSONResponse(_run_json(run))


@app.post("/runs/{run_id}/retry")
def run_retry(request: Request, run_id: int, s: Session = Depends(get_session)):
    actor = require_operator(request)
    run = s.get(CollectionRun, run_id) or _404()
    if executor.is_active(run_id):
        raise HTTPException(400, "run is still active")
    ids = retry_task_ids(run)
    if not ids:
        return back(f"/runs/{run_id}")
    run.status = "queued"
    audit.record(s, actor, "run.retry", "collection_run", run.id, after={"task_ids": ids})
    s.commit()
    executor.submit(run_id, only_task_ids=ids)
    return back(f"/runs/{run_id}")


# --------------------------------------------------------------------------- review
@app.get("/review", response_class=HTMLResponse)
def review_page(request: Request, campaign_id: Optional[int] = None, start: Optional[str] = None,
                end: Optional[str] = None, platform: str = "", decision: str = "", office: str = "",
                s: Session = Depends(get_session)):
    c = _campaign(s, campaign_id)
    d0 = _date(start, _default_day())
    d1 = _date(end, d0)
    rows, summary = review_rows(s, c, d0, d1, platform=platform, decision=decision, office=office)
    offices = s.scalars(select(Office).where(Office.active.is_(True)).order_by(Office.division_code,
                                                                              Office.sort_order)).all()
    return page(request, "review.html", c=c, start=d0, end=d1, rows=rows, summary=summary, platform=platform,
                decision=decision, office=office, offices=offices,
                campaigns=s.scalars(select(Campaign)).all())


def review_rows(s: Session, c: Optional[Campaign], d0: date, d1: date, *, platform: str = "", decision: str = "",
                office: str = "") -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Publications in the period with their classification for `c`; with no search term (c=None) none are classified."""
    q = (select(Publication, Classification)
         .outerjoin(Classification, (Classification.publication_id == Publication.id)
                    & (Classification.campaign_id == (c.id if c else -1)))
         .where(Publication.reporting_date >= d0, Publication.reporting_date <= d1)
         .order_by(Publication.published_at_utc.desc()))
    if platform:
        q = q.where(Publication.platform == platform)
    if office:
        q = q.where(Publication.office_code == office)
    rows = []
    for pub, cls in s.execute(q).all():
        eff = cls.effective_decision if cls else "pending"
        if decision and not ((decision == "pending" and eff == "pending") or (cls and cls.auto_decision == decision)
                             or eff == decision):
            continue
        counts, reason = countable(pub, c.count_rules if c else None)
        rows.append({"pub": pub, "cls": cls, "eff": eff, "counts": counts, "count_reason": reason,
                     "highlight": _highlight(pub, cls)})
    summary = {"total": len(rows), "pending": sum(r["eff"] == "pending" and r["counts"] for r in rows),
               "include": sum(r["eff"] == "include" and r["counts"] for r in rows)}
    return rows, summary


def _highlight(pub: Publication, cls: Optional[Classification]) -> dict[str, list[tuple[str, bool]]]:
    """Split each text field into (segment, is_match) parts for evidence highlighting."""
    spans: dict[str, list[tuple[int, int]]] = {}
    for m in ((cls.auto_evidence or {}).get("matches", []) if cls else []):
        spans.setdefault(m["field"], []).append((m["start"], m["end"]))
    out = {}
    for fname in ("title", "text", "description"):
        text = getattr(pub, fname) or ""
        if not text:
            continue
        parts, pos = [], 0
        for a, b in sorted(spans.get(fname, [])):
            if a < pos:
                continue
            parts.append((text[pos:a], False))
            parts.append((text[a:b], True))
            pos = b
        parts.append((text[pos:], False))
        out[fname] = parts
    return out


@app.post("/review/{cls_id}")
def review_decide(request: Request, cls_id: int, action: str = Form(...), note: str = Form(""),
                  report_tag: str = Form("__keep__"), ret: str = Form("/review"),
                  s: Session = Depends(get_session)):
    cls = s.get(Classification, cls_id) or _404()
    decide(s, cls, require_operator(request), action=action, note=note, report_tag=report_tag)
    s.commit()
    return RedirectResponse(ret, status_code=303)


def decide(s: Session, cls: Classification, actor: str, *, action: str, note: str = "",
           report_tag: str = "__keep__") -> None:
    decision = {"include": "include", "exclude": "exclude", "reset": None}.get(action, "invalid")
    if decision == "invalid":
        raise HTTPException(400, "invalid action")
    if decision in ("include", "exclude") and cls.auto_decision != ("match" if decision == "include" else "no_match") \
            and not note.strip():
        raise HTTPException(400, "A note is required when overriding or settling an uncertain automatic decision.")
    tag = None if report_tag == "" else report_tag
    try:
        set_manual_decision(s, cls, decision, actor, note=note, report_tag=tag)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.post("/review/bulk/accept")
def review_accept(request: Request, campaign_id: int = Form(...), start: str = Form(...), end: str = Form(...),
                  s: Session = Depends(get_session)):
    actor = require_operator(request)
    rows = s.scalars(select(Classification).join(Publication).where(
        Classification.campaign_id == campaign_id, Publication.reporting_date >= date.fromisoformat(start),
        Publication.reporting_date <= date.fromisoformat(end))).all()
    accept_auto_matches(s, rows, actor)
    s.commit()
    return back("/review", campaign_id=campaign_id, start=start, end=end)


@app.get("/publications/{pub_id}", response_class=HTMLResponse)
def publication_page(request: Request, pub_id: int, s: Session = Depends(get_session)):
    pub = s.get(Publication, pub_id) or _404()
    raw = s.get(RawRecord, pub.latest_raw_id) if pub.latest_raw_id else None
    classes = s.scalars(select(Classification).where(Classification.publication_id == pub.id)).all()
    history = s.scalars(select(AuditLog).where(AuditLog.entity_type == "classification",
                                               AuditLog.entity_id.in_([str(c.id) for c in classes] or ["-"]))
                        .order_by(AuditLog.id)).all()
    return page(request, "publication.html", pub=pub, raw=raw, classes=classes, history=history)


# --------------------------------------------------------------------------- report: manual inputs, preview, approval
@app.get("/report", response_class=HTMLResponse)
def report_page(request: Request, campaign_id: Optional[int] = None, start: Optional[str] = None,
                end: Optional[str] = None, errors: str = "", s: Session = Depends(get_session)):
    c = _campaign(s, campaign_id)
    d0 = _date(start, _default_day())
    d1 = _date(end, d0)
    data = preview_data(s, c, d0, d1, report_format(settings.config_dir))
    snaps = s.scalars(select(ReportSnapshot).where(ReportSnapshot.campaign_id == c.id,
                                                   ReportSnapshot.period_start == d0, ReportSnapshot.period_end == d1)
                      .order_by(ReportSnapshot.id.desc())).all()
    return page(request, "report.html", c=c, start=d0, end=d1, data=data, snaps=snaps,
                errors=[e for e in errors.split("|") if e], campaigns=s.scalars(select(Campaign)).all())


@app.post("/report/manual")
async def report_manual(request: Request, s: Session = Depends(get_session)):
    """Bulk save of the manual-input grid. Field names: v__<office>__<column> (value),
    z__<office>__<column> (confirm zero checkbox). Only changed cells are written (each audited)."""
    actor = require_operator(request)
    form = await request.form()
    cid, d0, d1 = int(form["campaign_id"]), date.fromisoformat(str(form["start"])), date.fromisoformat(str(form["end"]))
    note = str(form.get("note") or "")
    cells = []
    for key, raw in form.items():
        if key.startswith("v__"):
            _, office, col = key.split("__", 2)
            cells.append((office, col, str(raw).strip(), form.get(f"z__{office}__{col}") is not None))
    errors = save_manual_values(s, actor, cid, d0, d1, cells, note)
    s.commit()
    return back("/report", campaign_id=cid, start=d0, end=d1, errors="|".join(errors))


def save_manual_values(s: Session, actor: str, cid: Optional[int], d0: date, d1: date,
                       cells: list[tuple[str, str, str, bool]], note: str = "") -> list[str]:
    """cells: (office, column, text value ('' = clear), confirm_zero). Only changed cells are written."""
    existing = {(m.office_code, m.column_key): m for m in s.scalars(select(ManualInput).where(
        ManualInput.campaign_id == cid, ManualInput.period_start == d0, ManualInput.period_end == d1)).all()}
    errors = []
    for office, col, text, confirm in cells:
        old = existing.get((office, col))
        try:
            if text == "":
                if old is not None:
                    set_manual_value(s, campaign_id=cid, start=d0, end=d1, office_code=office, column_key=col,
                                     value=None, confirm_zero=False, actor=actor, note=note)
                continue
            value = int(text)
            if old is not None and old.value == value and (value != 0 or old.confirmed_zero):
                continue
            set_manual_value(s, campaign_id=cid, start=d0, end=d1, office_code=office, column_key=col, value=value,
                             confirm_zero=confirm, actor=actor, note=note)
        except (ValueError, ManualInputError) as exc:
            errors.append(f"{office}/{col}: {exc}")
    return errors


@app.get("/report/preview.pdf")
def report_preview(start: str, end: str, campaign_id: Optional[int] = None, download: bool = False,
                   s: Session = Depends(get_session)):
    """download=1: served as an attachment, and without the DRAFT watermark once the report is complete."""
    c = _campaign(s, campaign_id) if campaign_id else None  # no search term: report on all publications
    data = preview_data(s, c, date.fromisoformat(start), date.fromisoformat(end), report_format(settings.config_dir),
                        clean_if_complete=download)
    pdf = render_pdf(data, settings.pdf_browser_channel)
    if download:
        name = f"{'report' if data['presentation']['kind'] == 'final' else 'DRAFT_report'}_{start}_{end}.pdf"
        disposition = f'attachment; filename="{name}"'
    else:
        disposition = f'inline; filename="DRAFT_preview_{start}_{end}.pdf"'
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": disposition})


@app.post("/reports")
def report_create(request: Request, campaign_id: int = Form(...), start: str = Form(...), end: str = Form(...),
                  kind: str = Form(...), note: str = Form(""), s: Session = Depends(get_session)):
    actor = require_operator(request)
    c = _campaign(s, campaign_id)
    try:
        snap = create_snapshot(s, c, date.fromisoformat(start), date.fromisoformat(end), kind=kind, actor=actor,
                               fmt=report_format(settings.config_dir), pdf_dir=settings.pdf_dir,
                               browser_channel=settings.pdf_browser_channel, note=note)
    except IncompleteReportError as exc:
        s.rollback()
        return back("/report", campaign_id=campaign_id, start=start, end=end,
                    errors="|".join([str(exc)] + [i["message"] for i in exc.issues[:20]]))
    s.commit()
    return back(f"/reports/{snap.id}")


@app.get("/reports/{snap_id}", response_class=HTMLResponse)
def snapshot_page(request: Request, snap_id: int, s: Session = Depends(get_session)):
    snap = s.get(ReportSnapshot, snap_id) or _404()
    return page(request, "snapshot.html", snap=snap, d=snap.data, intact=verify_snapshot(snap))


@app.get("/reports/{snap_id}/pdf")
def snapshot_pdf(snap_id: int, s: Session = Depends(get_session)):
    snap = s.get(ReportSnapshot, snap_id) or _404()
    if not snap.pdf_path or not Path(snap.pdf_path).is_file():
        write_pdf(snap, settings.pdf_dir, settings.pdf_browser_channel)  # re-render from the frozen snapshot
        s.commit()
    return FileResponse(snap.pdf_path, media_type="application/pdf", filename=Path(snap.pdf_path).name)


@app.get("/reports/{snap_id}/evidence.csv")
def snapshot_evidence(snap_id: int, s: Session = Depends(get_session)):
    snap = s.get(ReportSnapshot, snap_id) or _404()
    return PlainTextResponse(evidence_csv(snap.data), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="evidence_snapshot{snap_id}.csv"'})


@app.get("/reports/{snap_id}/matrix.csv")
def snapshot_matrix(snap_id: int, s: Session = Depends(get_session)):
    snap = s.get(ReportSnapshot, snap_id) or _404()
    return PlainTextResponse(matrix_csv(snap.data), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="matrix_snapshot{snap_id}.csv"'})


@app.get("/reports/{snap_id}/snapshot.json")
def snapshot_json(snap_id: int, s: Session = Depends(get_session)):
    snap = s.get(ReportSnapshot, snap_id) or _404()
    return JSONResponse(snap.data)


# --------------------------------------------------------------------------- audit
@app.get("/audit", response_class=HTMLResponse)
def audit_page(request: Request, limit: int = 200, s: Session = Depends(get_session)):
    rows = s.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 2000))).all()
    return page(request, "audit.html", rows=rows)


@app.get("/healthz")
def healthz(s: Session = Depends(get_session)):
    return {"ok": True, "publications": s.scalar(select(func.count(Publication.id)))}


# --------------------------------------------------------------------------- JSON API + React UI (registered last)
from app.web import office_api  # noqa: E402,F401
from app.web import forms_api  # noqa: E402,F401
from app.web import api  # noqa: E402,F401  (last: its SPA catch-all)
