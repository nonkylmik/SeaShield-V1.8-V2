import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.main as main
from db.database import Base, get_db
from db.repositories.security_repository import latest_security_score
from db.repositories.vessel_repository import get_vessel_record
from simulation.simulation_engine import SimulationEngine

RESET_ACTIVITY = "Closed by simulation reset: status {} → RESOLVED."


@pytest.fixture()
def client(tmp_path, monkeypatch):
    database_engine = create_engine(f"sqlite:///{tmp_path / 'simulation_reset.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(database_engine)
    sessions = sessionmaker(bind=database_engine, expire_on_commit=False)
    monkeypatch.setattr(main, "SessionLocal", sessions)
    monkeypatch.setattr(main, "engine", SimulationEngine(seed=7))

    def override_db():
        with sessions() as session:
            yield session

    main.app.dependency_overrides[get_db] = override_db
    with TestClient(main.app) as test_client:
        yield test_client, sessions
    main.app.dependency_overrides.clear()
    database_engine.dispose()


def open_incident(test_client, vessel_id: str, title: str, status: str | None = None, notes: str | None = None) -> str:
    incident_id = test_client.post("/api/v1/incidents", json={"vessel_id": vessel_id, "title": title, "severity": "HIGH"}).json()["incident_id"]
    update = {key: value for key, value in {"status": status, "investigation_notes": notes}.items() if value is not None}
    if update:
        assert test_client.patch(f"/api/v1/incidents/{incident_id}", json=update).status_code == 200
    return incident_id


def incident(test_client, incident_id: str) -> dict:
    return test_client.get(f"/api/v1/incidents/{incident_id}").json()


def reset_entries(payload: dict) -> list[dict]:
    return [entry for entry in payload["timeline"] if entry["text"].startswith("Closed by simulation reset")]


def scores(test_client) -> dict[str, int]:
    return {vessel["id"]: vessel["score"] for vessel in test_client.get("/api/v1/vessels").json()}


def persisted_scores(sessions, vessel_ids) -> dict[str, tuple[int, int]]:
    with sessions() as database:
        return {vessel_id: (get_vessel_record(database, vessel_id).score, latest_security_score(database, vessel_id).score) for vessel_id in vessel_ids}


def restart(monkeypatch, sessions) -> None:
    monkeypatch.setattr(main, "engine", SimulationEngine(seed=7))
    with sessions() as database:
        main.sync_engine_from_db(database)


def test_reset_closes_only_open_incidents(client):
    test_client, _ = client
    open_ids = {
        "NEW": open_incident(test_client, "calypso", "New"),
        "INVESTIGATING": open_incident(test_client, "calypso", "Investigating", status="INVESTIGATING"),
        "CONTAINED": open_incident(test_client, "calypso", "Contained", status="CONTAINED"),
    }
    closed_ids = [
        open_incident(test_client, "iron-horizon", "Resolved", status="RESOLVED", notes="Patched the gateway."),
        open_incident(test_client, "iron-horizon", "False positive", status="FALSE POSITIVE", notes="Benign maintenance laptop."),
    ]
    closed_before = [incident(test_client, incident_id) for incident_id in closed_ids]

    assert test_client.post("/api/v1/simulation/reset").status_code == 200

    assert {status: incident(test_client, incident_id)["status"] for status, incident_id in open_ids.items()} == {"NEW": "RESOLVED", "INVESTIGATING": "RESOLVED", "CONTAINED": "RESOLVED"}
    assert [incident(test_client, incident_id) for incident_id in closed_ids] == closed_before


def test_reset_never_overwrites_investigation_notes(client):
    test_client, _ = client
    open_id = open_incident(test_client, "calypso", "Open with notes", status="INVESTIGATING", notes="Badge 4471 used at 02:14; reviewing CCTV.")
    test_client.post(f"/api/v1/incidents/{open_id}/notes", json={"author": "Officer", "body": "Crew interview scheduled."})
    before = incident(test_client, open_id)

    test_client.post("/api/v1/simulation/reset")

    after = incident(test_client, open_id)
    assert after["status"] == "RESOLVED"
    assert after["investigation_notes"] == "Badge 4471 used at 02:14; reviewing CCTV."
    assert after["notes"] == before["notes"]


def test_reset_records_one_activity_entry_per_closed_incident(client):
    test_client, _ = client
    open_id = open_incident(test_client, "calypso", "Investigating", status="INVESTIGATING")
    false_positive_id = open_incident(test_client, "calypso", "False positive", status="FALSE POSITIVE")

    test_client.post("/api/v1/simulation/reset")
    test_client.post("/api/v1/simulation/reset")

    entries = reset_entries(incident(test_client, open_id))
    assert [(entry["text"], entry["actor"]) for entry in entries] == [(RESET_ACTIVITY.format("INVESTIGATING"), "System")]
    assert reset_entries(incident(test_client, false_positive_id)) == []


def test_reset_scores_match_persisted_state_after_restart(client, monkeypatch):
    test_client, sessions = client
    test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "UNAUTHORIZED_ACCESS"})
    test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "CAMERA_OFFLINE"})
    correlated_id = next(item["incident_id"] for item in test_client.get("/api/v1/incidents").json() if item["vessel_id"] == "calypso")
    false_positive_id = open_incident(test_client, "iron-horizon", "False positive", status="FALSE POSITIVE", notes="Benign.")
    assert scores(test_client)["calypso"] < 92

    test_client.post("/api/v1/simulation/reset")

    after_reset = scores(test_client)
    assert after_reset["calypso"] == 92
    assert after_reset["iron-horizon"] == 93
    assert persisted_scores(sessions, ["calypso", "iron-horizon"]) == {"calypso": (92, 92), "iron-horizon": (93, 93)}
    statuses = {incident_id: incident(test_client, incident_id)["status"] for incident_id in (correlated_id, false_positive_id)}
    assert statuses == {correlated_id: "RESOLVED", false_positive_id: "FALSE POSITIVE"}

    restart(monkeypatch, sessions)
    assert scores(test_client) == after_reset
    assert persisted_scores(sessions, ["calypso", "iron-horizon"]) == {"calypso": (92, 92), "iron-horizon": (93, 93)}
    assert {incident_id: incident(test_client, incident_id)["status"] for incident_id in statuses} == statuses


def test_failed_reset_changes_nothing(client, monkeypatch):
    test_client, sessions = client
    first = test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "UNAUTHORIZED_ACCESS"})
    test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "CAMERA_OFFLINE"})
    incident_id = next(item["incident_id"] for item in test_client.get("/api/v1/incidents").json() if item["vessel_id"] == "calypso")
    incident_before = incident(test_client, incident_id)
    scores_before = scores(test_client)

    def fail(*args, **kwargs):
        raise RuntimeError("score history unavailable")

    monkeypatch.setattr(main, "append_security_score", fail)
    with pytest.raises(RuntimeError):
        test_client.post("/api/v1/simulation/reset")

    assert incident(test_client, incident_id) == incident_before
    assert test_client.get(f"/api/security-events/{first.json()['event']['event_id']}").json()["status"] == "OPEN"
    assert scores(test_client) == scores_before
    assert next(vessel for vessel in main.engine.vessels if vessel.id == "calypso").score == scores_before["calypso"]
    assert persisted_scores(sessions, ["calypso"]) == {"calypso": (scores_before["calypso"], scores_before["calypso"])}
