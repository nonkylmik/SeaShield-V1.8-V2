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
