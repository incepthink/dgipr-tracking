"""Classification interface.

A classifier receives the publication's own text fields and the campaign rules and returns a
decision with evidence. Only the keyword classifier is implemented. Semantic classification,
image OCR and audio/video transcription are NOT implemented; they can be added as further
`Classifier` implementations (e.g. one that first derives text from media) and registered in
app/classification/service.py. Nothing here downloads media or calls an AI model.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

DECISIONS = ("match", "no_match", "needs_review", "insufficient_text")


@dataclass
class Evidence:
    term: str
    kind: str          # keyword | phrase | hashtag | exclusion
    lang: str          # mr | hi | en | any
    field: str         # title | text | description
    start: int
    end: int
    snippet: str

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


@dataclass
class ClassificationInput:
    title: str = ""
    text: str = ""
    description: str = ""
    content_type: str = "post"
    has_media: bool = False


@dataclass
class ClassificationResult:
    decision: str
    score: float
    evidence: list[Evidence] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)

    def evidence_dict(self) -> dict[str, Any]:
        return {"matches": [e.as_dict() for e in self.evidence], "reasons": self.reasons}


class Classifier(Protocol):
    name: str
    version: str

    def classify(self, item: ClassificationInput, rules: dict[str, Any]) -> ClassificationResult: ...
