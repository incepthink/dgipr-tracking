"""Report columns, in the exact order and wording of the reference PDF.

source:
  manual   — no automated data source yet; operator enters values (or explicitly confirms zero)
  platform — counted from approved publications of registered accounts on that platform; offices
             without a registered account on the platform fall back to manual entry
  tag      — 'video bites' / 'video interviews': manual by default; with count rule
             <key>_source: reviewer_tag they are counted from publications a reviewer explicitly tagged
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class Column:
    key: str
    label_mr: str
    header_lines: tuple[str, ...]
    source: str
    platform: Optional[str] = None
    tag: Optional[str] = None
    label_en: str = ""
    group: str = "other"  # print | video | social | other — groups the office data-entry form


COLUMNS: tuple[Column, ...] = (
    Column("articles", "लेख", ("लेख",), "manual", label_en="Articles", group="print"),
    Column("news", "वृत्त", ("वृत्त",), "manual", label_en="News items", group="print"),
    Column("clippings", "कात्रणांची संख्या", ("कात्रणांची", "संख्या"), "manual", label_en="Newspaper clippings",
           group="print"),
    Column("video_bites", "व्हिडिओ बाईट्स", ("व्हिडिओ", "बाईट्स"), "tag", tag="video_bite", label_en="Video bites",
           group="video"),
    Column("video_interviews", "व्हिडिओ मुलाखत", ("व्हिडिओ", "मुलाखत"), "tag", tag="video_interview",
           label_en="Video interviews", group="video"),
    Column("facebook", "फेसबुक", ("फेसबुक",), "platform", platform="facebook", label_en="Facebook", group="social"),
    Column("instagram", "इन्सटाग्राम", ("इन्सटाग्राम",), "platform", platform="instagram", label_en="Instagram",
           group="social"),
    Column("x", "एक्स", ("एक्स",), "platform", platform="x", label_en="X", group="social"),
    Column("blog", "ब्लॉग", ("ब्लॉग",), "manual", label_en="Blog", group="social"),
    Column("youtube", "युट्युब", ("युट्युब",), "platform", platform="youtube", label_en="YouTube", group="social"),
    Column("public_app", "पब्लीक ॲप", ("पब्लीक", "ॲप"), "manual", label_en="Public App"),
    Column("activities", "उपक्रम/ मावजस होर्डिंग, महासंवाद", ("उपक्रम/", "मावजस", "होर्डिंग,", "महासंवाद"), "manual",
           label_en="Activities / hoardings / Mahasamvad"),
)

COLUMN_KEYS = tuple(c.key for c in COLUMNS)
BY_KEY = {c.key: c for c in COLUMNS}
