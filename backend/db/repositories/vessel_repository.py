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
        status=record.status,
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
        record.last_communication = last_communication or datetime.now(timezone.utc)
        record.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    return record


def get_vessel_record(db: Session, vessel_id: str) -> VesselRecord | None:
    return db.scalar(select(VesselRecord).where(VesselRecord.vessel_id == vessel_id))


def list_vessel_records(db: Session) -> list[VesselRecord]:
    return list(db.scalars(select(VesselRecord).order_by(VesselRecord.name)).all())
