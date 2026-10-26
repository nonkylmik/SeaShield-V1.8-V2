import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import app.main as main
from db.database import Base, get_db
from db.events import get_event
from db.models import EventAcknowledgementRecord, IncidentEventLink
from db.repositories.security_repository import latest_security_score
from db.repositories.vessel_repository import get_vessel_record
from simulation.simulation_engine import SimulationEngine


@pytest.fixture()
def client(tmp_path, monkeypatch):
    database_engine = create_engine(f"sqlite:///{tmp_path / 'event_consistency.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(database_engine)
    sessions = sessionmaker(bind=database_engine, expire_on_commit=False)
    monkeypatch.setattr(main, "SessionLocal", sessions)
    monkeypatch.setattr(main, "engine", SimulationEngine(seed=7))
    broadcasts: list[tuple[str, dict, bool]] = []

    async def record_broadcast(message_type: str, data: dict) -> None:
        # Records whether the event the message refers to is already committed when the message is sent.
        committed = None
        if "event_id" in data:
            with sessions() as database:
                committed = get_event(database, data["event_id"]) is not None
        broadcasts.append((message_type, data, committed))

    monkeypatch.setattr(main, "broadcast_status_message", record_broadcast)

    def override_db():
        with sessions() as session:
            yield session

    main.app.dependency_overrides[get_db] = override_db
    with TestClient(main.app) as test_client:
        yield test_client, sessions, broadcasts
    main.app.dependency_overrides.clear()
    database_engine.dispose()


def event_payload(event_id: str, vessel_id: str = "calypso", severity: str = "CRITICAL") -> dict:
    return {
        "event_id": event_id,
        "timestamp": "2026-10-26T10:00:00Z",
        "vessel_id": vessel_id,
        "event_type": "UNKNOWN_DEVICE",
        "category": "CYBER",
        "severity": severity,
        "source": "Regression test",
        "description": "Event created through the REST API.",
    }


def scores(test_client) -> dict[str, int]:
    return {vessel["id"]: vessel["score"] for vessel in test_client.get("/api/v1/vessels").json()}


def persisted_state(sessions, vessel_id: str) -> tuple[int, int | None]:
    with sessions() as database:
        vessel = get_vessel_record(database, vessel_id)
        history = latest_security_score(database, vessel_id)
        return vessel.score, history.score if history else None


def restart(monkeypatch, sessions) -> None:
    monkeypatch.setattr(main, "engine", SimulationEngine(seed=7))
    with sessions() as database:
        main.sync_engine_from_db(database)


def test_repeated_acknowledgement_succeeds(client):
    test_client, sessions, _ = client
    assert test_client.post("/api/security-events", json=event_payload("evt-ack")).status_code == 201

    first = test_client.post("/api/security-events/evt-ack/acknowledge", json={"acknowledged_by": "First Officer"})
    second = test_client.post("/api/security-events/evt-ack/acknowledge", json={"acknowledged_by": "Second Officer"})

    assert first.status_code == second.status_code == 200
    assert second.json()["acknowledged"] is True
    with sessions() as database:
        acknowledgements = database.scalars(select(EventAcknowledgementRecord).where(EventAcknowledgementRecord.event_id == "evt-ack")).all()
    assert [record.acknowledged_by for record in acknowledgements] == ["Second Officer"]


def test_event_for_unknown_vessel_is_rejected_without_side_effects(client):
    test_client, sessions, broadcasts = client
    before = scores(test_client)

    response = test_client.post("/api/security-events", json=event_payload("evt-unknown", vessel_id="no-such-vessel"))

    assert response.status_code == 404
    assert response.json()["detail"] == "Vessel not found"
    with sessions() as database:
        assert get_event(database, "evt-unknown") is None
    assert scores(test_client) == before
    assert broadcasts == []


def test_event_creation_updates_engine_and_persisted_scores(client, monkeypatch):
    test_client, sessions, broadcasts = client
    assert scores(test_client)["calypso"] == 92

    response = test_client.post("/api/security-events", json=event_payload("evt-create"))

    assert response.status_code == 201
    assert scores(test_client)["calypso"] == 72
    assert test_client.get("/security/calypso").json() == {"vessel_id": "calypso", "score": 72, "status": "WARNING"}
    assert persisted_state(sessions, "calypso") == (72, 72)
    assert "evt-create" in {event.event_id for event in main.engine.events}
    assert broadcasts == [("security_event_created", {"event_id": "evt-create", "event_type": "UNKNOWN_DEVICE", "severity": "CRITICAL"}, True)]

    restart(monkeypatch, sessions)
    assert scores(test_client)["calypso"] == 72
    assert persisted_state(sessions, "calypso") == (72, 72)


def test_duplicate_event_id_is_still_a_conflict(client):
    test_client, _, _ = client
    assert test_client.post("/api/security-events", json=event_payload("evt-duplicate")).status_code == 201
    assert test_client.post("/api/security-events", json=event_payload("evt-duplicate")).status_code == 409
    assert scores(test_client)["calypso"] == 72


def test_unlinked_event_deletion_restores_state_and_removes_acknowledgement(client, monkeypatch):
    test_client, sessions, broadcasts = client
    test_client.post("/api/security-events", json=event_payload("evt-delete"))
    test_client.post("/api/security-events/evt-delete/acknowledge", json={"acknowledged_by": "Operator"})
    assert scores(test_client)["calypso"] == 72

    response = test_client.delete("/api/security-events/evt-delete")

    assert response.status_code == 204
    assert test_client.get("/api/security-events/evt-delete").status_code == 404
    with sessions() as database:
        assert database.scalars(select(EventAcknowledgementRecord).where(EventAcknowledgementRecord.event_id == "evt-delete")).all() == []
    assert scores(test_client)["calypso"] == 92
    assert persisted_state(sessions, "calypso") == (92, 92)
    assert "evt-delete" not in {event.event_id for event in main.engine.events}
    assert broadcasts[-1] == ("security_event_deleted", {"event_id": "evt-delete", "vessel_id": "calypso"}, False)

    restart(monkeypatch, sessions)
    assert scores(test_client)["calypso"] == 92
    assert test_client.delete("/api/security-events/evt-delete").status_code == 404


def test_event_linked_to_an_incident_cannot_be_deleted(client):
    test_client, sessions, broadcasts = client
    first = test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "UNAUTHORIZED_ACCESS"})
    second = test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "CAMERA_OFFLINE"})
    incident_id = next(incident["incident_id"] for incident in test_client.get("/api/v1/incidents").json() if incident["vessel_id"] == "calypso")
    linked_event_id = first.json()["event"]["event_id"]
    test_client.post(f"/api/security-events/{linked_event_id}/acknowledge", json={"acknowledged_by": "Operator"})
    evidence_before = test_client.get(f"/api/v1/incidents/{incident_id}").json()["related_event_ids"]
    scores_before = scores(test_client)
    broadcasts.clear()

    response = test_client.delete(f"/api/security-events/{linked_event_id}")

    assert second.status_code == 200
    assert response.status_code == 409
    assert incident_id in response.json()["detail"]
    assert test_client.get(f"/api/security-events/{linked_event_id}").json()["acknowledged"] is True
    assert test_client.get(f"/api/v1/incidents/{incident_id}").json()["related_event_ids"] == evidence_before
    assert linked_event_id in evidence_before
    with sessions() as database:
        assert database.scalars(select(IncidentEventLink).where(IncidentEventLink.event_id == linked_event_id)).all()
    assert scores(test_client) == scores_before
    assert broadcasts == []


