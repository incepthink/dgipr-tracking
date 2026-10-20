"""Explainable keyword/phrase/hashtag classifier for Marathi, Hindi and English.

Original text is never modified. Matching runs on a *matching copy* that is NFC-normalised and has
zero-width joiners removed, using an index map back to the original so evidence offsets point
into the stored text.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Iterable

from app.classification.base import ClassificationInput, ClassificationResult, Evidence

ZW = {"‌", "‍", "﻿"}
# Word characters: \w plus Devanagari block (matras/virama are combining marks, not \w in Python).
WORD = r"[\wऀ-ॿ꣠-ꣿ]"
NOT_WORD_BEFORE = rf"(?<!{WORD})"
NOT_WORD_AFTER = rf"(?!{WORD})"
HASHTAG_RE = re.compile(rf"#({WORD}+)")


def _is_indic(term: str) -> bool:
    return any("ऀ" <= ch <= "ॿ" for ch in term)


def _matching_copy(text: str) -> tuple[str, list[int]]:
    """NFC text without zero-width chars, plus a map from matching index -> original index."""
    out, idx = [], []
    for i, ch in enumerate(text):
        if ch in ZW:
            continue
        out.append(ch)
        idx.append(i)
    # NFC may merge characters; only normalise when it does not change length so offsets stay exact.
    joined = "".join(out)
    nfc = unicodedata.normalize("NFC", joined)
    if len(nfc) == len(joined):
        joined = nfc
    return joined.casefold() if joined.isascii() else _casefold_latin(joined), idx


def _casefold_latin(s: str) -> str:
    # casefold() can change string length for some characters (e.g. ß); fold char-by-char safely.
    return "".join(c.casefold() if len(c.casefold()) == 1 else c for c in s)


def _term_pattern(term: str) -> re.Pattern[str]:
    t = unicodedata.normalize("NFC", "".join(c for c in term.strip() if c not in ZW))
    prefix = t.endswith("*")
    t = t.rstrip("*")
    words = [re.escape(_casefold_latin(w)) for w in t.split()]
    body = r"\s+".join(words)
    if _is_indic(t) or prefix:
        # Devanagari: match at word start, allow inflectional suffixes (दुष्काळ -> दुष्काळी).
        return re.compile(NOT_WORD_BEFORE + body)
    return re.compile(NOT_WORD_BEFORE + body + NOT_WORD_AFTER)


def _lang_items(rules_section: Any) -> Iterable[tuple[str, str]]:
    if isinstance(rules_section, dict):
        for lang, terms in rules_section.items():
            for t in terms or []:
                if str(t).strip():
                    yield lang, str(t)
    elif isinstance(rules_section, list):
        for t in rules_section:
            if str(t).strip():
                yield "any", str(t)


def _snippet(text: str, start: int, end: int, width: int = 40) -> str:
    lo, hi = max(0, start - width), min(len(text), end + width)
    return ("…" if lo else "") + text[lo:hi].replace("\n", " ") + ("…" if hi < len(text) else "")


class KeywordClassifier:
    name = "keyword"
    version = "1.0"

    def classify(self, item: ClassificationInput, rules: dict[str, Any]) -> ClassificationResult:
        weights = {"keyword": 1, "phrase": 2, "hashtag": 2, **(rules.get("weights") or {})}
        match_threshold = float(rules.get("match_threshold", 2))
        review_threshold = float(rules.get("review_threshold", 1))
        min_chars = int(rules.get("min_text_chars", 25))
        fields = [("title", item.title), ("text", item.text), ("description", item.description)]

        evidence: list[Evidence] = []
        exclusions: list[Evidence] = []
        taken: list[tuple[str, int, int]] = []

        def overlaps(fname: str, s: int, e: int) -> bool:
            return any(f == fname and s < te and ts < e for f, ts, te in taken)

        def scan(kind: str, section: Any, sink: list[Evidence]) -> None:
            for lang, term in _lang_items(section):
                pat = _term_pattern(term)
                for fname, original in fields:
                    if not original:
                        continue
                    mcopy, idx = _matching_copy(original)
                    for m in pat.finditer(mcopy):
                        s, e = idx[m.start()], idx[m.end() - 1] + 1
                        if kind != "exclusion":
                            # A span already explained by a phrase or another term (e.g. दुष्काळ vs
                            # दुष्काळी) is not scored twice.
                            if overlaps(fname, s, e):
                                continue
                            taken.append((fname, s, e))
                        sink.append(Evidence(term=term, kind=kind, lang=lang, field=fname, start=s, end=e,
                                             snippet=_snippet(original, s, e)))

        # Phrases first so their spans are not double counted as keywords.
        scan("phrase", rules.get("phrases"), evidence)
        scan("keyword", rules.get("keywords"), evidence)
        self._scan_hashtags(rules.get("hashtags") or [], fields, evidence)
        scan("exclusion", rules.get("exclusions"), exclusions)

        # Count each distinct term once per kind (repetition should not inflate relevance).
        distinct = {(e.kind, e.term.casefold()) for e in evidence}
        score = float(sum(weights.get(kind, 1) for kind, _ in distinct))
        reasons: list[str] = []
        meaningful = sum(1 for _, t in fields for ch in (t or "") if ch.isalnum() or "ऀ" <= ch <= "ॿ")

        if exclusions:
            reasons.append("exclusion term(s) matched: " + ", ".join(sorted({e.term for e in exclusions})))
            return ClassificationResult("no_match", score, evidence + exclusions, reasons)
        if score >= match_threshold:
            reasons.append(f"score {score:g} ≥ match threshold {match_threshold:g}")
            return ClassificationResult("match", score, evidence, reasons)
        if score >= review_threshold:
            reasons.append(f"score {score:g} below match threshold {match_threshold:g}: needs human review")
            return ClassificationResult("needs_review", score, evidence, reasons)
        if meaningful < min_chars:
            reasons.append(f"only {meaningful} meaningful characters of text"
                           + (" (media-only publication)" if item.has_media else "")
                           + ": relevance cannot be assessed from text; image/video content is not analysed")
            return ClassificationResult("insufficient_text", score, evidence, reasons)
        reasons.append("no campaign terms found in text")
        return ClassificationResult("no_match", score, evidence, reasons)

    @staticmethod
    def _scan_hashtags(tags: list[str], fields: list[tuple[str, str]], sink: list[Evidence]) -> None:
        wanted = {}
        for t in tags:
            body = unicodedata.normalize("NFC", str(t).lstrip("#").strip())
            if body:
                wanted[_casefold_latin(body)] = str(t)
        if not wanted:
            return
        for fname, original in fields:
            if not original:
                continue
            mcopy, idx = _matching_copy(original)
            for m in HASHTAG_RE.finditer(mcopy):
                tag = m.group(1)
                if tag in wanted:
                    s, e = idx[m.start()], idx[m.end() - 1] + 1
                    sink.append(Evidence(term=wanted[tag], kind="hashtag", lang="any", field=fname, start=s, end=e,
                                         snippet=_snippet(original, s, e)))
