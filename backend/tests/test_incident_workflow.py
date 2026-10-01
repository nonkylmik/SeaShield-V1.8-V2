from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from db.database import Base, get_db


def test_manual_incident_edits_notes_and_acknowledgement_persist(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'workflow.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)

    def override_db():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            payload = {
                "vessel_id": "calypso",
                "type": "MANUAL",
                "title": "Inspection follow-up",
                "severity": "HIGH",
                "description": "Operator-created case",
                "assigned_operator": "Deck Officer",
            }
            first = client.post("/api/v1/incidents", json=payload)
            second = client.post("/api/v1/incidents", json={**payload, "title": "Second case"})
            assert first.status_code == 201, first.text
            assert second.status_code == 201, second.text
            incident_id = first.json()["incident_id"]
            assert incident_id != second.json()["incident_id"]

            updated = client.patch(
                f"/api/v1/incidents/{incident_id}",
                json={"status": "INVESTIGATING", "severity": "CRITICAL", "assigned_operator": "Chief Officer", "actor": "J. Dawson"},
            )
            assert updated.status_code == 200, updated.text
            note = client.post(f"/api/v1/incidents/{incident_id}/notes", json={"author": "Chief Officer", "body": "Exit cleared."})
            assert note.status_code == 201, note.text

            refreshed = client.get(f"/api/v1/incidents/{incident_id}")
            body = refreshed.json()
            assert body["status"] == "INVESTIGATING"
            assert body["severity"] == "CRITICAL"
            assert body["assigned_operator"] == "Chief Officer"
            assert body["notes"][0]["body"] == "Exit cleared."
            assert any("severity" in item["text"] for item in body["timeline"])

            event = client.post(
                "/api/security-events",
                json={
                    "event_id": "ack-test-1",
                    "timestamp": "2026-10-01T12:00:00Z",
                    "vessel_id": "calypso",
                    "event_type": "TEST_EVENT",
                    "category": "PHYSICAL",
                    "severity": "LOW",
                    "source": "test",
                    "description": "Acknowledgement test",
                },
            )
            assert event.status_code == 201
            acknowledged = client.post("/api/security-events/ack-test-1/acknowledge", json={"acknowledged_by": "Deck Officer"})
            assert acknowledged.status_code == 200
            assert acknowledged.json()["acknowledged"] is True
            listed = client.get("/api/security-events?event_type=TEST_EVENT")
            assert listed.json()[0]["acknowledged"] is True
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
