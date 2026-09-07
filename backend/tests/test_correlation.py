from datetime import datetime, timezone

from models.events import EventCategory, SecurityEvent, Severity
from security_engine.event_correlation import correlate


def make_event(event_type: str) -> SecurityEvent:
    return SecurityEvent(event_id=event_type, timestamp=datetime.now(timezone.utc), vessel_id="calypso", event_type=event_type, category=EventCategory.CYBER, severity=Severity.HIGH, source="test", description=event_type)


def test_cyber_correlation_returns_structured_result():
    result = correlate([make_event(item) for item in ["UNKNOWN_DEVICE", "FAILED_AUTHENTICATION", "FAILED_AUTHENTICATION", "SUSPICIOUS_TRAFFIC"]], "calypso")
    assert result is not None
    assert result.title == "Potential Network Intrusion"
    assert result.severity == Severity.CRITICAL
    assert len(result.related_event_ids) == 4


def test_physical_and_fire_rules_correlate():
    physical = [make_event("UNAUTHORIZED_ACCESS"), make_event("CAMERA_OFFLINE")]
    assert correlate(physical, "calypso").title == "Potential Physical Security Breach"
    environmental = [make_event("SMOKE_DETECTED"), make_event("FIRE_ALARM"), make_event("TEMPERATURE_HIGH")]
    assert correlate(environmental, "calypso").title == "Fire/Environmental Emergency"
