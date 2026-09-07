from datetime import datetime, timezone

from models.events import SecurityEvent
from models.incidents import Incident, IncidentStatus
from security_engine.event_correlation import CorrelationResult


class IncidentManager:
    """Owns in-memory incident creation, association, lifecycle, and history."""

    def __init__(self) -> None:
        self._incidents: list[Incident] = []

    def create_from_correlation(self, result: CorrelationResult) -> Incident:
        existing = next((incident for incident in self._incidents if incident.vessel_id == result.vessel_id and incident.type == result.title and incident.status not in {IncidentStatus.RESOLVED, IncidentStatus.FALSE_POSITIVE}), None)
        if existing:
            existing.related_event_ids = list(dict.fromkeys([*existing.related_event_ids, *result.related_event_ids]))
            return existing
        incident = Incident(incident_id=f"INC-{241 + len(self._incidents):04d}", vessel_id=result.vessel_id, type=result.title, title=result.title, severity=result.severity, description=result.description, related_event_ids=list(result.related_event_ids), affected_systems=list(result.affected_systems))
        self._incidents.insert(0, incident)
        return incident

    def get_all(self) -> list[Incident]:
        return list(self._incidents)

    def get_active(self) -> list[Incident]:
        return [incident for incident in self._incidents if incident.status not in {IncidentStatus.RESOLVED, IncidentStatus.FALSE_POSITIVE}]

    def get(self, incident_id: str) -> Incident | None:
        return next((incident for incident in self._incidents if incident.incident_id == incident_id), None)

    def update_status(self, incident_id: str, status: IncidentStatus, notes: str = "") -> Incident | None:
        incident = self.get(incident_id)
        if not incident:
            return None
        incident.status = status
        incident.updated_at = datetime.now(timezone.utc)
        if notes:
            incident.investigation_notes = notes
        return incident

    def reset(self) -> None:
        self._incidents.clear()
