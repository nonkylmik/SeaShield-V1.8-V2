from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import SafetyCheckpointRecord, SafetyFindingRecord, SafetyRoundRecord

ROUND_TEMPLATE_MAP: dict[str, list[str]] = {
    "port-security": ["Gate Access", "CCTV Check", "Lock Integrity"],
    "fire-safety": ["Fire Extinguisher", "Alarm Panel", "Emergency Exit"],
    "navigation": ["Bridge Check", "AIS Health", "Radar Calibration"],
}

VALID_STATUSES = {"PASS", "WARNING", "FAIL", "NOT_APPLICABLE", "NOT_CHECKED"}
VALID_SEVERITIES = {"INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"}
OPEN_ROUND_STATUSES = {"PLANNED", "IN_PROGRESS", "OVERDUE"}
STARTABLE_ROUND_STATUSES = {"PLANNED", "OVERDUE"}


class InvalidRoundTransition(ValueError):
    pass


def _require_status(record: SafetyRoundRecord, allowed: set[str], action: str) -> None:
    if record.status not in allowed:
        raise InvalidRoundTransition(f"Cannot {action} safety round {record.round_id} in status {record.status}.")


def generate_round_id(db: Session) -> str:
    return f"SR-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid4().hex[:8]}"


def get_safety_round(db: Session, round_id: str) -> SafetyRoundRecord | None:
    return db.scalar(select(SafetyRoundRecord).where(SafetyRoundRecord.round_id == round_id))


def list_safety_rounds(db: Session, vessel_id: str | None = None) -> list[SafetyRoundRecord]:
    query = select(SafetyRoundRecord)
    if vessel_id:
        query = query.where(SafetyRoundRecord.vessel_id == vessel_id)
    query = query.order_by(SafetyRoundRecord.created_at.desc())
    return list(db.scalars(query).all())


def create_safety_round(db: Session, *, vessel_id: str, title: str, description: str = "", assigned_to: str = "Operator") -> SafetyRoundRecord:
    round_id = generate_round_id(db)
    record = SafetyRoundRecord(
        round_id=round_id,
        vessel_id=vessel_id,
        title=title,
        description=description,
        assigned_to=assigned_to,
        status="PLANNED",
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    template = ROUND_TEMPLATE_MAP.get(title.lower().replace(" ", "-") or "port-security", ["Gate Access", "CCTV Check", "Lock Integrity"])
    for idx, name in enumerate(template):
        checkpoint = SafetyCheckpointRecord(
            checkpoint_id=f"CP-{round_id}-{idx + 1}",
            round_id=round_id,
            name=name,
            description=f"Checkpoint for {title}",
            location="Main Deck",
            required=True,
            status="NOT_CHECKED",
            severity="INFO",
        )
        db.add(checkpoint)
    db.commit()
    return record


def start_safety_round(db: Session, round_id: str) -> SafetyRoundRecord | None:
    record = get_safety_round(db, round_id)
    if record is None:
        return None
    _require_status(record, STARTABLE_ROUND_STATUSES, "start")
    record.status = "IN_PROGRESS"
    record.started_at = record.started_at or datetime.now(timezone.utc)
    record.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    return record


def complete_safety_round(db: Session, round_id: str) -> SafetyRoundRecord | None:
    record = get_safety_round(db, round_id)
    if record is None:
        return None
    _require_status(record, OPEN_ROUND_STATUSES, "complete")
    checkpoints = list_safety_checkpoints(db, round_id)
    pending = [c for c in checkpoints if c.required and c.status not in {"PASS", "WARNING", "FAIL", "NOT_APPLICABLE"}]
    if pending:
        raise ValueError("Cannot complete a safety round while required checkpoints are still unchecked.")
    record.status = "COMPLETED"
    record.completed_at = datetime.now(timezone.utc)
    record.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    return record


def cancel_safety_round(db: Session, round_id: str) -> SafetyRoundRecord | None:
    record = get_safety_round(db, round_id)
    if record is None:
        return None
    _require_status(record, OPEN_ROUND_STATUSES, "cancel")
    record.status = "CANCELLED"
    record.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    return record


def get_safety_checkpoint(db: Session, round_id: str, checkpoint_id: str) -> SafetyCheckpointRecord | None:
    return db.scalar(select(SafetyCheckpointRecord).where(SafetyCheckpointRecord.round_id == round_id, SafetyCheckpointRecord.checkpoint_id == checkpoint_id))


def list_safety_checkpoints(db: Session, round_id: str) -> list[SafetyCheckpointRecord]:
    return list(db.scalars(select(SafetyCheckpointRecord).where(SafetyCheckpointRecord.round_id == round_id).order_by(SafetyCheckpointRecord.id.asc())).all())


def update_safety_checkpoint(
    db: Session,
    *,
    round_id: str,
    checkpoint_id: str,
    status: str,
    severity: str,
    notes: str | None = None,
    completed_by: str | None = None,
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
    checkpoint.notes = notes if notes is not None else checkpoint.notes
    checkpoint.completed_by = completed_by if completed_by is not None else checkpoint.completed_by
    checkpoint.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(checkpoint)
    return checkpoint


def create_safety_finding(
    db: Session,
    *,
    round_id: str,
    vessel_id: str,
    title: str,
    description: str,
    severity: str,
    created_by: str = "Operator",
    assigned_to: str = "Operator",
    checkpoint_id: str | None = None,
) -> SafetyFindingRecord:
    existing = db.scalar(select(SafetyFindingRecord).where(SafetyFindingRecord.round_id == round_id, SafetyFindingRecord.checkpoint_id == checkpoint_id, SafetyFindingRecord.title == title))
    if existing is not None:
        return existing
    record = SafetyFindingRecord(
        finding_id=f"SF-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid4().hex[:8]}",
        round_id=round_id,
        checkpoint_id=checkpoint_id,
        vessel_id=vessel_id,
        title=title,
        description=description,
        severity=severity.upper(),
        created_by=created_by,
        assigned_to=assigned_to,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def update_safety_finding(db: Session, finding_id: str, *, status: str | None = None, severity: str | None = None, notes: str | None = None) -> SafetyFindingRecord | None:
    record = db.scalar(select(SafetyFindingRecord).where(SafetyFindingRecord.finding_id == finding_id))
    if record is None:
        return None
    if status is not None:
        record.status = status.upper()
    if severity is not None:
        record.severity = severity.upper()
    if notes is not None:
        record.description = notes
    record.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    return record
