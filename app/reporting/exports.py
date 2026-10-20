"""Evidence and diagnostics exports (kept separate from the formatted PDF)."""
from __future__ import annotations

import csv
import io
from typing import Any

EVIDENCE_FIELDS = ["publication_id", "platform", "office", "account_id", "url", "published_at_utc", "reporting_date",
                   "content_type", "decision", "decision_source", "auto_decision", "score", "report_tag",
                   "counts_by_rules", "count_reason", "counted_in"]


def evidence_csv(snapshot_data: dict[str, Any]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=EVIDENCE_FIELDS, extrasaction="ignore")
    w.writeheader()
    for row in snapshot_data.get("evidence", []):
        w.writerow({**row, "counted_in": ";".join(row.get("counted_in", []))})
    return "﻿" + buf.getvalue()  # BOM so Excel opens Marathi text as UTF-8


def matrix_csv(snapshot_data: dict[str, Any]) -> str:
    cols = snapshot_data["columns"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["division", "office_code", "office", *[c["label_en"] for c in cols], "row_type"])
    for div in snapshot_data["divisions"]:
        for off in div["offices"]:
            w.writerow([div["code"], off["code"], off["name_mr"],
                        *[_v(off["cells"][c["key"]]) for c in cols], "office"])
        w.writerow([div["code"], "", "एकूण", *[_agg(div["subtotal"][c["key"]]) for c in cols], "subtotal"])
    w.writerow(["", "", "एकूण (राज्य)", *[_agg(snapshot_data["grand_total"][c["key"]]) for c in cols], "grand_total"])
    return "﻿" + buf.getvalue()


def _v(cell: dict[str, Any]) -> str:
    if cell["value"] is None:
        return "MISSING"
    return f"{cell['value']}" + ("" if cell["complete"] else " (incomplete)")


def _agg(agg: dict[str, Any]) -> str:
    if not agg.get("known"):
        return "MISSING"
    return f"{agg['value']}" + ("" if agg["complete"] else " (incomplete)")
