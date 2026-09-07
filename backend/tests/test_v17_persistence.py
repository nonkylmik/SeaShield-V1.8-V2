from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from db.database import Base, get_db
from db.repositories.event_repository import create_event_record, list_event_records
from db.repositories.incident_repository import create_incident_record, get_incident_record
from db.repositories.security_repository import append_security_score
from db.repositories.vessel_repository import upsert_vessel_record


@pytest.fixture()
def test_database(tmp_path):
    database_engine = create_engine(f"sqlite:///{tmp_path / 'v17.db'}")
    Base.metadata.create_all(database_engine)
    sessions = sessionmaker(bind=database_engine, expire_on_commit=False)
    yield sessions
    Base.metadata.drop_all(database_engine)


def test_vessel_event_incident_and_score_history_persist(test_database):
    def override_db():
        with test_database() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            with test_database() as session:
                vessel = upsert_vessel_record(
                    session,
                    vessel_id="baltic-guardian",
                    name="MV Baltic Guardian",
                    imo="IMO 9384751",
                    base_score=96,
                    score=87,
                    status="WARNING",
                )
                assert vessel.score == 87

                event = create_event_record(
                    session,
                    event_id="persisted-v17-1",
                    timestamp=datetime.now(timezone.utc),
                    vessel_id="baltic-guardian",
                    event_type="FAILED_AUTHENTICATION",
                    category="CYBER",
                    severity="HIGH",
                    source="Identity Monitor",
                    description="Persisted failure",
                    scenario="cyber-intrusion",
                    status="OPEN",
                )
                incident = create_incident_record(
                    session,
                    incident_id="INC-2000",
                    vessel_id="baltic-guardian",
                    title="Potential Network Intrusion",
                    type="Potential Network Intrusion",
                    severity="CRITICAL",
                    description="Multiple cyber indicators",
                    related_event_ids=[event.event_id],
                )
                append_security_score(
                    session,
                    vessel_id="baltic-guardian",
                    score=81,
                    previous_score=87,
                    reason="Incident correlation",
                )

                stored_events = list_event_records(session, limit=10, offset=0, vessel_id="baltic-guardian")
                stored_incident = get_incident_record(session, "INC-2000")
                assert len(stored_events) == 1
                assert stored_incident is not None
                assert stored_incident.vessel_id == "baltic-guardian"

            response = client.get("/api/security-events?limit=10&vessel_id=baltic-guardian")
            assert response.status_code == 200
            assert response.json()[0]["event_id"] == "persisted-v17-1"
    finally:
        app.dependency_overrides.clear()
