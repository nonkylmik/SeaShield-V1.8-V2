from __future__ import annotations

from datetime import datetime

from sqlalchemy import Select, delete, select, update
from sqlalchemy.orm import Session

from db.models import EventAcknowledgementRecord, SecurityEventRecord


def create_event_record(
    db: Session,
    *,
    event_id: str,
    timestamp: datetime,
    vessel_id: str,
    event_type: str,
    category: str,
    severity: str,
    source: str,
    description: str,
    status: str = "OPEN",
    title: str | None = None,
    confidence: float | None = None,
    scenario: str | None = None,
    metadata: dict | None = None,
) -> SecurityEventRecord:
    existing = get_event_record(db, event_id)
    if existing is not None:
        return existing
    record = SecurityEventRecord(
        event_id=event_id,
        timestamp=timestamp,
        vessel_id=vessel_id,
        event_type=event_type,
        category=category,
        severity=severity,
        source=source,
        description=description,
        status=status,
        title=title,
        confidence=confidence,
        scenario=scenario,
        event_metadata=metadata or {},
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def list_event_records(
    db: Session,
    *,
    limit: int = 50,
    offset: int = 0,
    severity: str | None = None,
    event_type: str | None = None,
    status: str | None = None,
    scenario: str | None = None,
    vessel_id: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
) -> list[SecurityEventRecord]:
    query: Select[tuple[SecurityEventRecord]] = select(SecurityEventRecord).order_by(SecurityEventRecord.timestamp.desc()).limit(limit).offset(offset)
    if severity:
        query = query.where(SecurityEventRecord.severity == severity)
    if event_type:
        query = query.where(SecurityEventRecord.event_type == event_type)
    if status:
        query = query.where(SecurityEventRecord.status == status)
    if scenario:
        query = query.where(SecurityEventRecord.scenario == scenario)
    if vessel_id:
        query = query.where(SecurityEventRecord.vessel_id == vessel_id)
    if start:
        query = query.where(SecurityEventRecord.timestamp >= start)
    if end:
        query = query.where(SecurityEventRecord.timestamp <= end)
    return list(db.scalars(query).all())


def get_event_record(db: Session, event_id: str) -> SecurityEventRecord | None:
    return db.scalar(select(SecurityEventRecord).where(SecurityEventRecord.event_id == event_id))


def delete_event_record(db: Session, event_id: str) -> bool:
    result = db.execute(delete(SecurityEventRecord).where(SecurityEventRecord.event_id == event_id))
    db.commit()
    return result.rowcount > 0


def set_event_status(db: Session, event_ids: list[str], status: str) -> int:
    if not event_ids:
        return 0
    result = db.execute(update(SecurityEventRecord).where(SecurityEventRecord.event_id.in_(event_ids)).values(status=status))
    db.commit()
    return result.rowcount


def resolve_all_open_events(db: Session) -> int:
    result = db.execute(update(SecurityEventRecord).where(SecurityEventRecord.status != "RESOLVED").values(status="RESOLVED"))
    db.commit()
    return result.rowcount


def acknowledge_event(db: Session, event_id: str, acknowledged_by: str = "") -> bool:
    if get_event_record(db, event_id) is None:
        return False
    existing = db.scalar(select(EventAcknowledgementRecord).where(EventAcknowledgementRecord.event_id == event_id))
    if existing is not None:
        existing.acknowledged_by = acknowledged_by
        existing.acknowledged_at = datetime.now(timezone.utc)
        db.commit()
        return True
    db.add(EventAcknowledgementRecord(event_id=event_id, acknowledged_by=acknowledged_by))
    db.commit()
    return True


def acknowledged_event_ids(db: Session, event_ids: list[str]) -> set[str]:
    if not event_ids:
        return set()
    rows = db.scalars(select(EventAcknowledgementRecord.event_id).where(EventAcknowledgementRecord.event_id.in_(event_ids))).all()
    return set(rows)
