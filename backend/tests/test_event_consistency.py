from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

import app.main as main
from db.database import Base, get_db
from db.events import get_event
from db.models import EventAcknowledgementRecord, IncidentEventLink, IncidentRecord
from db.repositories.event_repository import create_event_record
from db.repositories.incident_repository import MissingIncidentEvidence, create_incident_record
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
    assert test_client.get("/security/calypso").json() == {"vessel_id": "calypso", "score": 72, "status": "ELEVATED"}
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


@pytest.fixture()
def engine_messages(client):
    """Records the engine's own notifications together with the score committed when each was sent."""
    _, sessions, _ = client
    messages: list[tuple[str, dict, int | None]] = []

    async def record(payload: dict) -> None:
        committed = None
        if payload["type"] == "security_score_changed":
            with sessions() as database:
                committed = get_vessel_record(database, payload["data"]["vessel_id"]).score
        messages.append((payload["type"], payload["data"], committed))

    main.engine.set_broadcaster(record)
    return messages


def add_link(sessions, incident_id: str, event_id: str) -> None:
    """Commits an incident link from a separate session, as a concurrent request would."""
    with sessions() as database:
        database.add(IncidentRecord(incident_id=incident_id, vessel_id="calypso", type="Concurrent", title="Concurrent", severity="HIGH", description="Linked by a concurrent request."))
        database.add(IncidentEventLink(incident_id=incident_id, event_id=event_id))
        database.commit()


def test_score_notifications_are_sent_only_after_commit(client, engine_messages):
    test_client, _, _ = client

    assert test_client.post("/api/security-events", json=event_payload("evt-notify")).status_code == 201

    score_messages = [message for message in engine_messages if message[0] == "security_score_changed"]
    assert score_messages == [("security_score_changed", {"vessel_id": "calypso", "score": 72, "status": "ELEVATED"}, 72)]


def test_rolled_back_change_sends_no_score_notifications(client, engine_messages, monkeypatch):
    test_client, sessions, _ = client

    def fail(*args, **kwargs):
        raise RuntimeError("score history unavailable")

    monkeypatch.setattr(main, "append_security_score", fail)
    with pytest.raises(RuntimeError):
        test_client.post("/api/security-events", json=event_payload("evt-rolled-back"))

    assert engine_messages == []
    assert next(vessel for vessel in main.engine.vessels if vessel.id == "calypso").score == 92
    assert persisted_state(sessions, "calypso") == (92, 92)


def test_simulation_injection_still_notifies_immediately(client, engine_messages):
    test_client, _, _ = client

    assert test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "FIRE_ALARM"}).status_code == 200

    types = [message[0] for message in engine_messages]
    assert "security_event" in types
    assert ("security_score_changed", {"vessel_id": "calypso", "score": 72, "status": "ELEVATED"}) in [(message[0], message[1]) for message in engine_messages]


def test_link_committed_concurrently_blocks_deletion(client, monkeypatch):
    test_client, sessions, broadcasts = client
    test_client.post("/api/security-events", json=event_payload("evt-race"))
    test_client.post("/api/security-events/evt-race/acknowledge", json={"acknowledged_by": "Operator"})
    broadcasts.clear()
    real_delete = main.delete_event_record

    def delete_after_concurrent_link(database, event_id, **kwargs):
        # The link commits after the route's existence check but before the deletion takes the write lock.
        add_link(sessions, "INC-RACE", event_id)
        return real_delete(database, event_id, **kwargs)

    monkeypatch.setattr(main, "delete_event_record", delete_after_concurrent_link)
    response = test_client.delete("/api/security-events/evt-race")

    assert response.status_code == 409
    assert "INC-RACE" in response.json()["detail"]
    with sessions() as database:
        assert get_event(database, "evt-race") is not None
        assert database.scalars(select(IncidentEventLink).where(IncidentEventLink.event_id == "evt-race")).all()
        assert database.scalars(select(EventAcknowledgementRecord).where(EventAcknowledgementRecord.event_id == "evt-race")).all()
    assert "evt-race" in {event.event_id for event in main.engine.events}
    assert scores(test_client)["calypso"] == 72
    assert broadcasts == []


