from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from models.events import EventCategory, EventStatus, Severity


class SecurityEventCreate(BaseModel):
    event_id: str = Field(min_length=1, max_length=100)
    timestamp: datetime
    vessel_id: str = Field(min_length=1, max_length=100)
    event_type: str = Field(min_length=1, max_length=100)
    category: EventCategory
    severity: Severity
    source: str = Field(min_length=1, max_length=160)
    title: str | None = Field(default=None, max_length=200)
    description: str
    status: EventStatus = EventStatus.OPEN
    confidence: float | None = Field(default=None, ge=0, le=1)
    scenario: str | None = Field(default=None, max_length=100)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SecurityEventResponse(SecurityEventCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
