"""Applies classifiers to stored publications and records manual review decisions (audited)."""
from __future__ import annotations

from datetime import date
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.classification.base import ClassificationInput, Classifier
from app.classification.keyword import KeywordClassifier
from app.models import Campaign, Classification, Publication
from app.timeutil import utcnow

CLASSIFIERS: dict[str, Classifier] = {"keyword": KeywordClassifier()}


def get_classifier(name: str = "keyword") -> Classifier:
    return CLASSIFIERS[name]


def _input(pub: Publication) -> ClassificationInput:
    return ClassificationInput(title=pub.title or "", text=pub.text or "", description=pub.description or "",
                               content_type=pub.content_type, has_media=bool(pub.media))


def classify_publication(session: Session, pub: Publication, campaign: Campaign,
                         classifier: Optional[Classifier] = None) -> Classification:
    """(Re)compute the automatic decision. Manual decisions and tags are preserved."""
    classifier = classifier or get_classifier()
    result = classifier.classify(_input(pub), campaign.rules or {})
    row = session.scalar(select(Classification).where(Classification.publication_id == pub.id,
                                                      Classification.campaign_id == campaign.id))
    if row is None:
        row = Classification(publication_id=pub.id, campaign_id=campaign.id, auto_decision=result.decision,
                             classifier=classifier.name, classifier_version=classifier.version,
                             rules_version=campaign.version)
        session.add(row)
    row.auto_decision = result.decision
    row.auto_score = result.score
    row.auto_evidence = result.evidence_dict()
    row.classifier = classifier.name
    row.classifier_version = classifier.version
    row.rules_version = campaign.version
    row.classified_at = utcnow()
    return row


def classify_period(session: Session, campaign: Campaign, start: date, end: date,
                    only_stale: bool = False) -> int:
    pubs = session.scalars(select(Publication).where(Publication.reporting_date >= start,
                                                     Publication.reporting_date <= end)).all()
    n = 0
    for pub in pubs:
        if only_stale:
            existing = session.scalar(select(Classification).where(Classification.publication_id == pub.id,
                                                                   Classification.campaign_id == campaign.id))
            if existing and existing.rules_version == campaign.version:
                continue
        classify_publication(session, pub, campaign)
        n += 1
    return n


def set_manual_decision(session: Session, cls: Classification, decision: Optional[str], actor: str,
                        note: str = "", report_tag: Optional[str] = "__keep__") -> Classification:
    if decision not in (None, "include", "exclude"):
        raise ValueError("decision must be include, exclude or None (reset)")
    if report_tag not in ("__keep__", None, "video_bite", "video_interview"):
        raise ValueError("invalid report tag")
    before = {"manual_decision": cls.manual_decision, "report_tag": cls.report_tag, "note": cls.manual_note}
    cls.manual_decision = decision
    cls.manual_note = note or ""
    cls.manual_by = actor if decision else None
    cls.manual_at = utcnow() if decision else None
    if report_tag != "__keep__":
        cls.report_tag = report_tag
    audit.record(session, actor, "classification.override" if decision else "classification.reset",
                 "classification", cls.id, before=before,
                 after={"manual_decision": cls.manual_decision, "report_tag": cls.report_tag, "note": cls.manual_note},
                 note=note)
    return cls


def accept_auto_matches(session: Session, rows: Iterable[Classification], actor: str) -> int:
    """Bulk-confirm proposed matches as reviewed inclusions (each one audited)."""
    n = 0
    for row in rows:
        if row.manual_decision is None and row.auto_decision == "match":
            set_manual_decision(session, row, "include", actor, note="bulk-accepted proposed match")
            n += 1
    return n
