from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.main as main
from db.database import Base, get_db
from db.models import SecurityEventRecord
from db.repositories.vessel_repository import get_vessel_record, record_vessel_communication
from simulation.simulation_engine import SimulationEngine

VESSEL_IDS = ("atlantic-trader", "baltic-guardian", "calypso", "iron-horizon", "northern-star", "ocean-sentinel")
OLD = datetime(2026, 1, 1, tzinfo=timezone.utc)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    database_engine = create_engine(f"sqlite:///{tmp_path / 'vessel_communication.db'}", connect_args={"check_same_thread": False})
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


def utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def set_all_communication(sessions, at: datetime) -> None:
    """Puts every vessel's last communication at a known instant, as data recorded earlier would be."""
    with sessions() as database:
        for vessel_id in VESSEL_IDS:
            get_vessel_record(database, vessel_id).last_communication = at
        database.commit()


def communication(sessions) -> dict[str, datetime]:
    with sessions() as database:
        return {vessel_id: utc(get_vessel_record(database, vessel_id).last_communication) for vessel_id in VESSEL_IDS}


def event_payload(event_id: str, timestamp: datetime, vessel_id: str = "calypso") -> dict:
    return {"event_id": event_id, "timestamp": timestamp.isoformat(), "vessel_id": vessel_id, "event_type": "UNKNOWN_DEVICE", "category": "CYBER", "severity": "HIGH", "source": "test", "description": "test"}


def test_an_event_updates_only_its_own_vessel(client):
    test_client, sessions = client
    set_all_communication(sessions, OLD)
    before_request = datetime.now(timezone.utc)

    assert test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "FIRE_ALARM"}).status_code == 200

    after = communication(sessions)
    assert before_request <= after["calypso"] <= datetime.now(timezone.utc)
    assert {vessel_id: at for vessel_id, at in after.items() if vessel_id != "calypso"} == {vessel_id: OLD for vessel_id in VESSEL_IDS if vessel_id != "calypso"}


def test_score_recalculation_sync_and_reset_do_not_change_any_timestamp(client, monkeypatch):
    test_client, sessions = client
    test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "FIRE_ALARM"})
    set_all_communication(sessions, OLD)

    with sessions() as database:
        main.sync_engine_from_db(database)
    assert test_client.post("/api/v1/simulation/reset").status_code == 200
    monkeypatch.setattr(main, "engine", SimulationEngine(seed=7))
    with sessions() as database:
        main.sync_engine_from_db(database)

    assert communication(sessions) == {vessel_id: OLD for vessel_id in VESSEL_IDS}


def test_ingested_event_uses_its_own_timestamp_and_never_rewinds(client):
    test_client, sessions = client
    set_all_communication(sessions, OLD)
    observed = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)

    assert test_client.post("/api/security-events", json=event_payload("evt-june", observed)).status_code == 201
    assert communication(sessions)["calypso"] == observed

    assert test_client.post("/api/security-events", json=event_payload("evt-backfill", observed - timedelta(days=30))).status_code == 201
    assert communication(sessions)["calypso"] == observed


def test_future_dated_event_is_clamped_to_the_current_time(client):
    test_client, sessions = client
    set_all_communication(sessions, OLD)

    test_client.post("/api/security-events", json=event_payload("evt-future", datetime.now(timezone.utc) + timedelta(days=2)))

    assert OLD < communication(sessions)["calypso"] <= datetime.now(timezone.utc)


def test_safety_round_report_counts_as_communication_from_that_vessel(client):
    test_client, sessions = client
    created = test_client.post("/api/v1/safety-rounds", json={"vessel_id": "atlantic-trader", "round_type": "Security Round"}).json()
    set_all_communication(sessions, OLD)

    test_client.post(f"/api/v1/safety-rounds/{created['round_id']}/start")

    after = communication(sessions)
    assert after["atlantic-trader"] > OLD
    assert all(at == OLD for vessel_id, at in after.items() if vessel_id != "atlantic-trader")


def test_event_deletion_does_not_change_the_timestamp(client):
    test_client, sessions = client
    observed = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    set_all_communication(sessions, OLD)
    test_client.post("/api/security-events", json=event_payload("evt-delete", observed))

    assert test_client.delete("/api/security-events/evt-delete").status_code == 204

    assert communication(sessions)["calypso"] == observed


