from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


class SafetyRoundStatus(str, Enum):
    PLANNED = "PLANNED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    OVERDUE = "OVERDUE"


class SafetyCheckpointStatus(str, Enum):
    PASS = "PASS"
    WARNING = "WARNING"
    FAIL = "FAIL"
    NOT_APPLICABLE = "NOT_APPLICABLE"
    NOT_CHECKED = "NOT_CHECKED"


class SafetySeverity(str, Enum):
    INFO = "INFO"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class SafetyFindingStatus(str, Enum):
    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    RESOLVED = "RESOLVED"
    DISMISSED = "DISMISSED"


class SafetyRoundTemplate(BaseModel):
    name: str
    category: str
    checkpoints: list[str]


class SafetyRoundCreate(BaseModel):
    vessel_id: str = Field(min_length=1, max_length=100)
    round_type: str = Field(min_length=1, max_length=120)
    assigned_to: str = Field(default="Deck Officer", max_length=160)
    planned_start: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    notes: str = ""
    template_name: str | None = None


class SafetyCheckpointUpdate(BaseModel):
    status: SafetyCheckpointStatus
    severity: SafetySeverity = SafetySeverity.INFO
    notes: str = ""
    completed_by: str | None = None


class SafetyFindingCreate(BaseModel):
    round_id: str
    checkpoint_id: str | None = None
    vessel_id: str
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    location: str = ""
    severity: SafetySeverity = SafetySeverity.MEDIUM
    created_by: str = ""
    assigned_to: str | None = None
    due_date: datetime | None = None
    resolution_notes: str = ""


class SafetyFindingUpdate(BaseModel):
    status: SafetyFindingStatus | None = None
    severity: SafetySeverity | None = None
    assigned_to: str | None = None
    resolution_notes: str | None = None
