from datetime import datetime, timezone

from models.events import EventCategory, SecurityEvent, Severity
from security_engine.event_correlation import correlate
from security_engine.incident_manager import IncidentManager


def test_incident_creation_and_lifecycle():
    events = [SecurityEvent(event_id=item, timestamp=datetime.now(timezone.utc), vessel_id="v", event_type=item, category=EventCategory.CYBER, severity=Severity.HIGH, source="test", description=item) for item in ["UNKNOWN_DEVICE", "FAILED_AUTHENTICATION", "SUSPICIOUS_TRAFFIC"]]
    result = correlate(events, "v")
    manager = IncidentManager()
    incident = manager.create_from_correlation(result)
    assert incident.status.value == "NEW"
    assert len(manager.get_active()) == 1
    manager.update_status(incident.incident_id, "INVESTIGATING", "Reviewing event chain")
    assert manager.get(incident.incident_id).investigation_notes == "Reviewing event chain"
    manager.update_status(incident.incident_id, "CONTAINED")
    manager.update_status(incident.incident_id, "RESOLVED")
    assert manager.get_active() == []
    assert len(manager.get_all()) == 1
