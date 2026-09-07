from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4
from collections.abc import Iterable

from models.events import SecurityEvent, Severity


@dataclass(frozen=True)
class CorrelationRule:
    title: str
    match: tuple[str, ...]
    severity: Severity
    systems: tuple[str, ...]
    description: str


@dataclass(frozen=True)
class CorrelationResult:
    correlation_id: str
    vessel_id: str
    title: str
    severity: Severity
    related_event_ids: tuple[str, ...]
    description: str
    timestamp: datetime
    affected_systems: tuple[str, ...]


RULES = (
    CorrelationRule("Potential Network Intrusion", ("UNKNOWN_DEVICE", "FAILED_AUTHENTICATION", "SUSPICIOUS_TRAFFIC"), Severity.CRITICAL, ("Network", "Identity", "Firewall"), "Multiple simulated cyber indicators correlate into a potential network intrusion."),
    CorrelationRule("Potential Physical Security Breach", ("UNAUTHORIZED_ACCESS", "CAMERA_OFFLINE"), Severity.HIGH, ("Access Control", "CCTV"), "Unauthorized access and nearby camera loss correlate into a potential physical breach."),
    CorrelationRule("Navigation/Communication Anomaly", ("GPS_ANOMALY", "AIS_ANOMALY", "COMMUNICATION_INSTABILITY"), Severity.HIGH, ("GPS", "AIS", "Communications"), "Navigation and communication indicators correlate into an anomaly."),
    CorrelationRule("Fire/Environmental Emergency", ("SMOKE_DETECTED", "FIRE_ALARM", "TEMPERATURE_HIGH"), Severity.CRITICAL, ("Smoke", "Fire Panel", "Temperature"), "Environmental indicators correlate into a simulated fire emergency."),
)


def correlate(events: Iterable[SecurityEvent], vessel_id: str) -> CorrelationResult | None:
    relevant = [event for event in events if event.vessel_id == vessel_id and event.status != "RESOLVED"]
    for rule in RULES:
        matches = [event for event in relevant if event.event_type in rule.match]
        if all(any(event.event_type == event_type for event in matches) for event_type in rule.match):
            return CorrelationResult(f"corr-{uuid4().hex[:10]}", vessel_id, rule.title, rule.severity, tuple(event.event_id for event in matches), rule.description, datetime.now(timezone.utc), rule.systems)
    return None
