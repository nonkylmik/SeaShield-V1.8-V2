from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from db.database import Base, get_db
from db.events import get_event
from models.events import EventCategory, SecurityEvent, Severity


@pytest.fixture()
def database(tmp_path):
    database_engine = create_engine(f"sqlite:///{tmp_path / 'events.db'}")
    Base.metadata.create_all(database_engine)
    sessions = sessionmaker(bind=database_engine, expire_on_commit=False)
    yield sessions
    Base.metadata.drop_all(database_engine)


def test_event_survives_fresh_database_session(database):
    event = SecurityEvent(event_id="persisted-1", timestamp=datetime.now(timezone.utc), vessel_id="calypso", event_type="FIREWALL_BLOCK", category=EventCategory.CYBER, severity=Severity.HIGH, source="Firewall", description="Stored event")
    from db.events import create_event
    with database() as first_session:
        create_event(first_session, event, "cyber-intrusion")
    with database() as fresh_session:
        stored = get_event(fresh_session, "persisted-1")
    assert stored is not None
    assert stored.event_type == event.event_type
    assert stored.scenario == "cyber-intrusion"


def test_security_event_api_supports_create_filter_and_not_found(database):
    def override_db():
        with database() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            response = client.post("/api/security-events", json={"event_id": "api-1", "timestamp": "2026-09-03T12:00:00Z", "vessel_id": "calypso", "event_type": "UNKNOWN_DEVICE", "category": "CYBER", "severity": "HIGH", "source": "Network Monitor", "description": "Unknown device", "scenario": "cyber-intrusion"})
            assert response.status_code == 201
            assert response.json()["event_id"] == "api-1"
            filtered = client.get("/api/security-events?severity=HIGH&scenario=cyber-intrusion")
            assert filtered.status_code == 200
            assert [item["event_id"] for item in filtered.json()] == ["api-1"]
            assert client.get("/api/security-events/missing").status_code == 404
    finally:
        app.dependency_overrides.clear()
