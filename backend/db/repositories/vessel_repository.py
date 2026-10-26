from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import VesselRecord
from models.events import Vessel


def to_vessel_model(record: VesselRecord) -> Vessel:
    return Vessel(
        id=record.vessel_id,
        name=record.name,
        imo=record.imo,
        base_score=record.base_score,
        score=record.score,
        last_communication=record.last_communication or datetime.now(timezone.utc),
    )


def upsert_vessel_record(
    db: Session,
    *,
    vessel_id: str,
    name: str,
    imo: str,
    base_score: int,
    score: int,
    status: str = "SECURE",
    last_communication: datetime | None = None,
    commit: bool = True,
) -> VesselRecord:
    record = db.scalar(select(VesselRecord).where(VesselRecord.vessel_id == vessel_id))
    if record is None:
        record = VesselRecord(
            vessel_id=vessel_id,
            name=name,
            imo=imo,
            base_score=base_score,
            score=score,
            status=status,
            last_communication=last_communication or datetime.now(timezone.utc),
        )
        db.add(record)
    else:
        record.name = name
        record.imo = imo
        record.base_score = base_score
        record.score = score
        record.status = status
        # Score and status updates are not communication: only an explicit timestamp changes it.
        if last_communication is not None:
            record.last_communication = last_communication
        record.updated_at = datetime.now(timezone.utc)
    if commit:
        db.commit()
        db.refresh(record)
    else:
        db.flush()
    return record


def _as_utc(value: datetime) -> datetime:
    # SQLite returns stored timestamps without a zone; they are stored in UTC.
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def record_vessel_communication(db: Session, vessel_id: str, at: datetime, *, commit: bool = True) -> VesselRecord | None:
    """Record that a security event from the vessel arrived at `at`.

    The timestamp only moves forward (a backfilled event never rewinds it) and is clamped to the current time (a
    future-dated event cannot make the vessel look fresher). Unknown vessels are ignored.
    """
    record = get_vessel_record(db, vessel_id)
    if record is None:
        return None
    at = min(_as_utc(at), datetime.now(timezone.utc))
    if record.last_communication is None or at > _as_utc(record.last_communication):
        record.last_communication = at
    if commit:
        db.commit()
        db.refresh(record)
    else:
        db.flush()
    return record


def get_vessel_record(db: Session, vessel_id: str) -> VesselRecord | None:
    return db.scalar(select(VesselRecord).where(VesselRecord.vessel_id == vessel_id))


def list_vessel_records(db: Session) -> list[VesselRecord]:
    return list(db.scalars(select(VesselRecord).order_by(VesselRecord.name)).all())
