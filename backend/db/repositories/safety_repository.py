from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import SafetyCheckpointRecord, SafetyFindingRecord, SafetyRoundRecord

ROUND_TEMPLATE_MAP: dict[str, list[str]] = {
    "port-security": ["Gate Access", "CCTV Check", "Lock Integrity"],
    "fire-safety": ["Fire Extinguisher", "Alarm Panel", "Emergency Exit"],
    "navigation": ["Bridge Check", "AIS Health", "Radar Calibration"],
    "General Safety Round": [
        "Emergency exits and access routes",
        "Fire equipment and extinguishers",
        "Emergency lighting and signage",
        "Deck condition and housekeeping",
        "Trip and electrical hazards",
        "Machinery safe operating area",
        "Water and oil leak inspection",
        "General vessel cleanliness",
    ],
    "Security Round": [
        "Restricted access areas",
        "Doors and access control",
        "Unauthorized persons check",
        "CCTV and security alarms",
        "Perimeter lighting",
        "Suspicious activity review",
        "Communication checks",
        "Security boundary verification",
    ],
    "Fire Safety Round": [
        "Fire extinguishers",
        "Fire doors inspection",
        "Fire alarm panel",
        "Smoke detection coverage",
        "Fire hoses and equipment",
        "Escape route clearance",
        "Emergency equipment readiness",
        "Fire station readiness",
    ],
    "Engine Room Round": [
        "Leak inspection",
        "Temperature abnormality check",
        "Machinery condition review",
        "Electrical hazard inspection",
        "Alarm panel review",
        "Bilge condition",
        "Access and housekeeping",
        "Unsafe condition reporting",
    ],
    "Pre-Departure Safety Round": [
        "Emergency exits check",
        "Navigation area readiness",
        "Mooring area condition",
        "Cargo area inspection",
        "Life-saving equipment status",
        "Fire equipment check",
        "Access control verification",
        "Communications readiness",
    ],
    "Evening Safety & Security Round": [
        "Emergency Exit",
        "Fire Extinguisher",
        "CCTV",
        "Restricted Access",
        "Deck Condition",
        "Emergency Lighting",
        "Access Control",
        "Communications",
    ],
}

VALID_STATUSES = {"PASS", "WARNING", "FAIL", "NOT_APPLICABLE", "NOT_CHECKED"}
VALID_SEVERITIES = {"INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"}
VALID_FINDING_STATUSES = {"OPEN", "IN_PROGRESS", "RESOLVED", "DISMISSED"}
OPEN_ROUND_STATUSES = {"PLANNED", "IN_PROGRESS", "OVERDUE"}
STARTABLE_ROUND_STATUSES = {"PLANNED", "OVERDUE"}


class InvalidRoundTransition(ValueError):
    pass


def _require_status(record: SafetyRoundRecord, allowed: set[str], action: str) -> None:
    if record.status not in allowed:
        raise InvalidRoundTransition(
            f"Cannot {action} safety round {record.round_id} in status {record.status}."
        )


def generate_round_id(db: Session, internal_id: int | None = None) -> str:
    stable_id = internal_id
    if stable_id is None:
        stable_id = (db.scalar(select(SafetyRoundRecord.id).order_by(SafetyRoundRecord.id.desc()).limit(1)) or 0) + 1
    return f"SR-{datetime.now(timezone.utc).year}-{stable_id:04d}"


def default_round_template(round_type: str) -> list[dict[str, Any]]:
    names = ROUND_TEMPLATE_MAP.get(
        round_type,
        ROUND_TEMPLATE_MAP.get(round_type.lower().replace(" ", "-"), [
            "General safe condition review",
            "Manning and control readiness",
        ]),
    )
    return [
        {
            "name": name,
            "category": "General",
            "location": "Main Deck",
            "description": name,
            "required": True,
            "status": "NOT_CHECKED",
            "severity": "INFO",
        }
        for name in names
    ]


def list_safety_round_templates() -> list[dict[str, Any]]:
    return [
        {
            "name": name,
            "checkpoints": [
                {
                    "name": checkpoint["name"],
                    "category": checkpoint["category"],
                    "location": checkpoint["location"],
                    "description": checkpoint["description"],
                    "required": checkpoint["required"],
                    "sequence": sequence,
                }
                for sequence, checkpoint in enumerate(default_round_template(name), start=1)
            ],
        }
        for name in ROUND_TEMPLATE_MAP
    ]


