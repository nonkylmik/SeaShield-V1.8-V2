from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from models.events import EventCategory, SecurityEvent, Severity
from simulation.event_generator import EventGenerator


def test_event_creation_and_validation():
    event = SecurityEvent(event_id="evt-1", vessel_id="vessel-1", event_type="FIRE_ALARM", category=EventCategory.ENVIRONMENTAL, severity=Severity.CRITICAL, source="Fire Panel", description="Simulated fire alarm", timestamp=datetime.now(timezone.utc))
    assert event.status.value == "OPEN"
    assert event.metadata == {}
    with pytest.raises(ValidationError):
        SecurityEvent(event_id="evt-2", vessel_id="vessel-1", event_type="BAD", category="INVALID", severity=Severity.HIGH, source="test", description="bad")


def test_seeded_event_generation_is_deterministic():
    first = EventGenerator(seed=42, clock=datetime(2026, 1, 1, tzinfo=timezone.utc)).generate_many("vessel-1", 5)
    second = EventGenerator(seed=42, clock=datetime(2026, 1, 1, tzinfo=timezone.utc)).generate_many("vessel-1", 5)
    assert [(event.event_type, event.severity) for event in first] == [(event.event_type, event.severity) for event in second]
    assert [event.timestamp for event in first] == [event.timestamp for event in second]
