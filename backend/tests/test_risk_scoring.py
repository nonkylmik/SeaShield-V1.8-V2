from datetime import datetime, timezone

from models.events import EventCategory, SecurityEvent, Severity, Vessel
from models.incidents import Incident, IncidentStatus
from security_engine.risk_scoring import calculate_score, status_for_score


def test_risk_score_penalties_and_boundaries():
    vessel = Vessel(id="v", name="Test", imo="IMO 0000000", base_score=100, score=100)
    event = SecurityEvent(event_id="e", vessel_id="v", event_type="FIRE_ALARM", category=EventCategory.ENVIRONMENTAL, severity=Severity.CRITICAL, source="test", description="test")
    assert calculate_score(vessel, [event], []) == 80
    assert calculate_score(vessel, [event] * 20, []) == 0
    assert status_for_score(59) == "CRITICAL"
    assert status_for_score(60) == "WARNING"


def test_resolved_incident_recovers_score():
    vessel = Vessel(id="v", name="Test", imo="IMO 0000000", base_score=100, score=100)
    incident = Incident(incident_id="i", vessel_id="v", type="TEST", title="Test", severity=Severity.HIGH, description="test")
    assert calculate_score(vessel, [], [incident]) == 85
    incident.status = IncidentStatus.RESOLVED
    assert calculate_score(vessel, [], [incident]) == 100