def create_safety_round(
    db: Session,
    *,
    vessel_id: str,
    round_type: str,
    assigned_to: str = "Deck Officer",
    planned_start: datetime | None = None,
    notes: str = "",
    template_name: str | None = None,
    title: str | None = None,
    description: str = "",
    commit: bool = True,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    record = SafetyRoundRecord(
        round_id=f"pending-{uuid4().hex}",
        vessel_id=vessel_id,
        title=title or round_type or "General Safety Round",
        description=description or notes,
        round_type=round_type or title or "General Safety Round",
        assigned_to=assigned_to,
        planned_start=planned_start or now,
        notes=notes or description,
        status="PLANNED",
    )
    db.add(record)
    db.flush()
    record.round_id = generate_round_id(db, record.id)
    db.flush()

    for sequence, checkpoint in enumerate(default_round_template(template_name or record.round_type), start=1):
        db.add(
            SafetyCheckpointRecord(
                checkpoint_id=f"{record.round_id}-CP-{sequence:02d}",
                round_id=record.round_id,
                name=checkpoint["name"],
                category=checkpoint["category"],
                location=checkpoint["location"],
                description=checkpoint["description"],
                sequence=sequence,
                required=checkpoint["required"],
                status=checkpoint["status"],
                severity=checkpoint["severity"],
            )
        )
    if commit:
        db.commit()
        db.refresh(record)
    else:
        db.flush()
    return round_response(record, list_safety_checkpoints(db, record.round_id))


def get_safety_round(db: Session, round_id: str) -> SafetyRoundRecord | None:
    return db.scalar(select(SafetyRoundRecord).where(SafetyRoundRecord.round_id == round_id))


def list_safety_rounds(
    db: Session,
    vessel_id: str | None = None,
    status: str | None = None,
    round_type: str | None = None,
    assigned_to: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[SafetyRoundRecord]:
    query = select(SafetyRoundRecord)
    if vessel_id:
        query = query.where(SafetyRoundRecord.vessel_id == vessel_id)
    if status:
        query = query.where(SafetyRoundRecord.status == status)
    if round_type:
        query = query.where(SafetyRoundRecord.round_type == round_type)
    if assigned_to:
        query = query.where(SafetyRoundRecord.assigned_to == assigned_to)
    if start:
        query = query.where(SafetyRoundRecord.planned_start >= start)
    if end:
        query = query.where(SafetyRoundRecord.planned_start <= end)
    query = query.order_by(SafetyRoundRecord.planned_start.desc(), SafetyRoundRecord.id.desc()).limit(limit).offset(offset)
    return list(db.scalars(query).all())


def start_safety_round(db: Session, round_id: str, *, commit: bool = True) -> SafetyRoundRecord | None:
    record = get_safety_round(db, round_id)
    if record is None:
        return None
    _require_status(record, STARTABLE_ROUND_STATUSES, "start")
    record.status = "IN_PROGRESS"
    record.started_at = record.started_at or datetime.now(timezone.utc)
    record.updated_at = datetime.now(timezone.utc)
    if commit:
        db.commit()
        db.refresh(record)
    else:
        db.flush()
    return record


def complete_safety_round(db: Session, round_id: str, *, commit: bool = True) -> SafetyRoundRecord | None:
    record = get_safety_round(db, round_id)
    if record is None:
        return None
    _require_status(record, OPEN_ROUND_STATUSES, "complete")
    pending = [
        checkpoint
        for checkpoint in list_safety_checkpoints(db, round_id)
        if checkpoint.required and checkpoint.status not in {"PASS", "WARNING", "FAIL", "NOT_APPLICABLE"}
    ]
    if pending:
        raise ValueError("Cannot complete a safety round while required checkpoints are still unchecked.")
    record.status = "COMPLETED"
    record.completed_at = datetime.now(timezone.utc)
    record.updated_at = datetime.now(timezone.utc)
    if commit:
        db.commit()
        db.refresh(record)
    else:
        db.flush()
    return record


def cancel_safety_round(db: Session, round_id: str, *, commit: bool = True) -> SafetyRoundRecord | None:
    record = get_safety_round(db, round_id)
    if record is None:
        return None
    _require_status(record, OPEN_ROUND_STATUSES, "cancel")
    record.status = "CANCELLED"
    record.updated_at = datetime.now(timezone.utc)
    if commit:
        db.commit()
        db.refresh(record)
    else:
        db.flush()
    return record


def list_safety_checkpoints(db: Session, round_id: str) -> list[SafetyCheckpointRecord]:
    query = (
        select(SafetyCheckpointRecord)
        .where(SafetyCheckpointRecord.round_id == round_id)
        .order_by(SafetyCheckpointRecord.sequence.asc(), SafetyCheckpointRecord.id.asc())
    )
    return list(db.scalars(query).all())


def get_safety_checkpoint(
    db: Session,
    round_id: str,
    checkpoint_id: str,
) -> SafetyCheckpointRecord | None:
    return db.scalar(
        select(SafetyCheckpointRecord).where(
            SafetyCheckpointRecord.round_id == round_id,
            SafetyCheckpointRecord.checkpoint_id == checkpoint_id,
        )
    )


def update_safety_checkpoint(
    db: Session,
    *,
    round_id: str,
    checkpoint_id: str,
    status: str,
    severity: str = "INFO",
    notes: str | None = None,
    completed_by: str | None = None,
    commit: bool = True,
) -> SafetyCheckpointRecord | None:
    checkpoint = get_safety_checkpoint(db, round_id, checkpoint_id)
    if checkpoint is None:
        return None
    round_record = get_safety_round(db, round_id)
    if round_record is not None:
        _require_status(round_record, OPEN_ROUND_STATUSES, "update checkpoints of")

    normalized_status = status.upper()
    normalized_severity = severity.upper()
    if normalized_status not in VALID_STATUSES:
        raise ValueError(f"Unsupported checkpoint status: {status}")
    if normalized_severity not in VALID_SEVERITIES:
        raise ValueError(f"Unsupported checkpoint severity: {severity}")

    checkpoint.status = normalized_status
    checkpoint.severity = normalized_severity
    if notes is not None:
        checkpoint.notes = notes
    if completed_by is not None:
        checkpoint.completed_by = completed_by
    checkpoint.completed_at = (
        datetime.now(timezone.utc)
        if normalized_status in {"PASS", "WARNING", "FAIL", "NOT_APPLICABLE"}
        else None
    )
    checkpoint.updated_at = datetime.now(timezone.utc)
    if commit:
        db.commit()
        db.refresh(checkpoint)
    else:
        db.flush()
    return checkpoint


def list_safety_findings(
    db: Session,
    round_id: str | None = None,
    vessel_id: str | None = None,
    status: str | None = None,
    severity: str | None = None,
    assigned_to: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[SafetyFindingRecord]:
    query = select(SafetyFindingRecord)
    if round_id:
        query = query.where(SafetyFindingRecord.round_id == round_id)
    if vessel_id:
        query = query.where(SafetyFindingRecord.vessel_id == vessel_id)
    if status:
        query = query.where(SafetyFindingRecord.status == status)
    if severity:
        query = query.where(SafetyFindingRecord.severity == severity)
    if assigned_to:
        query = query.where(SafetyFindingRecord.assigned_to == assigned_to)
    query = query.order_by(SafetyFindingRecord.created_at.desc(), SafetyFindingRecord.id.desc()).limit(limit).offset(offset)
    return list(db.scalars(query).all())


def get_safety_finding(db: Session, finding_id: str) -> SafetyFindingRecord | None:
    return db.scalar(select(SafetyFindingRecord).where(SafetyFindingRecord.finding_id == finding_id))


def create_safety_finding(
    db: Session,
    *,
    round_id: str,
    vessel_id: str,
    title: str,
    description: str,
    severity: str,
    created_by: str = "Operator",
    assigned_to: str | None = None,
    checkpoint_id: str | None = None,
    location: str = "",
    due_date: datetime | None = None,
    resolution_notes: str = "",
    commit: bool = True,
) -> SafetyFindingRecord:
    if checkpoint_id:
        existing = db.scalar(
            select(SafetyFindingRecord).where(
                SafetyFindingRecord.round_id == round_id,
                SafetyFindingRecord.checkpoint_id == checkpoint_id,
                SafetyFindingRecord.status != "RESOLVED",
            )
        )
        if existing is not None:
            return existing

    record = SafetyFindingRecord(
        finding_id=f"SF-{datetime.now(timezone.utc):%Y%m%d%H%M%S}-{uuid4().hex[:8]}",
        round_id=round_id,
        checkpoint_id=checkpoint_id,
        vessel_id=vessel_id,
        title=title,
        description=description,
        location=location,
        severity=severity.upper(),
        status="OPEN",
        created_by=created_by,
        assigned_to=assigned_to or "",
        due_date=due_date,
        resolution_notes=resolution_notes,
    )
    db.add(record)
    if commit:
        db.commit()
        db.refresh(record)
    else:
        db.flush()
    return record


def update_safety_finding(
    db: Session,
    finding_id: str,
    *,
    status: str | None = None,
    severity: str | None = None,
    assigned_to: str | None = None,
    due_date: datetime | None = None,
    clear_due_date: bool = False,
    resolution_notes: str | None = None,
    notes: str | None = None,
    commit: bool = True,
) -> SafetyFindingRecord | None:
    record = get_safety_finding(db, finding_id)
    if record is None:
        return None
    if status is not None:
        normalized_status = status.upper()
        if normalized_status not in VALID_FINDING_STATUSES:
            raise ValueError(f"Unsupported finding status: {status}")
        record.status = normalized_status
        record.resolved_at = datetime.now(timezone.utc) if normalized_status == "RESOLVED" else None
    if severity is not None:
        normalized_severity = severity.upper()
        if normalized_severity not in VALID_SEVERITIES:
            raise ValueError(f"Unsupported finding severity: {severity}")
        record.severity = normalized_severity
    if assigned_to is not None:
        record.assigned_to = assigned_to
    if due_date is not None:
        record.due_date = due_date
    elif clear_due_date:
        record.due_date = None
    if resolution_notes is not None:
        record.resolution_notes = resolution_notes
    if notes is not None:
        record.resolution_notes = notes
    record.updated_at = datetime.now(timezone.utc)
    if commit:
        db.commit()
        db.refresh(record)
    else:
        db.flush()
    return record


def round_response(
    record: SafetyRoundRecord,
    checkpoints: list[SafetyCheckpointRecord] | None = None,
) -> dict[str, Any]:
    return {
        "id": record.id,
        "round_id": record.round_id,
        "vessel_id": record.vessel_id,
        "round_type": record.round_type,
        "status": record.status,
        "assigned_to": record.assigned_to,
        "planned_start": record.planned_start.isoformat() if record.planned_start else None,
        "started_at": record.started_at.isoformat() if record.started_at else None,
        "completed_at": record.completed_at.isoformat() if record.completed_at else None,
        "notes": record.notes,
        "created_at": record.created_at.isoformat(),
        "updated_at": record.updated_at.isoformat(),
        "checkpoints": [
            {
                "id": checkpoint.id,
                "checkpoint_id": checkpoint.checkpoint_id,
                "round_id": checkpoint.round_id,
                "name": checkpoint.name,
                "category": checkpoint.category,
                "location": checkpoint.location,
                "description": checkpoint.description,
                "sequence": checkpoint.sequence,
                "required": checkpoint.required,
                "status": checkpoint.status,
                "severity": checkpoint.severity,
                "notes": checkpoint.notes,
                "completed_at": checkpoint.completed_at.isoformat() if checkpoint.completed_at else None,
                "completed_by": checkpoint.completed_by,
            }
            for checkpoint in checkpoints or []
        ],
    }


def finding_response(record: SafetyFindingRecord) -> dict[str, Any]:
    return {
        "id": record.id,
        "finding_id": record.finding_id,
        "round_id": record.round_id,
        "checkpoint_id": record.checkpoint_id,
        "vessel_id": record.vessel_id,
        "title": record.title,
        "description": record.description,
        "location": record.location,
        "severity": record.severity,
        "status": record.status,
        "created_by": record.created_by,
        "assigned_to": record.assigned_to,
        "due_date": record.due_date.isoformat() if record.due_date else None,
        "resolution_notes": record.resolution_notes,
        "created_at": record.created_at.isoformat(),
        "updated_at": record.updated_at.isoformat(),
        "resolved_at": record.resolved_at.isoformat() if record.resolved_at else None,
    }
