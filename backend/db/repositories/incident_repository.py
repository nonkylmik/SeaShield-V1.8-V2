from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import IncidentEventLink, IncidentRecord


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


def get_related_event_ids(db: Session, incident_id: str) -> list[str]:
    rows = db.scalars(select(IncidentEventLink.event_id).where(IncidentEventLink.incident_id == incident_id)).all()
    return list(rows)
