"""Computes report values for one campaign and reporting period.

Every district cell, division subtotal and grand total is derived from the same dataset in one
pass, so totals can never disagree with the rows they summarise. The result is plain JSON so it can
be frozen into a ReportSnapshot unchanged.

Sources. When the campaign's linked form (app.forms, Form.campaign_id) has submitted values in the period,
every one of the 12 columns comes from what the offices submitted (fields keyed like the columns), summed over
the period's days; a cell is complete only if the office entered
that column on every day. Counts from collected publications then stay in the cell as `collected`, a
cross-check whose problems (pending review, unconfirmed mapping) are warnings, not blockers. Periods without
office entries (older reports) keep the earlier behaviour: social columns counted from collected
publications, the rest from operator-entered ManualInput rows for exactly that period.

Cell states:
  entered         summed from office entries
  auto            counted from approved publications of registered accounts
  manual          entered by an operator
  confirmed_zero  operator explicitly confirmed zero
  missing         nothing entered and no automated source — never shown or summed as zero
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.classification.count_rules import countable, effective_rules
from app.collection import store
from app.forms.service import COUNTED
from app.models import (Account, Campaign, Classification, CollectionTask, Division, Form, FormField,
                        FormSubmission, FormValue, ManualInput, Office, Publication)
from app.reporting.columns import COLUMN_KEYS, COLUMNS
from app.timeutil import period_bounds_utc

SCHEMA_VERSION = 1


def _empty_cell() -> dict[str, Any]:
    return {"value": None, "state": "missing", "complete": False, "issues": [], "publication_ids": [],
            "manual": None, "source": "manual"}


def compute_report(session: Session, campaign: Optional[Campaign], start: date, end: date) -> dict[str, Any]:
    """With no search term (campaign=None) there is nothing to review: every countable publication counts."""
    cid = campaign.id if campaign else None
    rules = effective_rules(campaign.count_rules if campaign else None)
    lo, hi = period_bounds_utc(start, end)
    divisions = session.scalars(select(Division).where(Division.active.is_(True))
                                .order_by(Division.sort_order)).all()
    offices_by_div = {d.code: [o for o in d.offices if o.active] for d in divisions}
    active_offices = {o.code for offs in offices_by_div.values() for o in offs}

    accounts = session.scalars(select(Account).where(Account.active.is_(True))).all()
    acc_by_office_platform: dict[tuple[str, str], list[Account]] = defaultdict(list)
    acc_by_office: dict[str, list[Account]] = defaultdict(list)
    for a in accounts:
        if a.office_code:
            acc_by_office_platform[(a.office_code, a.platform)].append(a)
            acc_by_office[a.office_code].append(a)
    coverage = {a.id: store.is_covered(session, a.id, lo, hi) for a in accounts}

    manual_rows = session.scalars(select(ManualInput).where(
        ManualInput.campaign_id == cid, ManualInput.period_start == start,
        ManualInput.period_end == end)).all()
    manual = {(m.office_code, m.column_key): m for m in manual_rows}

    entries: dict[tuple[str, str], dict[date, int]] = defaultdict(dict)  # (office, column) -> {day: value}
    form_id = session.scalar(select(Form.id).where(Form.campaign_id == cid, Form.status.in_(('published', 'paused')))
                             .order_by(Form.id.desc()).limit(1)) if cid is not None else None
    if form_id is not None:
        for o, k, d, v in session.execute(
                select(FormSubmission.office_code, FormField.key, FormSubmission.period_start, FormValue.value_num)
                .select_from(FormValue)
                .join(FormSubmission, FormSubmission.id == FormValue.submission_id)
                .join(FormField, FormField.id == FormValue.field_id)
                .where(FormSubmission.form_id == form_id, FormSubmission.status.in_(COUNTED),
                       FormField.key.in_(COLUMN_KEYS), FormValue.value_num.isnot(None),
                       FormSubmission.period_start >= start, FormSubmission.period_start <= end)).all():
            entries[(o, k)][d] = int(v)
    entry_mode = bool(entries)
    all_days = [start + timedelta(days=i) for i in range((end - start).days + 1)]

    pubs = session.execute(
        select(Publication, Classification)
        .outerjoin(Classification, (Classification.publication_id == Publication.id)
                   & (Classification.campaign_id == (cid or -1)))
        .where(Publication.reporting_date >= start, Publication.reporting_date <= end,
               Publication.account_id.in_([a.id for a in accounts] or [-1]))
    ).all()

    issues: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []
    counted: dict[tuple[str, str], list[int]] = defaultdict(list)    # (office, column) -> publication ids
    pending: dict[tuple[str, str], list[int]] = defaultdict(list)
    platform_col = {c.platform: c.key for c in COLUMNS if c.source == "platform"}
    tag_cols = {c.tag: c.key for c in COLUMNS if c.source == "tag" and rules.get(f"{c.key}_source") == "reviewer_tag"}

    for pub, cls in pubs:
        office = pub.office_code
        if not office:
            continue
        decision = cls.effective_decision if cls else ("pending" if campaign else "include")
        counts, count_reason = countable(pub, rules)
        col = platform_col.get(pub.platform)
        record = {"publication_id": pub.id, "platform": pub.platform, "office": office, "url": pub.url,
                  "account_id": pub.account_id, "published_at_utc": pub.published_at_utc.isoformat(),
                  "reporting_date": pub.reporting_date.isoformat(), "content_type": pub.content_type,
                  "decision": decision, "decision_source": "manual" if cls and cls.manual_decision else "auto",
                  "auto_decision": cls.auto_decision if cls else None, "score": cls.auto_score if cls else None,
                  "report_tag": cls.report_tag if cls else None, "counts_by_rules": counts,
                  "count_reason": count_reason, "counted_in": []}
        if decision == "pending" and counts:
            if col:
                pending[(office, col)].append(pub.id)
        elif decision == "include" and counts:
            if col:
                counted[(office, col)].append(pub.id)
                record["counted_in"].append(col)
            tag_col = tag_cols.get(cls.report_tag) if cls else None
            if tag_col:
                counted[(office, tag_col)].append(pub.id)
                record["counted_in"].append(tag_col)
        evidence.append(record)

    out_divisions = []
    grand: dict[str, dict[str, Any]] = {c.key: {"value": 0, "known": 0, "complete": True} for c in COLUMNS}
    for div in divisions:
        offices_out = []
        sub: dict[str, dict[str, Any]] = {c.key: {"value": 0, "known": 0, "complete": True} for c in COLUMNS}
        for off in offices_by_div[div.code]:
            cells = {}
            for col in COLUMNS:
                cell = _empty_cell()
                auto_accounts: list[Account] = []
                if col.source == "platform":
                    auto_accounts = acc_by_office_platform.get((off.code, col.platform), [])
                elif col.source == "tag" and col.key in tag_cols.values():
                    auto_accounts = acc_by_office.get(off.code, [])
                if entry_mode:
                    _fill_from_entries(cell, entries.get((off.code, col.key), {}), all_days,
                                       manual.get((off.code, col.key)), off, col.key, issues)
                    if auto_accounts:
                        cell["collected"] = _collected(off, col.key, auto_accounts, counted, pending, coverage,
                                                       cell, issues)
                elif auto_accounts:
                    ids = counted.get((off.code, col.key), [])
                    cell.update(value=len(ids), state="auto", source="automated", publication_ids=ids,
                                accounts=[a.id for a in auto_accounts], complete=True)
                    not_covered = [a for a in auto_accounts if not coverage[a.id]]
                    unconfirmed = [a for a in auto_accounts if not a.mapping_confirmed]
                    pend = pending.get((off.code, col.key), [])
                    if not_covered:
                        cell["issues"].append("collection_incomplete")
                        issues.append(_issue("blocker", "collection_incomplete", off, col.key,
                                             "collection for the reporting period is missing or incomplete for "
                                             + ", ".join(f"{a.platform}:{a.handle}" for a in not_covered)))
                    if pend:
                        cell["issues"].append("pending_review")
                        issues.append(_issue("blocker", "pending_review", off, col.key,
                                             f"{len(pend)} publication(s) awaiting review", pend))
                    if unconfirmed:
                        cell["issues"].append("mapping_unconfirmed")
                        issues.append(_issue("blocker", "mapping_unconfirmed", off, col.key,
                                             "account-to-office mapping not confirmed for "
                                             + ", ".join(f"{a.platform}:{a.handle}" for a in unconfirmed)))
                    cell["complete"] = not cell["issues"]
                else:
                    _fill_manual(cell, manual.get((off.code, col.key)))
                cells[col.key] = cell
                agg = sub[col.key]
                if cell["value"] is not None:
                    agg["value"] += cell["value"]
                    agg["known"] += 1
                agg["complete"] = agg["complete"] and cell["complete"]
            offices_out.append({"code": off.code, "name_mr": off.name_mr, "name_en": off.name_en,
                                "kind": off.kind, "cells": cells})
            missing_cols = [c.key for c in COLUMNS if cells[c.key]["state"] == "missing"]
            if missing_cols:
                issues.append(_issue("blocker", "missing_input", off, None,
                                     f"no value entered for: {', '.join(missing_cols)}", columns=missing_cols))
        for key, agg in sub.items():
            g = grand[key]
            g["value"] += agg["value"]
            g["known"] += agg["known"]
            g["complete"] = g["complete"] and agg["complete"]
        out_divisions.append({"code": div.code, "summary_label_mr": div.summary_label_mr,
                              "section_title_mr": div.section_title_mr, "show_subtotal": div.show_subtotal,
                              "detail_page": div.detail_page, "offices": offices_out, "subtotal": sub})

    unmapped = [a for a in accounts if not a.office_code or a.office_code not in active_offices]
    for a in unmapped:
        issues.append({"severity": "warning", "code": "account_unmapped", "office": None, "column": None,
                       "message": f"{a.platform}:{a.handle} is not mapped to an active office; "
                                  f"its publications are not counted"})

    failed_tasks = session.scalars(select(CollectionTask).join(Account)
                                   .where(CollectionTask.status.in_(("failed", "partial")),
                                          CollectionTask.requested_start_utc < hi,
                                          CollectionTask.requested_end_utc > lo)).all()
    for t in failed_tasks:
        if not coverage.get(t.account_id):
            issues.append({"severity": "warning", "code": "task_failed", "office": t.account.office_code,
                           "column": None, "message": f"run {t.run_id}: {t.platform}:{t.account.handle} "
                                                      f"{t.status} — {t.error_kind or ''} {t.error_message or ''}".strip()})

    return {
        "schema": SCHEMA_VERSION,
        "source": "office_entries" if entry_mode else "legacy",
        "campaign": {"id": campaign.id, "slug": campaign.slug, "title_mr": campaign.title_mr,
                     "title_en": campaign.title_en, "rules_version": campaign.version, "count_rules": rules}
        if campaign else {"id": None, "slug": None, "title_mr": "", "title_en": "", "rules_version": None,
                          "count_rules": rules},
        "period": {"start": start.isoformat(), "end": end.isoformat(),
                   "utc_bounds": [lo.isoformat(), hi.isoformat()], "timezone": "Asia/Kolkata"},
        "columns": [{"key": c.key, "label_mr": c.label_mr, "label_en": c.label_en,
                     "header_lines": list(c.header_lines), "source": c.source} for c in COLUMNS],
        "divisions": out_divisions,
        "grand_total": grand,
        "issues": issues,
        "complete": not any(i["severity"] == "blocker" for i in issues),
        "evidence": evidence,
        "accounts": [{"id": a.id, "platform": a.platform, "handle": a.handle, "office": a.office_code,
                      "mapping_confirmed": a.mapping_confirmed, "period_covered": coverage[a.id]} for a in accounts],
    }


def _issue(severity: str, code: str, office: Office, column: str | None, message: str,
           publication_ids: list[int] | None = None, columns: list[str] | None = None) -> dict[str, Any]:
    d: dict[str, Any] = {"severity": severity, "code": code, "office": office.code, "office_name": office.name_mr,
                         "column": column, "message": message}
    if publication_ids:
        d["publication_ids"] = publication_ids
    if columns:
        d["columns"] = columns
    return d


def _fill_manual(cell: dict[str, Any], m: Optional[ManualInput]) -> None:
    if m is not None:
        cell.update(value=m.value, state="confirmed_zero" if m.confirmed_zero else "manual", complete=True,
                    manual={"by": m.entered_by, "at": m.entered_at.isoformat(), "note": m.note})
    else:
        cell["issues"].append("missing")


def _fill_from_entries(cell: dict[str, Any], by_day: dict[date, int], all_days: list[date],
                       fallback: Optional[ManualInput], off: Office, column: str, issues: list[dict[str, Any]]) -> None:
    """Sum of the office's daily entries; complete only when every day of the period has a value."""
    if not by_day:
        _fill_manual(cell, fallback)
        return
    missing_days = [d for d in all_days if d not in by_day]
    cell.update(value=sum(by_day.values()), state="entered", source="office_entry", complete=not missing_days,
                days_entered=len(by_day))
    if missing_days:
        cell["issues"].append("missing_days")
        shown = ", ".join(d.isoformat() for d in missing_days[:10]) + (" …" if len(missing_days) > 10 else "")
        issues.append(_issue("blocker", "missing_days", off, column,
                             f"{column}: no value entered for {len(missing_days)} day(s): {shown}"))


