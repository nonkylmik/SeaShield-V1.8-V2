import asyncio

import pytest

from simulation.simulation_engine import SimulationEngine
from simulation.scenario_manager import ScenarioStatus


def test_engine_scenario_progression_and_controls():
    engine = SimulationEngine(seed=1)
    engine.start("physical-breach")
    assert engine.scenarios.status == ScenarioStatus.RUNNING
    assert engine.tick().event.event_type == "UNAUTHORIZED_ACCESS"
    engine.pause()
    assert engine.tick() is None
    engine.resume()
    assert engine.tick().event.event_type == "CAMERA_OFFLINE"
    assert engine.scenarios.status == ScenarioStatus.COMPLETE
    assert engine.incidents.get_active()
    engine.stop()
    engine.reset()
    assert engine.scenarios.status == ScenarioStatus.IDLE
    assert engine.events == []
    assert engine.incidents.get_all() == []


def test_all_scenarios_are_available():
    engine = SimulationEngine()
    for name in ["cyber-intrusion", "physical-breach", "navigation-anomaly", "fire-emergency"]:
        engine.reset()
        engine.start(name)
        while engine.tick() is not None:
            pass
        assert engine.scenarios.status == ScenarioStatus.COMPLETE
        assert engine.incidents.get_active()


def run_with_recorder(scenario):
    """Runs `scenario(engine)` inside an event loop and returns the notification types the broadcaster received."""
    sent: list[str] = []

    async def record(payload):
        sent.append(payload["type"])

    async def run():
        engine = SimulationEngine(seed=7)
        engine.set_broadcaster(record)
        scenario(engine)
        await asyncio.sleep(0)

    asyncio.run(run())
    return sent


def test_deferred_notifications_are_discarded_when_the_block_raises():
    def failing_commit(engine):
        with pytest.raises(RuntimeError, match="commit failed"):
            with engine.deferred_notifications():
                engine._emit("security_score_changed", {"vessel_id": "calypso", "score": 72})
                raise RuntimeError("commit failed")
        assert engine._deferred is None

    assert run_with_recorder(failing_commit) == []


def test_deferred_notifications_are_published_only_after_success():
    def successful_commit(engine):
        with engine.deferred_notifications():
            engine._emit("security_score_changed", {"vessel_id": "calypso", "score": 72})
            engine._emit("vessel_status_changed", {"vessel_id": "calypso", "status": "WARNING"})

    assert run_with_recorder(successful_commit) == ["security_score_changed", "vessel_status_changed"]


def test_deferred_notifications_can_be_suppressed_and_do_not_affect_later_notifications():
    def suppressed_then_immediate(engine):
        with engine.deferred_notifications(publish=False):
            engine._emit("security_score_changed", {"vessel_id": "calypso", "score": 92})
        engine._emit("security_event", {"event": {}})

    assert run_with_recorder(suppressed_then_immediate) == ["security_event"]
