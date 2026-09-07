from dataclasses import dataclass
from enum import Enum

from models.events import EventCategory, Severity


class ScenarioStatus(str, Enum):
    IDLE = "IDLE"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    STOPPED = "STOPPED"
    COMPLETE = "COMPLETE"


@dataclass(frozen=True)
class ScenarioStep:
    event_type: str
    category: EventCategory
    severity: Severity
    source: str
    description: str


@dataclass(frozen=True)
class Scenario:
    name: str
    vessel_id: str
    steps: tuple[ScenarioStep, ...]


SCENARIOS = {
    "cyber-intrusion": Scenario("Cyber Intrusion Simulation", "calypso", (
        ScenarioStep("UNKNOWN_DEVICE", EventCategory.CYBER, Severity.HIGH, "Network Monitor", "Unknown device detected."),
        ScenarioStep("FAILED_AUTHENTICATION", EventCategory.CYBER, Severity.MEDIUM, "Identity Gateway", "Multiple failed authentication attempts."),
        ScenarioStep("FAILED_AUTHENTICATION", EventCategory.CYBER, Severity.MEDIUM, "Identity Gateway", "Repeated failed authentication attempts."),
        ScenarioStep("SUSPICIOUS_TRAFFIC", EventCategory.CYBER, Severity.HIGH, "Network Monitor", "Suspicious outbound traffic detected."),
        ScenarioStep("FIREWALL_BLOCK", EventCategory.CYBER, Severity.MEDIUM, "Firewall", "Outbound traffic blocked by policy."),
    )),
    "physical-breach": Scenario("Physical Breach Simulation", "calypso", (
        ScenarioStep("UNAUTHORIZED_ACCESS", EventCategory.PHYSICAL, Severity.HIGH, "Access Control", "Unauthorized access in a restricted area."),
        ScenarioStep("CAMERA_OFFLINE", EventCategory.PHYSICAL, Severity.HIGH, "CCTV", "Nearby camera stopped responding."),
    )),
    "navigation-anomaly": Scenario("Navigation Anomaly Simulation", "meridian", (
        ScenarioStep("GPS_ANOMALY", EventCategory.VESSEL_SYSTEM, Severity.MEDIUM, "GPS", "GPS position variance exceeds tolerance."),
        ScenarioStep("AIS_ANOMALY", EventCategory.VESSEL_SYSTEM, Severity.MEDIUM, "AIS", "AIS report is inconsistent."),
        ScenarioStep("COMMUNICATION_INSTABILITY", EventCategory.VESSEL_SYSTEM, Severity.HIGH, "Edge Gateway", "Communication instability detected."),
    )),
    "fire-emergency": Scenario("Fire Emergency Simulation", "northstar", (
        ScenarioStep("SMOKE_DETECTED", EventCategory.ENVIRONMENTAL, Severity.HIGH, "Smoke Sensor", "Smoke detected in a simulated zone."),
        ScenarioStep("FIRE_ALARM", EventCategory.ENVIRONMENTAL, Severity.CRITICAL, "Fire Panel", "Fire alarm activated in a simulated zone."),
        ScenarioStep("TEMPERATURE_HIGH", EventCategory.ENVIRONMENTAL, Severity.HIGH, "Temperature Sensor", "Temperature exceeds simulated threshold."),
    )),
}


class ScenarioManager:
    def __init__(self) -> None:
        self.name: str | None = None
        self.status = ScenarioStatus.IDLE
        self.index = 0

    def start(self, scenario_name: str) -> Scenario:
        if scenario_name not in SCENARIOS:
            raise ValueError(f"Unknown scenario: {scenario_name}")
        self.name, self.status, self.index = scenario_name, ScenarioStatus.RUNNING, 0
        return SCENARIOS[scenario_name]

    def current(self) -> Scenario | None:
        return SCENARIOS.get(self.name) if self.name else None

    def next_step(self) -> ScenarioStep | None:
        scenario = self.current()
        if self.status != ScenarioStatus.RUNNING or scenario is None:
            return None
        if self.index >= len(scenario.steps):
            self.status = ScenarioStatus.COMPLETE
            return None
        step = scenario.steps[self.index]
        self.index += 1
        if self.index == len(scenario.steps):
            self.status = ScenarioStatus.COMPLETE
        return step

    def pause(self) -> None:
        if self.status == ScenarioStatus.RUNNING:
            self.status = ScenarioStatus.PAUSED

    def resume(self) -> None:
        if self.status == ScenarioStatus.PAUSED:
            self.status = ScenarioStatus.RUNNING

    def stop(self) -> None:
        if self.status in {ScenarioStatus.RUNNING, ScenarioStatus.PAUSED}:
            self.status = ScenarioStatus.STOPPED

    def reset(self) -> None:
        self.name, self.status, self.index = None, ScenarioStatus.IDLE, 0
