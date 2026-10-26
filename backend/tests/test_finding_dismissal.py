import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.main as main
from db.database import Base, get_db
from db.repositories.security_repository import latest_security_score
from db.repositories.vessel_repository import get_vessel_record
from simulation.simulation_engine import SimulationEngine

VESSEL = "atlantic-trader"
BASE_SCORE = 95


@pytest.fixture()
def client(tmp_path, monkeypatch):
    database_engine = create_engine(f"sqlite:///{tmp_path / 'finding_dismissal.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(database_engine)
    sessions = sessionmaker(bind=database_engine, expire_on_commit=False)
    monkeypatch.setattr(main, "SessionLocal", sessions)
    monkeypatch.setattr(main, "engine", SimulationEngine(seed=7))
    broadcasts: list[tuple[str, dict]] = []

    async def record_broadcast(message_type: str, data: dict) -> None:
        broadcasts.append((message_type, data))

    monkeypatch.setattr(main, "broadcast_status_message", record_broadcast)

    def override_db():
        with sessions() as session:
            yield session

    main.app.dependency_overrides[get_db] = override_db
    with TestClient(main.app) as test_client:
        yield test_client, sessions, broadcasts
    main.app.dependency_overrides.clear()
    database_engine.dispose()


def started_round(test_client) -> tuple[str, str]:
    created = test_client.post("/api/v1/safety-rounds", json={"vessel_id": VESSEL, "round_type": "Security Round"}).json()
    assert test_client.post(f"/api/v1/safety-rounds/{created['round_id']}/start").status_code == 200
    return created["round_id"], created["checkpoints"][0]["checkpoint_id"]


def fail_checkpoint(test_client, round_id: str, checkpoint_id: str) -> None:
    response = test_client.patch(f"/api/v1/safety-rounds/{round_id}/checkpoints/{checkpoint_id}", json={"status": "FAIL", "severity": "HIGH"})
    assert response.status_code == 200


def findings(test_client, round_id: str) -> list[dict]:
    return test_client.get(f"/api/v1/safety-findings?round_id={round_id}").json()


def finding_events(test_client, finding_id: str) -> list[tuple[str, str]]:
    events = test_client.get(f"/api/security-events?vessel_id={VESSEL}&limit=200").json()
    return sorted((event["event_type"], event["status"]) for event in events if event["metadata"].get("finding_id") == finding_id)


def score(test_client) -> int:
    return next(vessel["score"] for vessel in test_client.get("/api/v1/vessels").json() if vessel["id"] == VESSEL)


def persisted_score(sessions) -> tuple[int, int]:
    with sessions() as database:
        return get_vessel_record(database, VESSEL).score, latest_security_score(database, VESSEL).score


def restart(monkeypatch, sessions) -> None:
    monkeypatch.setattr(main, "engine", SimulationEngine(seed=7))
    with sessions() as database:
        main.sync_engine_from_db(database)


def test_dismissed_finding_no_longer_penalizes_the_score(client, monkeypatch):
    test_client, sessions, _ = client
    round_id, checkpoint_id = started_round(test_client)
    fail_checkpoint(test_client, round_id, checkpoint_id)
    finding_id = findings(test_client, round_id)[0]["finding_id"]
    assert score(test_client) == BASE_SCORE - 10

    response = test_client.patch(f"/api/v1/safety-findings/{finding_id}", json={"status": "DISMISSED", "resolution_notes": "Sensor misread; verified on site."})

    assert response.status_code == 200
    assert response.json()["status"] == "DISMISSED"
    assert score(test_client) == BASE_SCORE
    assert persisted_score(sessions) == (BASE_SCORE, BASE_SCORE)
    restart(monkeypatch, sessions)
    assert score(test_client) == BASE_SCORE


def test_dismissal_resolves_linked_events_and_is_recorded_once(client):
    test_client, _, broadcasts = client
    round_id, checkpoint_id = started_round(test_client)
    fail_checkpoint(test_client, round_id, checkpoint_id)
    finding_id = findings(test_client, round_id)[0]["finding_id"]
    broadcasts.clear()

    test_client.patch(f"/api/v1/safety-findings/{finding_id}", json={"status": "DISMISSED", "resolution_notes": "Sensor misread; verified on site."})
    test_client.patch(f"/api/v1/safety-findings/{finding_id}", json={"status": "DISMISSED"})

    assert finding_events(test_client, finding_id) == [("SAFETY_CHECKPOINT_FAILED", "RESOLVED"), ("SAFETY_FINDING_DISMISSED", "RESOLVED")]
    dismissal = next(event for event in test_client.get(f"/api/security-events?event_type=SAFETY_FINDING_DISMISSED&vessel_id={VESSEL}").json())
    assert dismissal["description"] == "Sensor misread; verified on site."
    assert dismissal["metadata"] == {"source": "safety_round", "finding_id": finding_id, "round_id": round_id, "checkpoint_id": checkpoint_id}
    assert [message_type for message_type, _ in broadcasts] == ["safety_finding_updated", "security_event_created", "safety_finding_updated"]


def test_resolution_still_resolves_events_and_records_it(client):
    test_client, _, _ = client
    round_id, checkpoint_id = started_round(test_client)
    fail_checkpoint(test_client, round_id, checkpoint_id)
    finding_id = findings(test_client, round_id)[0]["finding_id"]

    test_client.patch(f"/api/v1/safety-findings/{finding_id}", json={"status": "RESOLVED", "resolution_notes": "Door closer replaced."})

    assert finding_events(test_client, finding_id) == [("SAFETY_CHECKPOINT_FAILED", "RESOLVED"), ("SAFETY_FINDING_RESOLVED", "RESOLVED")]
    assert score(test_client) == BASE_SCORE


def test_checkpoint_failing_again_after_dismissal_opens_a_new_finding(client):
    test_client, _, _ = client
    round_id, checkpoint_id = started_round(test_client)
    fail_checkpoint(test_client, round_id, checkpoint_id)
    dismissed_id = findings(test_client, round_id)[0]["finding_id"]
    test_client.patch(f"/api/v1/safety-findings/{dismissed_id}", json={"status": "DISMISSED"})
    test_client.patch(f"/api/v1/safety-rounds/{round_id}/checkpoints/{checkpoint_id}", json={"status": "PASS", "severity": "INFO"})

    fail_checkpoint(test_client, round_id, checkpoint_id)

    by_id = {finding["finding_id"]: finding["status"] for finding in findings(test_client, round_id)}
    new_id = next(finding_id for finding_id in by_id if finding_id != dismissed_id)
    assert by_id == {dismissed_id: "DISMISSED", new_id: "OPEN"}
    assert finding_events(test_client, dismissed_id) == [("SAFETY_CHECKPOINT_FAILED", "RESOLVED"), ("SAFETY_FINDING_DISMISSED", "RESOLVED")]
    assert finding_events(test_client, new_id) == [("SAFETY_CHECKPOINT_FAILED", "OPEN")]
    assert score(test_client) == BASE_SCORE - 10

    test_client.patch(f"/api/v1/safety-findings/{new_id}", json={"status": "DISMISSED"})
    assert score(test_client) == BASE_SCORE


def test_failed_dismissal_changes_nothing(client, monkeypatch):
    test_client, sessions, broadcasts = client
    round_id, checkpoint_id = started_round(test_client)
    fail_checkpoint(test_client, round_id, checkpoint_id)
    finding_id = findings(test_client, round_id)[0]["finding_id"]
    broadcasts.clear()

    def fail(*args, **kwargs):
        raise RuntimeError("score history unavailable")

    monkeypatch.setattr(main, "append_security_score", fail)
    with pytest.raises(RuntimeError):
        test_client.patch(f"/api/v1/safety-findings/{finding_id}", json={"status": "DISMISSED"})

    assert findings(test_client, round_id)[0]["status"] == "OPEN"
    assert finding_events(test_client, finding_id) == [("SAFETY_CHECKPOINT_FAILED", "OPEN")]
    assert score(test_client) == BASE_SCORE - 10
    assert next(vessel for vessel in main.engine.vessels if vessel.id == VESSEL).score == BASE_SCORE - 10
    assert persisted_score(sessions) == (BASE_SCORE - 10, BASE_SCORE - 10)
    assert broadcasts == []
