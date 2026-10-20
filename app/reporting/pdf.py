"""PDF rendering. HTML (Jinja) -> PDF through Chromium (Playwright), which shapes Devanagari with
HarfBuzz. The bundled font is embedded in the HTML so output does not depend on system fonts.

The renderer only reads snapshot data, so any approved snapshot re-renders identically."""
from __future__ import annotations

import base64
from functools import lru_cache
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.reporting.marathi import num
from app.settings import BASE_DIR

TEMPLATE_DIR = Path(__file__).parent / "templates"
FONT_DIR = BASE_DIR / "app" / "static" / "fonts"
# Static (non-variable) instances: Chromium embeds these as real TrueType subsets with a ToUnicode map;
# a variable font at a non-default weight would be emitted as Type3 glyph procedures.
DEFAULT_FONTS = {"regular": "NotoSerifDevanagari-Regular.ttf", "bold": "NotoSerifDevanagari-Bold.ttf"}


def _subtotal_cell(agg: dict[str, Any]) -> dict[str, Any]:
    """A subtotal is shown when at least one component is known; it is flagged incomplete unless every
    component is complete. With no known component it is shown as missing."""
    return {"value": agg["value"] if agg.get("known") else None, "complete": bool(agg.get("complete"))}


@lru_cache(maxsize=4)
def _font_data_uri(font_file: str) -> str:
    data = (FONT_DIR / font_file).read_bytes()
    return "data:font/ttf;base64," + base64.b64encode(data).decode()


def _env() -> Environment:
    env = Environment(loader=FileSystemLoader(TEMPLATE_DIR), autoescape=select_autoescape(["html"]))
    env.globals["num"] = num
    env.filters["subtotal_cell"] = _subtotal_cell
    return env


def render_html(snapshot_data: dict[str, Any]) -> str:
    d = snapshot_data
    p = d["presentation"]
    pages: dict[int, list[dict[str, Any]]] = {}
    for div in d["divisions"]:
        pages.setdefault(int(div.get("detail_page", 1)), []).append(div)
    detail_pages = [pages[k] for k in sorted(pages)]
    fonts = p.get("font_files") or {}
    return _env().get_template("report.html").render(
        d=d, p=p, detail_pages=detail_pages,
        font_regular=_font_data_uri(fonts.get("regular", DEFAULT_FONTS["regular"])),
        font_bold=_font_data_uri(fonts.get("bold", DEFAULT_FONTS["bold"])))


def html_to_pdf(html: str, browser_channel: str = "") -> bytes:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel=browser_channel) if browser_channel else pw.chromium.launch()
        try:
            page = browser.new_page()
            page.set_content(html, wait_until="load")
            page.evaluate("document.fonts.ready")
            return page.pdf(width="11.6933in", height="8.2683in", print_background=True,
                            margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
                            prefer_css_page_size=True)
        finally:
            browser.close()


def render_pdf(snapshot_data: dict[str, Any], browser_channel: str = "") -> bytes:
    return html_to_pdf(render_html(snapshot_data), browser_channel)