def test_failed_creation_leaves_database_engine_and_scores_unchanged(client, monkeypatch):
    test_client, sessions, broadcasts = client
    events_before = [event.event_id for event in main.engine.events]

    def fail(*args, **kwargs):
        raise RuntimeError("score history unavailable")

    monkeypatch.setattr(main, "append_security_score", fail)
    with pytest.raises(RuntimeError):
        test_client.post("/api/security-events", json=event_payload("evt-failed"))

    with sessions() as database:
        assert get_event(database, "evt-failed") is None
    assert [event.event_id for event in main.engine.events] == events_before
    assert next(vessel for vessel in main.engine.vessels if vessel.id == "calypso").score == 92
    assert persisted_state(sessions, "calypso") == (92, 92)
    assert broadcasts == []


def test_failed_deletion_keeps_event_acknowledgement_and_scores(client, monkeypatch):
    test_client, sessions, broadcasts = client
    test_client.post("/api/security-events", json=event_payload("evt-keep"))
    test_client.post("/api/security-events/evt-keep/acknowledge", json={"acknowledged_by": "Operator"})
    broadcasts.clear()

    def fail(*args, **kwargs):
        raise RuntimeError("score history unavailable")

    monkeypatch.setattr(main, "append_security_score", fail)
    with pytest.raises(RuntimeError):
        test_client.delete("/api/security-events/evt-keep")

    with sessions() as database:
        assert get_event(database, "evt-keep") is not None
        assert database.scalars(select(EventAcknowledgementRecord).where(EventAcknowledgementRecord.event_id == "evt-keep")).all()
    assert "evt-keep" in {event.event_id for event in main.engine.events}
    assert next(vessel for vessel in main.engine.vessels if vessel.id == "calypso").score == 72
    assert persisted_state(sessions, "calypso") == (72, 72)
    assert broadcasts == []
