from datetime import datetime, timedelta, timezone
from random import Random
from typing import Sequence
from uuid import uuid4

from models.events import EventCategory, SecurityEvent, Severity


EVENT_LIBRARY = (
    ("CAMERA_OFFLINE", EventCategory.PHYSICAL, Severity.MEDIUM, "CCTV", "Simulated camera heartbeat lost."),
    ("UNAUTHORIZED_ACCESS", EventCategory.PHYSICAL, Severity.HIGH, "Access Control", "Simulated unauthorized access attempt."),
    ("UNKNOWN_DEVICE", EventCategory.CYBER, Severity.HIGH, "Network Monitor", "Simulated unknown device detected."),
    ("FAILED_AUTHENTICATION", EventCategory.CYBER, Severity.MEDIUM, "Identity Gateway", "Simulated failed authentication attempts."),
    ("SUSPICIOUS_TRAFFIC", EventCategory.CYBER, Severity.HIGH, "Network Monitor", "Simulated suspicious outbound traffic."),
    ("FIREWALL_BLOCK", EventCategory.CYBER, Severity.MEDIUM, "Firewall", "Simulated traffic blocked by policy."),
    ("GPS_ANOMALY", EventCategory.VESSEL_SYSTEM, Severity.MEDIUM, "GPS", "Simulated GPS position variance."),
    ("AIS_ANOMALY", EventCategory.VESSEL_SYSTEM, Severity.MEDIUM, "AIS", "Simulated AIS report inconsistency."),
    ("COMMUNICATION_INSTABILITY", EventCategory.VESSEL_SYSTEM, Severity.HIGH, "Edge Gateway", "Simulated communication instability."),
    ("SENSOR_FAILURE", EventCategory.PHYSICAL, Severity.MEDIUM, "Sensor Gateway", "Simulated sensor heartbeat lost."),
    ("SMOKE_DETECTED", EventCategory.ENVIRONMENTAL, Severity.HIGH, "Smoke Sensor", "Simulated smoke detection."),
    ("FIRE_ALARM", EventCategory.ENVIRONMENTAL, Severity.CRITICAL, "Fire Panel", "Simulated fire alarm activation."),
    ("TEMPERATURE_HIGH", EventCategory.ENVIRONMENTAL, Severity.HIGH, "Temperature Sensor", "Simulated high temperature reading."),
)


class EventGenerator:
    """Produces fictional security telemetry without contacting external systems."""

    def __init__(self, seed: int | None = None, clock: datetime | None = None) -> None:
        self.random = Random(seed)
        self.clock = clock or datetime.now(timezone.utc)

    def generate(self, vessel_id: str, timestamp: datetime | None = None) -> SecurityEvent:
        event_type, category, severity, source, description = self.random.choice(EVENT_LIBRARY)
        return self._event(vessel_id, event_type, category, severity, source, description, timestamp)

    def generate_many(self, vessel_id: str, count: int, start: datetime | None = None) -> list[SecurityEvent]:
        if count < 0:
            raise ValueError("count must be non-negative")
        current = start or self.clock
        return [self.generate(vessel_id, current + timedelta(seconds=index)) for index in range(count)]

    def create(self, vessel_id: str, event_type: str, *, timestamp: datetime | None = None) -> SecurityEvent:
        for candidate in EVENT_LIBRARY:
            if candidate[0] == event_type:
                return self._event(vessel_id, *candidate, timestamp)
        raise ValueError(f"Unknown event type: {event_type}")

    @staticmethod
    def _event(vessel_id: str, event_type: str, category: EventCategory, severity: Severity, source: str, description: str, timestamp: datetime | None) -> SecurityEvent:
        return SecurityEvent(event_id=f"evt-{uuid4().hex[:10]}", timestamp=timestamp or datetime.now(timezone.utc), vessel_id=vessel_id, event_type=event_type, category=category, severity=severity, source=source, description=description)


def available_event_types() -> Sequence[str]:
    return tuple(item[0] for item in EVENT_LIBRARY)
