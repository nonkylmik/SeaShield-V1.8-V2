from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class EventCategory(str, Enum):
    PHYSICAL = "PHYSICAL"
    CYBER = "CYBER"
    VESSEL_SYSTEM = "VESSEL_SYSTEM"
    ENVIRONMENTAL = "ENVIRONMENTAL"


class Severity(str, Enum):
    INFO = "INFO"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class EventStatus(str, Enum):
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"


class SecurityEvent(BaseModel):
    event_id: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    vessel_id: str
    event_type: str
    category: EventCategory
    severity: Severity
    source: str
    description: str
    status: EventStatus = EventStatus.OPEN
    title: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    scenario: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class Vessel(BaseModel):
    id: str
    name: str
    imo: str
    base_score: int = Field(ge=0, le=100)
    score: int = Field(ge=0, le=100)
    status: str = "SECURE"
    last_communication: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Camera(BaseModel):
    id: str
    vessel_id: str
    location: str
    online: bool = True
    recording: bool = True
    last_heartbeat: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
