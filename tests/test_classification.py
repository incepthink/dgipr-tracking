"""Keyword classification (Marathi/Hindi/English), overrides and count rules."""
from __future__ import annotations

from datetime import date, datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.classification.base import ClassificationInput
from app.classification.count_rules import countable
from app.classification.keyword import KeywordClassifier
from app.classification.service import classify_period, classify_publication, set_manual_decision
from app.models import AuditLog, Classification, Publication

RULES = {
    "keywords": {"mr": ["दुष्काळ", "टंचाई"], "hi": ["सूखा"], "en": ["drought", "tanker*"]},
    "phrases": {"mr": ["दुष्काळ उपाययोजना"], "en": ["drought relief"]},
    "hashtags": ["#दुष्काळ", "#DroughtRelief"],
    "exclusions": {"en": ["drought of goals"]},
    "match_threshold": 2, "review_threshold": 1, "min_text_chars": 25,
}
K = KeywordClassifier()


def run(text, **kw):
    return K.classify(ClassificationInput(text=text, **kw), RULES)


def test_marathi_inflections_count_once_and_phrase_scores_higher():
    r = run("दुष्काळग्रस्त गावांसाठी उपाय; दुष्काळी भागात टंचाई")
    assert r.decision == "match" and r.score == 2  # दुष्काळ (counted once) + टंचाई
    p = run("राज्यातील दुष्काळ उपाययोजना आढावा बैठक संपन्न झाली")
    assert p.decision == "match" and {e.kind for e in p.evidence} == {"phrase"}


def test_single_keyword_needs_review_and_original_offsets():
    text = "आज जिल्ह्यात दुष्काळी परिस्थितीचा आढावा घेतला गेला."
    r = run(text)
    assert r.decision == "needs_review"
    e = r.evidence[0]
    assert text[e.start:e.end] == "दुष्काळ"


def test_english_whole_word_wildcard_hashtag_and_exclusion():
    assert run("A droughtless region report with many words here").decision == "no_match"
    r = run("Water tankers deployed in drought areas #DroughtRelief")
    kinds = sorted(e.kind for e in r.evidence)
    assert r.decision == "match" and kinds == ["hashtag", "keyword", "keyword"]
    ex = run("What a drought of goals in the match tonight, drought relief for fans")
    assert ex.decision == "no_match" and any(e.kind == "exclusion" for e in ex.evidence)


def test_hindi_and_zero_width_joiners():
    assert run("राज्य में सूखा की स्थिति पर बैठक हुई और राहत कार्य").decision == "needs_review"
    zwj = "दुष्‍काळ आणि टंचाई निवारण आढावा बैठक झाली"
    r = run(zwj)
    assert r.decision == "match"
    e = next(x for x in r.evidence if x.term == "दुष्काळ")
    assert zwj[e.start:e.end] == "दुष्‍काळ"  # offsets point into the untouched original


def test_insufficient_text_is_flagged_not_rejected():
    r = run("📸", has_media=True)
    assert r.decision == "insufficient_text" and "not analysed" in r.reasons[0]
    assert run("रस्ते विकास प्रकल्पाचे आज मुख्यमंत्र्यांच्या हस्ते उद्घाटन झाले").decision == "no_match"


def _pub(session, accounts, pid="p1", text="दुष्काळ टंचाई आढावा बैठक"):
    acc = accounts["x"]
    p = Publication(platform="x", platform_post_id=pid, provider="t", account_id=acc.id, office_code=acc.office_code,
                    url="u", published_at_utc=datetime(2026, 10, 12, 5), reporting_date=date(2026, 10, 12),
                    text=text, metrics={}, media=[], attributes={}, provenance=[])
    session.add(p)
    session.flush()
    return p


def test_manual_override_is_audited_and_survives_reclassification(session, campaign, accounts):
    p = _pub(session, accounts)
    cls = classify_publication(session, p, campaign)
    assert cls.auto_decision == "match" and cls.effective_decision == "include"
    set_manual_decision(session, cls, "exclude", "alice", note="duplicate of district post")
    assert cls.effective_decision == "exclude" and cls.manual_by == "alice"
    campaign.version += 1
    classify_period(session, campaign, date(2026, 10, 12), date(2026, 10, 12))
    cls = session.scalar(select(Classification).where(Classification.publication_id == p.id))
    assert cls.manual_decision == "exclude" and cls.rules_version == campaign.version
    log = session.scalars(select(AuditLog).where(AuditLog.action == "classification.override")).all()
    assert log and log[-1].actor == "alice" and log[-1].after["manual_decision"] == "exclude"
    set_manual_decision(session, cls, None, "bob")
    assert cls.effective_decision == "include"
    with pytest.raises(ValueError):
        set_manual_decision(session, cls, "maybe", "bob")


def test_count_rules_are_explicit():
    base = dict(platform="x", is_repost=False, is_reply=False, is_quote=False, content_type="text", is_short=None,
                attributes={})
    assert countable(SimpleNamespace(**base), {})[0]
    assert not countable(SimpleNamespace(**{**base, "is_repost": True}), {})[0]
    assert countable(SimpleNamespace(**{**base, "is_repost": True}), {"include_reposts": True})[0]
    assert not countable(SimpleNamespace(**{**base, "is_reply": True}), {})[0]
    yt = {**base, "platform": "youtube", "content_type": "video", "attributes": {"possible_short": True}}
    assert countable(SimpleNamespace(**yt), {})[0]
    ok, why = countable(SimpleNamespace(**yt), {"include_shorts": False})
    assert not ok and "possible Short" in why
    assert not countable(SimpleNamespace(**{**base, "platform": "youtube", "content_type": "upcoming_live"}), {})[0]
