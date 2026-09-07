from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import SecurityScoreHistory


def append_security_score(
    db: Session,
    *,
    vessel_id: str,
    score: int,
    previous_score: int | None = None,
    reason: str | None = None,
    timestamp: datetime | None = None,
) -> SecurityScoreHistory:
    record = SecurityScoreHistory(
        vessel_id=vessel_id,
        score=score,
        previous_score=previous_score,
        reason=reason or "simulation_update",
        timestamp=timestamp or datetime.now(timezone.utc),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def list_security_score_history(db: Session, vessel_id: str | None = None) -> list[SecurityScoreHistory]:
    query = select(SecurityScoreHistory)
    if vessel_id:
        query = query.where(SecurityScoreHistory.vessel_id == vessel_id)
    query = query.order_by(SecurityScoreHistory.timestamp.desc())
    return list(db.scalars(query).all())