def test_incident_cannot_link_an_event_deleted_concurrently(client):
    _, sessions, _ = client
    with sessions() as database:
        create_event_record(database, event_id="evt-kept", timestamp=datetime.now(timezone.utc), vessel_id="calypso", event_type="UNAUTHORIZED_ACCESS", category="PHYSICAL", severity="HIGH", source="test", description="kept")
        with pytest.raises(MissingIncidentEvidence):
            create_incident_record(database, incident_id="INC-NEW", vessel_id="calypso", type="Breach", title="Breach", severity="HIGH", description="new", related_event_ids=["evt-kept", "evt-deleted"])
        assert database.scalar(select(IncidentRecord).where(IncidentRecord.incident_id == "INC-NEW")) is None

        create_incident_record(database, incident_id="INC-EXISTING", vessel_id="calypso", type="Breach", title="Breach", severity="HIGH", description="existing", related_event_ids=["evt-kept"])
        with pytest.raises(MissingIncidentEvidence):
            create_incident_record(database, incident_id="INC-EXISTING", vessel_id="calypso", type="Breach", title="Breach", severity="HIGH", description="existing", related_event_ids=["evt-kept", "evt-deleted"])
        links = database.scalars(select(IncidentEventLink.event_id).where(IncidentEventLink.incident_id.in_(["INC-NEW", "INC-EXISTING"]))).all()
    assert links == ["evt-kept"]


def test_concurrent_duplicate_event_id_returns_conflict(client, engine_messages, monkeypatch):
    test_client, sessions, broadcasts = client
    assert test_client.post("/api/security-events", json=event_payload("evt-concurrent", severity="LOW")).status_code == 201
    engine_messages.clear()
    broadcasts.clear()
    real_get_event = main.get_event
    calls = 0

    def miss_first_lookup(database, event_id):
        # The duplicate check runs before the concurrent request's insert becomes visible.
        nonlocal calls
        calls += 1
        return None if calls == 1 else real_get_event(database, event_id)

    monkeypatch.setattr(main, "get_event", miss_first_lookup)
    response = test_client.post("/api/security-events", json=event_payload("evt-concurrent", severity="CRITICAL"))

    assert response.status_code == 409
    assert response.json()["detail"] == "Event ID already exists"
    with sessions() as database:
        assert get_event(database, "evt-concurrent").severity == "LOW"
    assert scores(test_client)["calypso"] == 90
    assert persisted_state(sessions, "calypso") == (90, 90)
    assert [event.event_id for event in main.engine.events].count("evt-concurrent") == 1
    assert engine_messages == []
    assert broadcasts == []


def test_event_deleted_concurrently_returns_not_found_without_broadcast(client, monkeypatch):
    test_client, sessions, broadcasts = client
    test_client.post("/api/security-events", json=event_payload("evt-gone"))
    broadcasts.clear()
    real_delete = main.delete_event_record

    def delete_after_concurrent_delete(database, event_id, **kwargs):
        with sessions() as concurrent:
            real_delete(concurrent, event_id)
        return real_delete(database, event_id, **kwargs)

    monkeypatch.setattr(main, "delete_event_record", delete_after_concurrent_delete)
    response = test_client.delete("/api/security-events/evt-gone")

    assert response.status_code == 404
    assert broadcasts == []


def test_failed_commit_after_queued_score_notifications_publishes_nothing(client, engine_messages, monkeypatch):
    test_client, sessions, broadcasts = client
    real_commit = Session.commit
    failures = []

    def commit_fails_once(session):
        # The first commit is the one in commit_with_engine_sync, after the score change was queued.
        if not failures:
            failures.append(True)
            raise OperationalError("COMMIT", {}, Exception("database is locked"))
        return real_commit(session)

    monkeypatch.setattr(Session, "commit", commit_fails_once)
    with pytest.raises(OperationalError):
        test_client.post("/api/security-events", json=event_payload("evt-commit-fails"))

    assert failures == [True]
    assert engine_messages == []
    assert broadcasts == []
    with sessions() as database:
        assert get_event(database, "evt-commit-fails") is None
    assert "evt-commit-fails" not in {event.event_id for event in main.engine.events}
    assert next(vessel for vessel in main.engine.vessels if vessel.id == "calypso").score == 92
    assert persisted_state(sessions, "calypso") == (92, 92)

    # The next successful commit publishes the expected notification for committed state only.
    assert test_client.post("/api/security-events", json=event_payload("evt-commit-succeeds")).status_code == 201
    assert [message for message in engine_messages if message[0] == "security_score_changed"] == [
        ("security_score_changed", {"vessel_id": "calypso", "score": 72, "status": "ELEVATED"}, 72)
    ]
