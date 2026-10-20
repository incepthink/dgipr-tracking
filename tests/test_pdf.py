"""PDF rendering from a frozen snapshot (needs Chromium/Edge via Playwright; skipped otherwise)."""
from __future__ import annotations

import json
import os
from pathlib import Path

import pymupdf
import pytest

from app.reporting.pdf import render_html, render_pdf

SNAP = Path(__file__).resolve().parent.parent / "samples" / "sample_snapshot_2026-10-12.json"
CHANNEL = os.environ.get("PDF_BROWSER_CHANNEL", "")


@pytest.fixture(scope="module")
def data():
    if not SNAP.is_file():
        pytest.skip("run scripts/load_sample.py first")
    return json.loads(SNAP.read_text(encoding="utf-8"))


def test_html_has_reference_structure(data):
    html = render_html(data)
    assert html.count('class="page"') == 4
    for label in ("अ.क्र", "विभागाचे नाव", "कात्रणांची", "इन्सटाग्राम", "उपक्रम/", "महासंवाद", "जिल्हानिहाय", "एकूण"):
        assert label in html


def test_pdf_pages_size_and_text(data):
    try:
        pdf = render_pdf(data, CHANNEL)
    except Exception as exc:  # no browser installed
        pytest.skip(f"browser unavailable: {exc}")
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    assert doc.page_count == 4
    for page in doc:
        assert abs(page.rect.width - 841.92) < 1.5 and abs(page.rect.height - 595.32) < 1.5
    fonts = {(f[2], f[3]) for p in doc for f in p.get_fonts()}
    assert all(kind != "Type3" for kind, _ in fonts), fonts  # real embedded font subsets, not glyph procedures
    assert any("NotoSerifDevanagari" in name for _, name in fonts), fonts
    assert "विभागनिहाय" in doc[0].get_text() and "जिल्हानिहाय" in doc[1].get_text()
