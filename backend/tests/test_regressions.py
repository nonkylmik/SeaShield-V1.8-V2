from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.main as main
from db.database import Base, get_db
from db.events import get_event
from db.repositories.security_repository import list_security_score_history
from models.events import EventCategory, SecurityEvent, Severity
from security_engine.event_correlation import correlate
from simulation.simulation_engine import SimulationEngine


@pytest.fixture()
def client(tmp_path, monkeypatch):
    database_engine = create_engine(f"sqlite:///{tmp_path / 'regressions.db'}", connect_args={"check_same_thread": False})
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


def test_injection_targets_selected_vessel_and_persists_unique_events(client):
    test_client, sessions = client
    first = test_client.post(
        "/api/v1/simulation/inject",
        json={"vessel_id": "ocean-sentinel", "event_type": "FIRE_ALARM"},
    )
    second = test_client.post(
        "/api/v1/simulation/inject",
        json={"vessel_id": "ocean-sentinel", "event_type": "FIRE_ALARM"},
    )
    assert first.status_code == second.status_code == 200
    assert first.json()["event"]["vessel_id"] == "ocean-sentinel"
    assert first.json()["event"]["event_id"] != second.json()["event"]["event_id"]
    with sessions() as database:
        assert get_event(database, first.json()["event"]["event_id"]) is not None
        assert get_event(database, second.json()["event"]["event_id"]) is not None
        calypso_history = list_security_score_history(database, "ocean-sentinel")
        untouched_history = list_security_score_history(database, "baltic-guardian")
    assert [entry.score for entry in calypso_history] == [52, 72, 92]
    assert len(untouched_history) == 1


def test_injection_validates_vessel_and_event_type(client):
    test_client, _ = client
    assert test_client.post(
        "/api/v1/simulation/inject",
        json={"vessel_id": "unknown", "event_type": "FIRE_ALARM"},
    ).status_code == 404
    assert test_client.post(
        "/api/v1/simulation/inject",
        json={"vessel_id": "ocean-sentinel", "event_type": "NOT_AN_EVENT"},
    ).status_code == 400


def test_simulation_reset_preserves_history_and_restores_baseline(client):
    test_client, _ = client
    injected = test_client.post(
        "/api/v1/simulation/inject",
        json={"vessel_id": "calypso", "event_type": "FIRE_ALARM"},
    )
    event_id = injected.json()["event"]["event_id"]
    assert test_client.get("/security/calypso").json()["score"] < 92

    reset = test_client.post("/api/v1/simulation/reset")
    assert reset.status_code == 200
    assert test_client.get("/security/calypso").json()["score"] == 92
    event = test_client.get(f"/api/security-events/{event_id}")
    assert event.status_code == 200
    assert event.json()["status"] == "RESOLVED"


def test_triggered_event_does_not_reuse_unrelated_correlation_rule():
    timestamp = datetime.now(timezone.utc)
    events = [
        SecurityEvent(event_id=f"event-{index}", timestamp=timestamp, vessel_id="vessel", event_type=event_type, category=category, severity=Severity.HIGH, source="test", description=event_type)
        for index, (event_type, category) in enumerate([
            ("UNKNOWN_DEVICE", EventCategory.CYBER),
            ("FAILED_AUTHENTICATION", EventCategory.CYBER),
            ("SUSPICIOUS_TRAFFIC", EventCategory.CYBER),
            ("UNAUTHORIZED_ACCESS", EventCategory.PHYSICAL),
            ("CAMERA_OFFLINE", EventCategory.PHYSICAL),
        ])
    ]
    result = correlate(events, "vessel", trigger_event_type="CAMERA_OFFLINE")
    assert result is not None
    assert result.title == "Potential Physical Security Breach"
