from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog


def record(session: Session, actor: str, action: str, entity_type: str, entity_id: Any,
           before: dict[str, Any] | None = None, after: dict[str, Any] | None = None, note: str = "") -> AuditLog:
    entry = AuditLog(actor=actor or "unknown", action=action, entity_type=entity_type, entity_id=str(entity_id),
                     before=before, after=after, note=note or "")
    session.add(entry)
    return entry
