from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field

from models.events import Severity


class IncidentStatus(str, Enum):
    NEW = "NEW"
    INVESTIGATING = "INVESTIGATING"
    CONTAINED = "CONTAINED"
    RESOLVED = "RESOLVED"
    FALSE_POSITIVE = "FALSE POSITIVE"


class Incident(BaseModel):
    incident_id: str
    vessel_id: str
    type: str
    title: str
    severity: Severity
    status: IncidentStatus = IncidentStatus.NEW
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    description: str
    related_event_ids: list[str] = Field(default_factory=list)
    affected_systems: list[str] = Field(default_factory=list)
    assigned_operator: str = "J. Dawson"
    investigation_notes: str = ""
    recommended_action: str = "Review related events and confirm containment."


class IncidentUpdate(BaseModel):
    status: IncidentStatus
    investigation_notes: str = ""
