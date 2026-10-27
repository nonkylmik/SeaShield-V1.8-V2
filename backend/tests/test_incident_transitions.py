import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.main as main
from auth import DEMO_USER, SESSION_COOKIE, create_session
from db.database import Base, get_db
from db.repositories.security_repository import latest_security_score
from db.repositories.vessel_repository import get_vessel_record
from models.incidents import INCIDENT_TRANSITIONS, IncidentStatus
from simulation.simulation_engine import SimulationEngine

ALLOWED = [(current.value, target.value) for current, targets in INCIDENT_TRANSITIONS.items() for target in targets]
REFUSED = [
    (current.value, target.value)
    for current in IncidentStatus
    for target in IncidentStatus
    if target != current and target not in INCIDENT_TRANSITIONS[current]
]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    database_engine = create_engine(f"sqlite:///{tmp_path / 'incident_transitions.db'}", connect_args={"check_same_thread": False})
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


def correlated_incident(test_client) -> tuple[str, list[str]]:
    """A physical-breach incident on calypso with its two linked events."""
    first = test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "UNAUTHORIZED_ACCESS"}).json()
    second = test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "CAMERA_OFFLINE"}).json()
    incident_id = next(item["incident_id"] for item in test_client.get("/api/v1/incidents").json() if item["vessel_id"] == "calypso")
    return incident_id, [first["event"]["event_id"], second["event"]["event_id"]]


def put_in_status(test_client, incident_id: str, status: str) -> None:
    """Moves an incident from NEW to `status` along allowed transitions."""
    if status == "NEW":
        return
    assert test_client.patch(f"/api/v1/incidents/{incident_id}", json={"status": status}).status_code == 200


def incident(test_client, incident_id: str) -> dict:
    return test_client.get(f"/api/v1/incidents/{incident_id}").json()


def event_statuses(test_client, event_ids: list[str]) -> list[str]:
    return [test_client.get(f"/api/security-events/{event_id}").json()["status"] for event_id in event_ids]


def calypso_score(test_client, sessions) -> tuple[int, int, int]:
    api = test_client.get("/security/calypso").json()["score"]
    with sessions() as database:
        return api, get_vessel_record(database, "calypso").score, latest_security_score(database, "calypso").score


@pytest.mark.parametrize(("current", "target"), ALLOWED)
def test_allowed_transitions_are_applied(client, current, target):
    test_client, _ = client
    incident_id, _ = correlated_incident(test_client)
    put_in_status(test_client, incident_id, current)

    response = test_client.patch(f"/api/v1/incidents/{incident_id}", json={"status": target})

    assert response.status_code == 200
    assert response.json()["status"] == target


@pytest.mark.parametrize(("current", "target"), REFUSED)
def test_refused_transitions_return_409_and_change_nothing(client, current, target):
    test_client, sessions = client
    incident_id, event_ids = correlated_incident(test_client)
    put_in_status(test_client, incident_id, current)
    before = incident(test_client, incident_id)
    events_before = event_statuses(test_client, event_ids)
    score_before = calypso_score(test_client, sessions)

    response = test_client.patch(f"/api/v1/incidents/{incident_id}", json={"status": target, "severity": "LOW"})

    assert response.status_code == 409
    assert f"from {current} to {target}" in response.json()["detail"]
    assert incident(test_client, incident_id) == before
    assert event_statuses(test_client, event_ids) == events_before
    assert calypso_score(test_client, sessions) == score_before


def test_the_payload_lists_what_the_ui_may_offer(client):
    test_client, _ = client
    incident_id, _ = correlated_incident(test_client)

    opened = incident(test_client, incident_id)
    put_in_status(test_client, incident_id, "RESOLVED")
    resolved = incident(test_client, incident_id)

    assert (opened["allowed_transitions"], opened["can_reopen"]) == (["INVESTIGATING", "CONTAINED", "RESOLVED", "FALSE POSITIVE"], False)
    assert (resolved["allowed_transitions"], resolved["can_reopen"]) == ([], True)


def test_resubmitting_the_current_status_records_nothing(client):
    test_client, _ = client
    incident_id, _ = correlated_incident(test_client)
    put_in_status(test_client, incident_id, "INVESTIGATING")
    timeline_before = incident(test_client, incident_id)["timeline"]

    assert test_client.patch(f"/api/v1/incidents/{incident_id}", json={"status": "INVESTIGATING"}).status_code == 200

    assert incident(test_client, incident_id)["timeline"] == timeline_before


