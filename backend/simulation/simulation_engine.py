import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from models.events import Camera, SecurityEvent, Vessel
from security_engine.event_correlation import CorrelationResult, correlate
from security_engine.incident_manager import IncidentManager
from security_engine.risk_scoring import calculate_score, status_for_score
from simulation.event_generator import EventGenerator
from simulation.scenario_manager import ScenarioManager, ScenarioStatus


@dataclass(frozen=True)
class TickResult:
    event: SecurityEvent
    correlation: CorrelationResult | None = None


class SimulationEngine:
    """Coordinates generation, scenarios, correlation, incidents, and scores."""

    def __init__(self, seed: int | None = 7) -> None:
        self.generator = EventGenerator(seed=seed)
        self.scenarios = ScenarioManager()
        self.incidents = IncidentManager()
        self.vessels = self._default_vessels()
        self.cameras = [Camera(id="cam-17", vessel_id="calypso", location="Cargo Area")]
        self.events: list[SecurityEvent] = []
        self._broadcast: Callable[[dict[str, Any]], Any] | None = None

    def set_broadcaster(self, broadcaster: Callable[[dict[str, Any]], Any] | None) -> None:
        self._broadcast = broadcaster

    def _emit(self, message_type: str, data: dict[str, Any]) -> None:
        if self._broadcast is None:
            return
        payload = {"type": message_type, "timestamp": datetime.now(timezone.utc).isoformat(), "data": data}
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self._broadcast(payload))

    def start(self, scenario_name: str) -> None:
        self.scenarios.start(scenario_name)

    def tick(self) -> TickResult | None:
        step = self.scenarios.next_step()
        scenario = self.scenarios.current()
        if step is None or scenario is None:
            return None
        event = SecurityEvent(event_id=self.generator.create(scenario.vessel_id, step.event_type).event_id, timestamp=datetime.now(timezone.utc), vessel_id=scenario.vessel_id, event_type=step.event_type, category=step.category, severity=step.severity, source=step.source, description=step.description)
        self.events.insert(0, event)
        self._emit("security_event", {"event": event.model_dump(mode="json")})
        if event.event_type == "CAMERA_OFFLINE":
            for camera in self.cameras:
                if camera.vessel_id == event.vessel_id:
                    camera.online = False
                    camera.recording = False
        result = correlate(self.events, event.vessel_id)
        if result:
            incident = self.incidents.create_from_correlation(result)
            self._emit("incident_created", {"incident": incident.model_dump(mode="json")})
        self.recalculate()
        return TickResult(event, result)

    def pause(self) -> None: self.scenarios.pause()
    def resume(self) -> None: self.scenarios.resume()
    def stop(self) -> None: self.scenarios.stop()

    def reset(self) -> None:
        self.scenarios.reset()
        self.incidents.reset()
        self.events.clear()
        self.cameras = [Camera(id="cam-17", vessel_id="calypso", location="Cargo Area")]
        self.vessels = self._default_vessels()

    def resolve_incident(self, incident_id: str, status, notes: str = ""):
        incident = self.incidents.update_status(incident_id, status, notes)
        if incident and status.value in {"RESOLVED", "FALSE POSITIVE"}:
            for event in self.events:
                if event.event_id in incident.related_event_ids:
                    event.status = "RESOLVED"
            self.recalculate()
        return incident

    def recalculate(self) -> None:
        for vessel in self.vessels:
            previous_score = vessel.score
            previous_status = vessel.status
            vessel.score = calculate_score(vessel, self.events, self.incidents.get_all())
            vessel.status = status_for_score(vessel.score)
            if previous_score != vessel.score:
                self._emit("security_score_changed", {"vessel_id": vessel.id, "score": vessel.score, "status": vessel.status})
            if previous_status != vessel.status:
                self._emit("vessel_status_changed", {"vessel_id": vessel.id, "status": vessel.status})

    @staticmethod
    def _default_vessels() -> list[Vessel]:
        return [Vessel(id="baltic-guardian", name="MV Baltic Guardian", imo="IMO 9384751", base_score=96, score=96), Vessel(id="northern-star", name="MV Northern Star", imo="IMO 9410283", base_score=94, score=94), Vessel(id="ocean-sentinel", name="MV Ocean Sentinel", imo="IMO 9521846", base_score=92, score=92), Vessel(id="atlantic-trader", name="MV Atlantic Trader", imo="IMO 9673052", base_score=95, score=95), Vessel(id="iron-horizon", name="MV Iron Horizon", imo="IMO 9714457", base_score=93, score=93), Vessel(id="calypso", name="MV Calypso", imo="IMO 9751028", base_score=92, score=92)]
