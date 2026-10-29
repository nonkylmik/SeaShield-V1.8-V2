"""WebSocket messages from simulation steps and injections are sent only after their database writes commit.

Before this, the engine sent its messages (security_event, incident_created, score changes) as soon as a step or an
injection was generated, so a step whose commit failed was still announced to every client, and "Simulation started"
was broadcast before the scenario's first step had been saved.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.main as main
from db.database import Base, get_db
from db.events import get_event, load_events
from db.repositories.incident_repository import get_incident_record
from simulation.simulation_engine import SimulationEngine


@pytest.fixture()
def client(tmp_path, monkeypatch):
    database_engine = create_engine(f"sqlite:///{tmp_path / 'broadcast_ordering.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(database_engine)
    sessions = sessionmaker(bind=database_engine, expire_on_commit=False)
    monkeypatch.setattr(main, "SessionLocal", sessions)
    monkeypatch.setattr(main, "engine", SimulationEngine(seed=7))
    messages: list[tuple[str, dict, bool | None]] = []

    def committed(message_type: str, data: dict) -> bool | None:
        """Whether the event or incident a message announces is in the database when the message is sent."""
        with sessions() as database:
            if message_type == "security_event":
                return get_event(database, data["event"]["event_id"]) is not None
            if message_type == "incident_created":
                return get_incident_record(database, data["incident"]["incident_id"]) is not None
        return None

    async def engine_broadcast(payload: dict) -> None:
        messages.append((payload["type"], payload["data"], committed(payload["type"], payload["data"])))

    async def route_broadcast(message_type: str, data: dict) -> None:
        # For route messages: how many events are committed when the message is sent.
        with sessions() as database:
            messages.append((message_type, data, len(load_events(database))))

    main.engine.set_broadcaster(engine_broadcast)
    monkeypatch.setattr(main, "broadcast_status_message", route_broadcast)

    def override_db():
        with sessions() as session:
            yield session

    main.app.dependency_overrides[get_db] = override_db
    with TestClient(main.app) as test_client:
        messages.clear()  # startup seeding is not under test
        yield test_client, messages
    main.app.dependency_overrides.clear()
    database_engine.dispose()


def types(messages) -> list[str]:
    return [message_type for message_type, _, _ in messages]


def fail_event_commit(monkeypatch) -> None:
    def fail(*args, **kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(main, "create_event_record", fail)


def test_each_step_is_announced_only_once_its_event_and_incident_are_committed(client):
    test_client, messages = client
    assert test_client.post("/api/v1/simulation/start", json={"scenario": "physical-breach"}).status_code == 200
    assert test_client.post("/api/v1/simulation/next").status_code == 200

    announced = [message for message in messages if message[0] in {"security_event", "incident_created"}]
    assert [message_type for message_type, _, _ in announced] == ["security_event", "security_event", "incident_created"]
    assert all(was_committed for _, _, was_committed in announced)


def test_start_is_announced_after_its_first_step_is_committed(client):
    test_client, messages = client
    before = len(test_client.get("/api/v1/events").json())  # startup seeds demo safety events
    response = test_client.post("/api/v1/simulation/start", json={"scenario": "cyber-intrusion"})

    assert response.status_code == 200
    route_messages = {message_type: (data, events) for message_type, data, events in messages if message_type in {"simulation_status", "notification"}}
    # Both announcements are sent with the first step's event already committed.
    assert route_messages["simulation_status"][1] == route_messages["notification"][1] == before + 1
    # The existing message shape, now describing the state after the committed first step.
    assert route_messages["simulation_status"][0] == {"scenario": "cyber-intrusion", "status": "RUNNING", "index": 1}
    assert response.json()["status"] == "RUNNING"


def test_injection_is_announced_only_once_committed(client):
    test_client, messages = client
    response = test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "FIRE_ALARM"})

    assert response.status_code == 200
    event_messages = [message for message in messages if message[0] == "security_event"]
    assert len(event_messages) == 1
    assert event_messages[0][1]["event"]["event_id"] == response.json()["event"]["event_id"]
    assert event_messages[0][2] is True
    assert "security_score_changed" in types(messages)


def test_a_step_whose_commit_fails_is_not_announced(client, monkeypatch):
    test_client, messages = client
    assert test_client.post("/api/v1/simulation/start", json={"scenario": "cyber-intrusion"}).status_code == 200
    messages.clear()
    fail_event_commit(monkeypatch)

    with pytest.raises(RuntimeError):
        test_client.post("/api/v1/simulation/next")

    assert messages == []


def test_an_injection_whose_commit_fails_is_not_announced(client, monkeypatch):
    test_client, messages = client
    fail_event_commit(monkeypatch)

    with pytest.raises(RuntimeError):
        test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "FIRE_ALARM"})

    assert messages == []
    assert test_client.get("/api/v1/events?vessel_id=calypso").json() == []


def test_a_start_whose_first_step_fails_is_not_announced(client, monkeypatch):
    test_client, messages = client
    fail_event_commit(monkeypatch)

    with pytest.raises(RuntimeError):
        test_client.post("/api/v1/simulation/start", json={"scenario": "fire-emergency"})

    assert messages == []


def test_an_injection_whose_incident_cannot_be_saved_is_not_announced(client, monkeypatch):
    # The event commits first and the correlated incident is saved afterwards; if that later write fails, the request
    # fails and nothing is announced (clients see the committed event on their next refresh).
    test_client, messages = client
    assert test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "UNAUTHORIZED_ACCESS"}).status_code == 200
    messages.clear()

    def fail(*args, **kwargs):
        raise RuntimeError("incident store unavailable")

    monkeypatch.setattr(main, "create_incident_record", fail)
    with pytest.raises(RuntimeError):
        test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "CAMERA_OFFLINE"})

    assert messages == []


def test_rejected_injections_send_nothing(client):
    test_client, messages = client
    assert test_client.post("/api/v1/simulation/inject", json={"vessel_id": "no-such-vessel", "event_type": "FIRE_ALARM"}).status_code == 404
    assert test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "NOT_A_TYPE"}).status_code == 400
    assert messages == []


def test_a_step_without_an_active_scenario_returns_null_and_sends_nothing(client):
    test_client, messages = client
    response = test_client.post("/api/v1/simulation/next")

    assert response.status_code == 200
    assert response.json() is None
    assert messages == []
