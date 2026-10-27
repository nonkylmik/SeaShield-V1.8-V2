from datetime import datetime, timezone
from enum import Enum
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

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


class IncidentCreate(BaseModel):
    vessel_id: str
    type: str = "MANUAL"
    title: str
    severity: Severity = Severity.MEDIUM
    description: str = ""
    assigned_operator: str | None = None


class IncidentNoteCreate(BaseModel):
    author: str = "Operator"
    body: str


# Allowed status changes through an ordinary update. RESOLVED and FALSE POSITIVE are closed: they change only
# through the explicit reopen action, which returns the incident to INVESTIGATING.
INCIDENT_TRANSITIONS: dict[IncidentStatus, frozenset[IncidentStatus]] = {
    IncidentStatus.NEW: frozenset({IncidentStatus.INVESTIGATING, IncidentStatus.CONTAINED, IncidentStatus.RESOLVED, IncidentStatus.FALSE_POSITIVE}),
    IncidentStatus.INVESTIGATING: frozenset({IncidentStatus.CONTAINED, IncidentStatus.RESOLVED, IncidentStatus.FALSE_POSITIVE}),
    IncidentStatus.CONTAINED: frozenset({IncidentStatus.INVESTIGATING, IncidentStatus.RESOLVED, IncidentStatus.FALSE_POSITIVE}),
    IncidentStatus.RESOLVED: frozenset(),
    IncidentStatus.FALSE_POSITIVE: frozenset(),
}
REOPENABLE_STATUSES = frozenset({IncidentStatus.RESOLVED, IncidentStatus.FALSE_POSITIVE})
CLOSED_INCIDENT_STATUSES = REOPENABLE_STATUSES


def allowed_transitions(status: str) -> list[str]:
    """Statuses an ordinary update may move an incident to, in lifecycle order; empty for unknown statuses."""
    try:
        allowed = INCIDENT_TRANSITIONS[IncidentStatus(status)]
    except ValueError:
        return []
    return [candidate.value for candidate in IncidentStatus if candidate in allowed]


class IncidentReopen(BaseModel):
    # Trimmed before the length check, so a whitespace-only reason is rejected (422) instead of recorded empty.
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class IncidentUpdate(BaseModel):
    status: IncidentStatus | None = None
    severity: Severity | None = None
    assigned_operator: str | None = None
    investigation_notes: str | None = None
    actor: str | None = None
