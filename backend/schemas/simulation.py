from pydantic import BaseModel

from simulation.scenario_manager import Scenario


class SimulationScenarioResponse(BaseModel):
    """A scripted scenario as the backend defines it (simulation/scenario_manager.py)."""

    # What POST /api/v1/simulation/start takes as "scenario" and GET /api/v1/simulation/status reports as "scenario".
    key: str
    label: str
    # The vessel every step's events are generated for: fixed by the scenario, not chosen by the operator.
    vessel_id: str
    # None when that vessel is not in the current fleet.
    vessel_name: str | None
    # Steps the scenario runs: start runs the first, each POST /api/v1/simulation/next one more, then it is COMPLETE.
    step_count: int


def scenario_response(key: str, scenario: Scenario, vessel_name: str | None) -> SimulationScenarioResponse:
    return SimulationScenarioResponse(key=key, label=scenario.name, vessel_id=scenario.vessel_id, vessel_name=vessel_name, step_count=len(scenario.steps))
