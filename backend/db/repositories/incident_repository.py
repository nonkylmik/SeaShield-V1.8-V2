from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from db.models import IncidentActivityRecord, IncidentEventLink, IncidentNoteRecord, IncidentRecord, SecurityEventRecord


class MissingIncidentEvidence(LookupError):
    """Raised when an incident would be linked to security events that do not exist."""


def _require_linked_events(db: Session, event_ids: list[str]) -> None:
    # Runs after the link rows are flushed, i.e. while this transaction holds the database write lock, so an
    # event deletion cannot commit between this check and the commit of the links.
    if not event_ids:
        return
    found = set(db.scalars(select(SecurityEventRecord.event_id).where(SecurityEventRecord.event_id.in_(event_ids))).all())
    missing = [event_id for event_id in event_ids if event_id not in found]
    if missing:
        db.rollback()
        raise MissingIncidentEvidence(f"Cannot link missing security events: {', '.join(missing)}")


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
        new_event_ids = []
        for event_id in dict.fromkeys(related_event_ids or []):
            if not db.scalar(select(IncidentEventLink).where(IncidentEventLink.incident_id == incident_id, IncidentEventLink.event_id == event_id)):
                db.add(IncidentEventLink(incident_id=incident_id, event_id=event_id))
                new_event_ids.append(event_id)
        db.flush()
        _require_linked_events(db, new_event_ids)
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
    event_ids = list(dict.fromkeys(related_event_ids or []))
    for event_id in event_ids:
        db.add(IncidentEventLink(incident_id=incident_id, event_id=event_id))
    db.flush()
    _require_linked_events(db, event_ids)
    db.commit()
    db.refresh(record)
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


def linked_incident_ids_by_event(db: Session, event_ids: list[str]) -> dict[str, list[str]]:
    if not event_ids:
        return {}
    links: dict[str, list[str]] = {}
    rows = db.execute(select(IncidentEventLink.event_id, IncidentEventLink.incident_id).where(IncidentEventLink.event_id.in_(event_ids)).order_by(IncidentEventLink.incident_id)).all()
    for event_id, incident_id in rows:
        links.setdefault(event_id, []).append(incident_id)
    return links


def get_linked_incident_ids(db: Session, event_id: str) -> list[str]:
    rows = db.scalars(select(IncidentEventLink.incident_id).where(IncidentEventLink.event_id == event_id).order_by(IncidentEventLink.incident_id)).all()
    return list(dict.fromkeys(rows))


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


OPEN_INCIDENT_STATUSES = ("NEW", "INVESTIGATING", "CONTAINED")


def close_open_incident_records(db: Session, *, status: str, reason: str, actor: str, commit: bool = True) -> int:
    """Close incidents that are still open and record each closure in the activity timeline.

    Closed incidents (RESOLVED, FALSE POSITIVE) are left untouched, and investigation notes are never modified.
    """
    records = list(db.scalars(select(IncidentRecord).where(IncidentRecord.status.in_(OPEN_INCIDENT_STATUSES))).all())
    now = datetime.now(timezone.utc)
    for record in records:
        db.add(IncidentActivityRecord(incident_id=record.incident_id, text=f"{reason}: status {record.status} → {status}.", actor=actor))
        record.status = status
        record.updated_at = now
    if commit:
        db.commit()
    else:
        db.flush()
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
