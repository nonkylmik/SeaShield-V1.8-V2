from datetime import datetime, timezone
from typing import Any

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from db.database import Base


class SecurityEventRecord(Base):
    __tablename__ = "security_events"
    __table_args__ = {"extend_existing": True}
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    event_type: Mapped[str] = mapped_column(String(100), index=True)
    category: Mapped[str] = mapped_column(String(30), index=True)
    severity: Mapped[str] = mapped_column(String(20), index=True)
    source: Mapped[str] = mapped_column(String(160))
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="OPEN")
    confidence: Mapped[float | None] = mapped_column(nullable=True)
    scenario: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    vessel_id: Mapped[str] = mapped_column(String(100), index=True)
    event_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSON().with_variant(JSONB, "postgresql"), default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class VesselRecord(Base):
    __tablename__ = "vessels"
    __table_args__ = {"extend_existing": True}
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vessel_id: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    imo: Mapped[str] = mapped_column(String(100), nullable=False)
    base_score: Mapped[int] = mapped_column(Integer, default=100)
    score: Mapped[int] = mapped_column(Integer, default=100)
    status: Mapped[str] = mapped_column(String(30), default="SECURE")
    last_communication: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class IncidentRecord(Base):
    __tablename__ = "incidents"
    __table_args__ = {"extend_existing": True}
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    incident_id: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    vessel_id: Mapped[str] = mapped_column(String(100), index=True)
    type: Mapped[str] = mapped_column(String(160), index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), index=True)
    status: Mapped[str] = mapped_column(String(30), default="NEW", index=True)
    description: Mapped[str] = mapped_column(Text)
    assigned_operator: Mapped[str] = mapped_column(String(160), default="J. Dawson")
    investigation_notes: Mapped[str] = mapped_column(Text, default="")
    recommended_action: Mapped[str] = mapped_column(Text, default="Review related events and confirm containment.")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class IncidentEventLink(Base):
    __tablename__ = "incident_event_links"
    __table_args__ = {"extend_existing": True}
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    incident_id: Mapped[str] = mapped_column(String(100), ForeignKey("incidents.incident_id"), index=True)
    event_id: Mapped[str] = mapped_column(String(100), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    __table_args__ = (sa.UniqueConstraint("incident_id", "event_id", name="uq_incident_event_link"),)


class SecurityScoreHistory(Base):
    __tablename__ = "security_score_history"
    __table_args__ = {"extend_existing": True}
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vessel_id: Mapped[str] = mapped_column(String(100), index=True)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    previous_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class SimulationRunRecord(Base):
    __tablename__ = "simulation_runs"
    __table_args__ = {"extend_existing": True}
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scenario: Mapped[str] = mapped_column(String(100), index=True)
    vessel_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="RUNNING", index=True)
    run_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSON().with_variant(JSONB, "postgresql"), default=dict)