def test_failed_ingest_leaves_the_timestamp_unchanged(client, monkeypatch):
    test_client, sessions = client
    set_all_communication(sessions, OLD)

    def fail(*args, **kwargs):
        raise RuntimeError("score history unavailable")

    monkeypatch.setattr(main, "append_security_score", fail)
    with pytest.raises(RuntimeError):
        test_client.post("/api/security-events", json=event_payload("evt-failed", datetime(2026, 6, 1, tzinfo=timezone.utc)))

    assert communication(sessions)["calypso"] == OLD


def test_api_reports_the_recorded_timestamp(client):
    test_client, sessions = client
    observed = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    set_all_communication(sessions, OLD)
    test_client.post("/api/security-events", json=event_payload("evt-api", observed))

    listed = {vessel["id"]: vessel["last_communication"] for vessel in test_client.get("/api/v1/vessels").json()}

    assert utc(datetime.fromisoformat(listed["calypso"])) == observed
    assert utc(datetime.fromisoformat(listed["iron-horizon"])) == OLD


def test_unknown_vessel_is_ignored():
    class NoVessels:
        def scalar(self, _query):
            return None

    assert record_vessel_communication(NoVessels(), "no-such-vessel", OLD) is None


def fail_communication_update(monkeypatch) -> None:
    def fail(*args, **kwargs):
        raise RuntimeError("communication update failed")

    monkeypatch.setattr(main, "record_vessel_communication", fail)


def test_failed_communication_update_discards_the_simulated_event(client, monkeypatch):
    test_client, sessions = client
    set_all_communication(sessions, OLD)
    events_before = test_client.get("/api/security-events?vessel_id=calypso&limit=500").json()
    engine_events_before = [event.event_id for event in main.engine.events]
    score_before = test_client.get("/security/calypso").json()
    fail_communication_update(monkeypatch)

    with pytest.raises(RuntimeError):
        test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "FIRE_ALARM"})

    assert test_client.get("/api/security-events?vessel_id=calypso&limit=500").json() == events_before
    assert [event.event_id for event in main.engine.events] == engine_events_before
    assert next(vessel for vessel in main.engine.vessels if vessel.id == "calypso").score == score_before["score"]
    assert test_client.get("/security/calypso").json() == score_before
    assert communication(sessions)["calypso"] == OLD


def test_failed_communication_update_discards_the_safety_round_report(client, monkeypatch):
    test_client, sessions = client
    created = test_client.post("/api/v1/safety-rounds", json={"vessel_id": "atlantic-trader", "round_type": "Security Round"}).json()
    set_all_communication(sessions, OLD)
    fail_communication_update(monkeypatch)

    with pytest.raises(RuntimeError):
        test_client.post(f"/api/v1/safety-rounds/{created['round_id']}/start")

    assert test_client.get(f"/api/v1/safety-rounds/{created['round_id']}").json()["status"] == "PLANNED"
    assert test_client.get("/api/security-events?vessel_id=atlantic-trader&event_type=SAFETY_ROUND_STARTED").json() == []
    assert communication(sessions)["atlantic-trader"] == OLD


def test_safety_report_committed_on_its_own_includes_the_communication_time(client, monkeypatch):
    _, sessions = client
    set_all_communication(sessions, OLD)
    report = {"vessel_id": "calypso", "event_type": "SAFETY_FINDING_CREATED", "title": "Report", "description": "Report", "severity": "INFO", "commit": True}
    real_record_vessel_communication = main.record_vessel_communication

    fail_communication_update(monkeypatch)
    with sessions() as database, pytest.raises(RuntimeError):
        main.create_safety_event_record(database, **report)
    with sessions() as database:
        assert database.query(SecurityEventRecord).filter_by(event_type="SAFETY_FINDING_CREATED").count() == 0
    assert communication(sessions)["calypso"] == OLD

    monkeypatch.setattr(main, "record_vessel_communication", real_record_vessel_communication)
    with sessions() as database:
        main.create_safety_event_record(database, **report)
    with sessions() as database:
        assert database.query(SecurityEventRecord).filter_by(event_type="SAFETY_FINDING_CREATED").count() == 1
    assert communication(sessions)["calypso"] > OLD
