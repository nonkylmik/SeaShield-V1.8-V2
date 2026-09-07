from datetime import datetime

from sqlalchemy import Select, delete, select
from sqlalchemy.orm import Session

from db.models import SecurityEventRecord
from models.events import SecurityEvent


def to_record(event: SecurityEvent, scenario: str | None = None) -> SecurityEventRecord:
    return SecurityEventRecord(
        event_id=event.event_id,
        timestamp=event.timestamp,
        event_type=event.event_type,
        category=event.category.value,
        severity=event.severity.value,
        source=event.source,
        title=event.title,
        description=event.description,
        status=event.status.value,
        confidence=event.confidence,
        scenario=scenario or event.scenario,
        vessel_id=event.vessel_id,
        event_metadata=event.metadata,
    )


def from_record(record: SecurityEventRecord) -> SecurityEvent:
    return SecurityEvent(
        event_id=record.event_id,
        timestamp=record.timestamp,
        vessel_id=record.vessel_id,
        event_type=record.event_type,
        category=record.category,
        severity=record.severity,
        source=record.source,
        title=record.title,
        description=record.description,
        status=record.status,
        confidence=record.confidence,
        scenario=record.scenario,
        metadata=record.event_metadata or {},
    )


def create_event(db: Session, event: SecurityEvent, scenario: str | None = None) -> SecurityEventRecord:
    record = to_record(event, scenario)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def list_events(db: Session, *, limit: int, offset: int, severity: str | None = None, event_type: str | None = None, status: str | None = None, scenario: str | None = None, vessel_id: str | None = None, start: datetime | None = None, end: datetime | None = None) -> list[SecurityEventRecord]:
    query: Select[tuple[SecurityEventRecord]] = select(SecurityEventRecord).order_by(SecurityEventRecord.timestamp.desc()).limit(limit).offset(offset)
    if severity: query = query.where(SecurityEventRecord.severity == severity)
    if event_type: query = query.where(SecurityEventRecord.event_type == event_type)
    if status: query = query.where(SecurityEventRecord.status == status)
    if scenario: query = query.where(SecurityEventRecord.scenario == scenario)
    if vessel_id: query = query.where(SecurityEventRecord.vessel_id == vessel_id)
    if start: query = query.where(SecurityEventRecord.timestamp >= start)
    if end: query = query.where(SecurityEventRecord.timestamp <= end)
    return list(db.scalars(query).all())


def get_event(db: Session, event_id: str) -> SecurityEventRecord | None:
    return db.scalar(select(SecurityEventRecord).where(SecurityEventRecord.event_id == event_id))


def delete_event(db: Session, event_id: str) -> bool:
    result = db.execute(delete(SecurityEventRecord).where(SecurityEventRecord.event_id == event_id))
    db.commit()
    return result.rowcount > 0


def load_events(db: Session) -> list[SecurityEvent]:
    return [from_record(record) for record in list_events(db, limit=10000, offset=0)]
