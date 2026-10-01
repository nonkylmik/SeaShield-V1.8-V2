from __future__ import annotations

from enum import Enum

from pydantic import BaseModel


class SafetyRoundStatus(str, Enum):
    PLANNED = "PLANNED"
    IN_PROGRESS = "IN_PROGRESS"
    OVERDUE = "OVERDUE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


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


class SafetyRoundCreate(BaseModel):
    vessel_id: str
    title: str = "Daily Safety Round"
    description: str = ""
    assigned_to: str = "Operator"


class SafetyCheckpointUpdate(BaseModel):
    status: SafetyCheckpointStatus
    severity: SafetySeverity = SafetySeverity.INFO
    notes: str | None = None
    completed_by: str | None = None


class SafetyCheckpointPatch(BaseModel):
    status: SafetyCheckpointStatus | None = None
    severity: SafetySeverity | None = None
    notes: str | None = None
    completed_by: str | None = None


class SafetyFindingCreate(BaseModel):
    round_id: str
    checkpoint_id: str | None = None
    vessel_id: str
    title: str
    description: str
    severity: SafetySeverity = SafetySeverity.MEDIUM
    created_by: str = "Operator"
    assigned_to: str = "Operator"


class SafetyFindingUpdate(BaseModel):
    status: str | None = None
    severity: SafetySeverity | None = None
    notes: str | None = None
