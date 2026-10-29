"""GET /api/v1/simulation/scenarios: the backend's scenario definitions, so clients never hard-code scenario keys,
labels, target vessels or step counts."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.main as main
import auth
from db.database import Base, get_db
from simulation.scenario_manager import SCENARIOS
from simulation.simulation_engine import SimulationEngine


@pytest.fixture()
def client(tmp_path, monkeypatch):
    database_engine = create_engine(f"sqlite:///{tmp_path / 'simulation_scenarios.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(database_engine)
    sessions = sessionmaker(bind=database_engine, expire_on_commit=False)
    monkeypatch.setattr(main, "SessionLocal", sessions)
    monkeypatch.setattr(main, "engine", SimulationEngine(seed=7))

    def override_db():
        with sessions() as session:
            yield session

    main.app.dependency_overrides[get_db] = override_db
    with TestClient(main.app) as test_client:
        yield test_client
    main.app.dependency_overrides.clear()
    database_engine.dispose()


def test_lists_every_scenario_with_its_label_target_vessel_and_step_count(client):
    response = client.get("/api/v1/simulation/scenarios")

    assert response.status_code == 200
    assert response.json() == [
        {"key": "cyber-intrusion", "label": "Cyber Intrusion Simulation", "vessel_id": "calypso", "vessel_name": "MV Calypso", "step_count": 5},
        {"key": "physical-breach", "label": "Physical Breach Simulation", "vessel_id": "calypso", "vessel_name": "MV Calypso", "step_count": 2},
        {"key": "navigation-anomaly", "label": "Navigation Anomaly Simulation", "vessel_id": "atlantic-trader", "vessel_name": "MV Atlantic Trader", "step_count": 3},
        {"key": "fire-emergency", "label": "Fire Emergency Simulation", "vessel_id": "northern-star", "vessel_name": "MV Northern Star", "step_count": 3},
    ]


def test_matches_the_scenario_definitions(client):
    listed = client.get("/api/v1/simulation/scenarios").json()

    assert [scenario["key"] for scenario in listed] == list(SCENARIOS)
    for scenario in listed:
        definition = SCENARIOS[scenario["key"]]
        assert (scenario["label"], scenario["vessel_id"], scenario["step_count"]) == (definition.name, definition.vessel_id, len(definition.steps))


@pytest.mark.parametrize("key", list(SCENARIOS))
def test_each_listed_scenario_starts_and_runs_exactly_its_step_count(client, key):
    listed = {scenario["key"]: scenario for scenario in client.get("/api/v1/simulation/scenarios").json()}

    started = client.post("/api/v1/simulation/start", json={"scenario": key})
    assert started.status_code == 200
    vessels = {started.json()["result"]["event"]["vessel_id"]}
    steps = 1
    while (step := client.post("/api/v1/simulation/next").json()) is not None:
        vessels.add(step["event"]["vessel_id"])
        steps += 1

    assert steps == listed[key]["step_count"]
    assert vessels == {listed[key]["vessel_id"]}
    assert client.get("/api/v1/simulation/status").json() == {"scenario": key, "status": "COMPLETE", "index": steps}


def test_is_read_only(client):
    status_before = client.get("/api/v1/simulation/status").json()
    events_before = client.get("/api/v1/events").json()

    for _ in range(2):
        assert client.get("/api/v1/simulation/scenarios").status_code == 200

    assert client.get("/api/v1/simulation/status").json() == status_before
    assert client.get("/api/v1/events").json() == events_before


def test_requires_a_session_when_auth_is_required(client, monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setattr(auth, "SESSION_SECRET", "test-session-secret")

    assert client.get("/api/v1/simulation/scenarios").status_code == 401


def test_target_vessel_outside_the_fleet_has_no_name(client, monkeypatch):
    monkeypatch.setattr(main, "current_vessels", lambda db: [])

    listed = client.get("/api/v1/simulation/scenarios").json()

    assert {scenario["vessel_name"] for scenario in listed} == {None}
    assert [scenario["vessel_id"] for scenario in listed] == [scenario.vessel_id for scenario in SCENARIOS.values()]