@pytest.mark.parametrize("closed", ["RESOLVED", "FALSE POSITIVE"])
def test_reopening_restores_evidence_and_score_once(client, monkeypatch, closed):
    test_client, sessions = client
    incident_id, event_ids = correlated_incident(test_client)
    score_while_open = calypso_score(test_client, sessions)
    put_in_status(test_client, incident_id, closed)
    assert event_statuses(test_client, event_ids) == ["RESOLVED", "RESOLVED"]
    assert calypso_score(test_client, sessions)[0] == 92
    timeline_before = incident(test_client, incident_id)["timeline"]

    response = test_client.post(f"/api/v1/incidents/{incident_id}/reopen", json={"reason": "  Badge reader logs show a second entry.  "})

    assert response.status_code == 200
    reopened = incident(test_client, incident_id)
    assert reopened["status"] == "INVESTIGATING"
    assert sorted(reopened["related_event_ids"]) == sorted(event_ids)
    assert event_statuses(test_client, event_ids) == ["OPEN", "OPEN"]
    assert calypso_score(test_client, sessions) == score_while_open
    added = reopened["timeline"][len(timeline_before):]
    assert [(entry["text"], entry["actor"]) for entry in added] == [(f"Reopened from {closed}: Badge reader logs show a second entry.", "Operator")]

    monkeypatch.setattr(main, "engine", SimulationEngine(seed=7))
    with sessions() as database:
        main.sync_engine_from_db(database)
    assert calypso_score(test_client, sessions) == score_while_open


@pytest.mark.parametrize("status", ["NEW", "INVESTIGATING", "CONTAINED"])
def test_only_closed_incidents_can_be_reopened(client, status):
    test_client, _ = client
    incident_id, _ = correlated_incident(test_client)
    put_in_status(test_client, incident_id, status)
    before = incident(test_client, incident_id)

    response = test_client.post(f"/api/v1/incidents/{incident_id}/reopen", json={"reason": "Check again"})

    assert response.status_code == 409
    assert incident(test_client, incident_id) == before


def test_reopen_requires_a_reason_and_an_existing_incident(client):
    test_client, _ = client
    incident_id, _ = correlated_incident(test_client)
    put_in_status(test_client, incident_id, "RESOLVED")

    assert test_client.post(f"/api/v1/incidents/{incident_id}/reopen", json={"reason": ""}).status_code == 422
    assert test_client.post(f"/api/v1/incidents/{incident_id}/reopen", json={}).status_code == 422
    assert test_client.post("/api/v1/incidents/INC-9999/reopen", json={"reason": "x"}).status_code == 404
    assert incident(test_client, incident_id)["status"] == "RESOLVED"


def test_the_signed_in_user_is_recorded_not_a_claimed_name(client, monkeypatch):
    test_client, _ = client
    incident_id, _ = correlated_incident(test_client)
    monkeypatch.setattr("app.main.auth_required", lambda: True)
    monkeypatch.setattr("auth.auth_required", lambda: True)
    test_client.cookies.set(SESSION_COOKIE, create_session(DEMO_USER))

    test_client.patch(f"/api/v1/incidents/{incident_id}", json={"status": "RESOLVED", "actor": "Somebody Else"})
    test_client.post(f"/api/v1/incidents/{incident_id}/reopen", json={"reason": "New evidence"})

    actors = [entry["actor"] for entry in incident(test_client, incident_id)["timeline"][-2:]]
    assert actors == [DEMO_USER.name, DEMO_USER.name]


@pytest.mark.parametrize("action", ["resolve", "reopen"])
def test_a_failed_status_change_changes_nothing(client, monkeypatch, action):
    test_client, sessions = client
    incident_id, event_ids = correlated_incident(test_client)
    if action == "reopen":
        put_in_status(test_client, incident_id, "RESOLVED")
    before = incident(test_client, incident_id)
    events_before = event_statuses(test_client, event_ids)
    score_before = calypso_score(test_client, sessions)

    def fail(*args, **kwargs):
        raise RuntimeError("score history unavailable")

    monkeypatch.setattr(main, "append_security_score", fail)
    with pytest.raises(RuntimeError):
        if action == "resolve":
            test_client.patch(f"/api/v1/incidents/{incident_id}", json={"status": "RESOLVED"})
        else:
            test_client.post(f"/api/v1/incidents/{incident_id}/reopen", json={"reason": "x"})

    assert incident(test_client, incident_id) == before
    assert event_statuses(test_client, event_ids) == events_before
    assert calypso_score(test_client, sessions) == score_before
    assert next(vessel for vessel in main.engine.vessels if vessel.id == "calypso").score == score_before[0]
