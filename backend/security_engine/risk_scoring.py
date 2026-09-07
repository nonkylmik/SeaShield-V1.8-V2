from collections.abc import Iterable

from models.events import SecurityEvent, Severity, Vessel
from models.incidents import Incident, IncidentStatus


EVENT_PENALTIES = {Severity.INFO: 0, Severity.LOW: 2, Severity.MEDIUM: 5, Severity.HIGH: 10, Severity.CRITICAL: 20}
INCIDENT_PENALTIES = {Severity.INFO: 0, Severity.LOW: 4, Severity.MEDIUM: 8, Severity.HIGH: 15, Severity.CRITICAL: 25}


def calculate_score(vessel: Vessel, events: Iterable[SecurityEvent], incidents: Iterable[Incident]) -> int:
    event_penalty = sum(EVENT_PENALTIES[event.severity] for event in events if event.vessel_id == vessel.id and event.status != "RESOLVED")
    incident_penalty = sum(INCIDENT_PENALTIES[incident.severity] for incident in incidents if incident.vessel_id == vessel.id and incident.status not in {IncidentStatus.RESOLVED, IncidentStatus.FALSE_POSITIVE})
    return max(0, min(100, vessel.base_score - event_penalty - incident_penalty))


def status_for_score(score: int) -> str:
    return "CRITICAL" if score < 60 else "WARNING" if score < 85 else "SECURE"
