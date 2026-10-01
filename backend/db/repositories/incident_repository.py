from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from db.models import IncidentActivityRecord, IncidentEventLink, IncidentNoteRecord, IncidentRecord


def create_incident_record(
    db: Session,
    *,
    incident_id: str,
    vessel_id: str,
    type: str,
    title: str,
    severity: str,
    description: str,
    status: str = "NEW",
    assigned_operator: str = "J. Dawson",
    investigation_notes: str = "",
    recommended_action: str = "Review related events and confirm containment.",
    related_event_ids: list[str] | None = None,
    created_at: datetime | None = None,
) -> IncidentRecord:
    existing = get_incident_record(db, incident_id)
    if existing is not None:
        for event_id in related_event_ids or []:
            if not db.scalar(select(IncidentEventLink).where(IncidentEventLink.incident_id == incident_id, IncidentEventLink.event_id == event_id)):
                db.add(IncidentEventLink(incident_id=incident_id, event_id=event_id))
        db.commit()
        return existing
    record = IncidentRecord(
        incident_id=incident_id,
        vessel_id=vessel_id,
        type=type,
        title=title,
        severity=severity,
        status=status,
        description=description,
        assigned_operator=assigned_operator,
        investigation_notes=investigation_notes,
        recommended_action=recommended_action,
        created_at=created_at or datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    for event_id in related_event_ids or []:
        db.add(IncidentEventLink(incident_id=incident_id, event_id=event_id))
    db.commit()
    return record


def get_incident_record(db: Session, incident_id: str) -> IncidentRecord | None:
    return db.scalar(select(IncidentRecord).where(IncidentRecord.incident_id == incident_id))


def list_incident_records(db: Session, vessel_id: str | None = None) -> list[IncidentRecord]:
    query = select(IncidentRecord)
    if vessel_id:
        query = query.where(IncidentRecord.vessel_id == vessel_id)
    query = query.order_by(IncidentRecord.created_at.desc())
    return list(db.scalars(query).all())


def next_incident_id(db: Session) -> str:
    numbers = []
    for incident in db.scalars(select(IncidentRecord.incident_id)).all():
        suffix = incident.rsplit("-", 1)[-1]
        if suffix.isdigit():
            numbers.append(int(suffix))
    return f"INC-{max([240, *numbers]) + 1:04d}"


def get_related_event_ids(db: Session, incident_id: str) -> list[str]:
    rows = db.scalars(select(IncidentEventLink.event_id).where(IncidentEventLink.incident_id == incident_id)).all()
    return list(rows)


def update_incident_record(
    db: Session,
    incident_id: str,
    *,
    status: str | None = None,
    investigation_notes: str | None = None,
    assigned_operator: str | None = None,
    severity: str | None = None,
) -> IncidentRecord | None:
    record = get_incident_record(db, incident_id)
    if record is None:
        return None
    if status is not None:
        record.status = status
    if investigation_notes is not None:
        record.investigation_notes = investigation_notes
    if assigned_operator is not None:
        record.assigned_operator = assigned_operator
    if severity is not None:
        record.severity = severity
    record.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    return record


def close_open_incident_records(db: Session, *, status: str, note: str) -> int:
    records = list(db.scalars(select(IncidentRecord).where(IncidentRecord.status != "RESOLVED")).all())
    for record in records:
        record.status = status
        record.investigation_notes = note
        record.updated_at = datetime.now(timezone.utc)
    db.commit()
    return len(records)


def add_incident_note(db: Session, incident_id: str, *, author: str, body: str) -> IncidentNoteRecord:
    note = IncidentNoteRecord(note_id=f"NOTE-{uuid4().hex}", incident_id=incident_id, author=author, body=body)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


def list_incident_notes(db: Session, incident_id: str) -> list[IncidentNoteRecord]:
    return list(db.scalars(select(IncidentNoteRecord).where(IncidentNoteRecord.incident_id == incident_id).order_by(IncidentNoteRecord.created_at.asc())).all())


def add_incident_activity(db: Session, incident_id: str, text: str, *, actor: str | None = None) -> IncidentActivityRecord:
    activity = IncidentActivityRecord(incident_id=incident_id, text=text, actor=actor)
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return activity


def list_incident_activity(db: Session, incident_id: str) -> list[IncidentActivityRecord]:
    return list(db.scalars(select(IncidentActivityRecord).where(IncidentActivityRecord.incident_id == incident_id).order_by(IncidentActivityRecord.created_at.asc())).all())


def update_incident_fields(db: Session, incident_id: str, **fields: object) -> IncidentRecord | None:
    record = get_incident_record(db, incident_id)
    if record is None:
        return None
    for key, value in fields.items():
        if value is None:
            continue
        setattr(record, key, value)
    record.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    return record