def _collected(off: Office, column: str, accounts: list[Account], counted, pending, coverage,
               cell: dict[str, Any], issues: list[dict[str, Any]]) -> dict[str, Any]:
    """Count from collected publications, kept beside the submitted value as a cross-check (warnings only)."""
    ids = counted.get((off.code, column), [])
    pend = pending.get((off.code, column), [])
    flags = []
    if any(not coverage[a.id] for a in accounts):
        flags.append("collection_incomplete")
    if pend:
        flags.append("pending_review")
        issues.append(_issue("warning", "pending_review", off, column,
                             f"cross-check: {len(pend)} collected publication(s) awaiting review", pend))
    unconfirmed = [a for a in accounts if not a.mapping_confirmed]
    if unconfirmed:
        flags.append("mapping_unconfirmed")
        issues.append(_issue("warning", "mapping_unconfirmed", off, column,
                             "cross-check: account-to-office mapping not confirmed for "
                             + ", ".join(f"{a.platform}:{a.handle}" for a in unconfirmed)))
    complete = not flags
    if complete and cell["value"] is not None and cell["value"] != len(ids):
        issues.append(_issue("warning", "collected_differs", off, column,
                             f"submitted {cell['value']}, collected {len(ids)}", ids))
    cell["publication_ids"] = ids
    return {"value": len(ids), "complete": complete, "issues": flags, "accounts": [a.id for a in accounts]}
