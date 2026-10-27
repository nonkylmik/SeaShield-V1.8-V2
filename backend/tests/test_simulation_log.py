import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.main as main
from db.database import Base, get_db
from simulation.simulation_engine import SimulationEngine


@pytest.fixture()
def client(tmp_path, monkeypatch):
    database_engine = create_engine(f"sqlite:///{tmp_path / 'simulation_log.db'}", connect_args={"check_same_thread": False})
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


def inject(test_client, vessel_id: str, event_type: str) -> str:
    response = test_client.post("/api/v1/simulation/inject", json={"vessel_id": vessel_id, "event_type": event_type})
    assert response.status_code == 200
    return response.json()["event"]["event_id"]


def log(test_client, **params) -> list[dict]:
    return test_client.get("/api/v1/simulation/log", params=params).json()


def test_the_log_starts_empty_even_with_safety_round_reports_seeded(client):
    assert client.get("/api/security-events?event_type=SAFETY_CHECKPOINT_FAILED").json()
    assert log(client) == []


def test_injections_are_logged_newest_first_with_what_was_recorded(client):
    first = inject(client, "calypso", "UNAUTHORIZED_ACCESS")
    second = inject(client, "iron-horizon", "FIREWALL_BLOCK")

    entries = log(client)

    assert [entry["event_id"] for entry in entries] == [second, first]
    newest = entries[0]
    assert {key: newest[key] for key in ("vessel_id", "event_type", "severity", "status", "scenario", "incident_ids")} == {
        "vessel_id": "iron-horizon",
        "event_type": "FIREWALL_BLOCK",
        "severity": "MEDIUM",
        "status": "OPEN",
        "scenario": "manual-injection",
        "incident_ids": [],
    }
    assert newest["scenario_label"] == "Manual injection"


def test_correlated_events_show_the_incident_they_opened(client):
    access = inject(client, "calypso", "UNAUTHORIZED_ACCESS")
    camera = inject(client, "calypso", "CAMERA_OFFLINE")
    incident_id = next(item["incident_id"] for item in client.get("/api/v1/incidents").json() if item["vessel_id"] == "calypso")

    by_event = {entry["event_id"]: entry["incident_ids"] for entry in log(client)}

    assert by_event == {access: [incident_id], camera: [incident_id]}


def test_scenario_steps_are_logged_under_their_scenario(client):
    client.post("/api/v1/simulation/start", json={"scenario": "fire-emergency"})
    client.post("/api/v1/simulation/next")

    entries = log(client)

    assert [(entry["scenario"], entry["event_type"]) for entry in entries] == [("fire-emergency", "FIRE_ALARM"), ("fire-emergency", "SMOKE_DETECTED")]
    assert {entry["scenario_label"] for entry in entries} == {"Fire Emergency Simulation"}


def test_safety_round_reports_and_ingested_events_are_not_simulation_actions(client):
    created = client.post("/api/v1/safety-rounds", json={"vessel_id": "calypso", "round_type": "Security Round"}).json()
    client.post(f"/api/v1/safety-rounds/{created['round_id']}/start")
    client.post("/api/security-events", json={"event_id": "evt-ingested", "timestamp": "2026-10-26T10:00:00Z", "vessel_id": "calypso", "event_type": "UNKNOWN_DEVICE", "category": "CYBER", "severity": "HIGH", "source": "test", "description": "test"})
    injected = inject(client, "calypso", "FIREWALL_BLOCK")

    assert [entry["event_id"] for entry in log(client)] == [injected]


def test_failed_injection_adds_no_entry(client):
    assert client.post("/api/v1/simulation/inject", json={"vessel_id": "no-such-vessel", "event_type": "FIRE_ALARM"}).status_code == 404
    assert client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "NOT_AN_EVENT"}).status_code == 400

    assert log(client) == []


def test_reset_keeps_the_history_and_marks_it_resolved(client, monkeypatch):
    injected = inject(client, "calypso", "FIRE_ALARM")

    client.post("/api/v1/simulation/reset")
    monkeypatch.setattr(main, "engine", SimulationEngine(seed=7))

    assert [(entry["event_id"], entry["status"]) for entry in log(client)] == [(injected, "RESOLVED")]


def test_limit(client):
    for _ in range(3):
        inject(client, "calypso", "FIREWALL_BLOCK")

    assert len(log(client, limit=2)) == 2
    assert client.get("/api/v1/simulation/log", params={"limit": 0}).status_code == 422
