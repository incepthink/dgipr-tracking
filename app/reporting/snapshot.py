"""Report snapshots: the frozen dataset a PDF is rendered from.

A snapshot stores the computed matrix, evidence, issues, organisation labels and all presentation
strings. PDFs are rendered only from snapshot data, so an approved report can be regenerated
byte-for-byte in content even after later collections or engagement updates."""
from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.models import Campaign, ReportSnapshot
from app.reporting.aggregate import compute_report
from app.reporting.marathi import period_label, short_datetime
from app.reporting.pdf import render_pdf
from app.timeutil import IST, as_aware_utc, utcnow


class IncompleteReportError(Exception):
    def __init__(self, issues: list[dict[str, Any]]):
        blockers = [i for i in issues if i["severity"] == "blocker"]
        super().__init__(f"report has {len(blockers)} blocking issue(s); save a draft or resolve them first")
        self.issues = blockers


def build_presentation(data: dict[str, Any], fmt: dict[str, Any], *, kind: str, is_sample: bool,
                       generated_at_utc, snapshot_id: Optional[int]) -> dict[str, Any]:
    start, end = date.fromisoformat(data["period"]["start"]), date.fromisoformat(data["period"]["end"])
    label = period_label(start, end)
    campaign = data["campaign"]["title_mr"]
    summary_title = fmt["summary_title_mr"].format(campaign=campaign, date=label).strip()
    generated_ist = as_aware_utc(generated_at_utc).astimezone(IST)
    watermark = badge = ""
    if is_sample:
        watermark = "नमुना माहिती · SAMPLE DATA"
        badge = "नमुना माहिती (SAMPLE / FIXTURE DATA — not real publications)"
    if kind == "draft":
        watermark = (watermark + " · " if watermark else "") + "प्रारूप · DRAFT"
        badge = ("प्रारूप (DRAFT) — अपूर्ण माहिती; अंतिम अहवाल नाही" if data.get("complete") is False
                 else "प्रारूप (DRAFT) — अंतिम मान्यता बाकी") + (" · " + badge if badge else "")
    footer_left = fmt.get("generation_footer_mr", "").format(generated=short_datetime(generated_ist)) \
        if fmt.get("show_generation_footer", True) else ""
    footer_right = ""
    if kind == "draft":
        footer_right = "– : माहिती प्रविष्ट नाही (not entered)   * : अपूर्ण / पुनरावलोकन प्रलंबित (incomplete)"
    elif snapshot_id:
        footer_right = f"Snapshot #{snapshot_id}"
    prefix_end = summary_title.rfind("दि.")
    return {
        "office_line": fmt["office_line_mr"],
        "summary_title": summary_title,
        "summary_title_prefix": summary_title[:prefix_end] if prefix_end >= 0 else summary_title + " ",
        "date_label": label,
        "detail_title": fmt["detail_title_mr"].format(campaign=campaign, date=label).strip(),
        "total_label": fmt.get("total_label_mr", "एकूण"),
        "serial_header": fmt.get("serial_header_mr", "अ.क्र"),
        "division_header": fmt.get("division_header_mr", "विभागाचे नाव"),
        "number_detail_rows": bool(fmt.get("number_detail_rows", True)),
        "font_files": {"regular": fmt.get("font_regular", "NotoSerifDevanagari-Regular.ttf"),
                       "bold": fmt.get("font_bold", "NotoSerifDevanagari-Bold.ttf")},
        "kind": kind,
        "is_sample": is_sample,
        "watermark": watermark,
        "badge": badge,
        "footer_left": footer_left,
        "footer_right": footer_right,
        "generated_at_utc": generated_at_utc.isoformat(timespec="seconds"),
        "generated_at_ist": generated_ist.isoformat(timespec="seconds"),
    }


def preview_data(session: Session, campaign: Optional[Campaign], start: date, end: date, fmt: dict[str, Any],
                 is_sample: bool = False, clean_if_complete: bool = False) -> dict[str, Any]:
    """Live (un-snapshotted) report. Watermarked DRAFT unless clean_if_complete and every cell is complete."""
    data = compute_report(session, campaign, start, end)
    kind = "final" if clean_if_complete and data["complete"] else "draft"
    data["presentation"] = build_presentation(data, fmt, kind=kind, is_sample=is_sample,
                                              generated_at_utc=utcnow(), snapshot_id=None)
    return data


def _hash(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def create_snapshot(session: Session, campaign: Optional[Campaign], start: date, end: date, *, kind: str, actor: str,
                    fmt: dict[str, Any], pdf_dir: Path, browser_channel: str = "", note: str = "",
                    is_sample: bool = False, render: bool = True) -> ReportSnapshot:
    if kind not in ("draft", "final"):
        raise ValueError("kind must be draft or final")
    data = compute_report(session, campaign, start, end)
    if kind == "final" and not data["complete"]:
        raise IncompleteReportError(data["issues"])
    now = utcnow()
    snap = ReportSnapshot(campaign_id=campaign.id if campaign else None, period_start=start, period_end=end, kind=kind,
                          is_sample=is_sample, created_at=now, created_by=actor, note=note, data={}, data_sha256="")
    session.add(snap)
    session.flush()
    data["presentation"] = build_presentation(data, fmt, kind=kind, is_sample=is_sample, generated_at_utc=now,
                                              snapshot_id=snap.id)
    data["snapshot"] = {"id": snap.id, "kind": kind, "created_by": actor, "created_at_utc": now.isoformat(),
                        "note": note}
    snap.data = data
    snap.data_sha256 = _hash(data)
    if kind == "final":
        for old in session.scalars(select(ReportSnapshot).where(
                ReportSnapshot.campaign_id == (campaign.id if campaign else None), ReportSnapshot.period_start == start,
                ReportSnapshot.period_end == end, ReportSnapshot.kind == "final",
                ReportSnapshot.id != snap.id, ReportSnapshot.superseded_by_id.is_(None))).all():
            old.superseded_by_id = snap.id
            audit.record(session, actor, "report.supersede", "report_snapshot", old.id, after={"superseded_by": snap.id})
    if render:
        write_pdf(snap, pdf_dir, browser_channel)
    audit.record(session, actor, f"report.{kind}", "report_snapshot", snap.id,
                 after={"period": [start.isoformat(), end.isoformat()], "data_sha256": snap.data_sha256,
                        "pdf_sha256": snap.pdf_sha256, "complete": data["complete"], "sample": is_sample}, note=note)
    return snap


def write_pdf(snap: ReportSnapshot, pdf_dir: Path, browser_channel: str = "") -> Path:
    pdf_dir.mkdir(parents=True, exist_ok=True)
    pdf = render_pdf(snap.data, browser_channel)
    tag = "SAMPLE_" if snap.is_sample else ""
    name = f"{tag}{snap.kind}_{snap.period_start:%Y%m%d}" + \
        (f"-{snap.period_end:%Y%m%d}" if snap.period_end != snap.period_start else "") + f"_snapshot{snap.id}.pdf"
    path = pdf_dir / name
    path.write_bytes(pdf)
    snap.pdf_path = str(path)
    snap.pdf_sha256 = hashlib.sha256(pdf).hexdigest()
    return path


def verify_snapshot(snap: ReportSnapshot) -> bool:
    return _hash(snap.data) == snap.data_sha256
