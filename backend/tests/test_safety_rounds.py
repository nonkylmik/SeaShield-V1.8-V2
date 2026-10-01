from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app, seed_safety_demo_data
from db.database import Base, get_db
from db.repositories.safety_repository import create_safety_round, get_safety_round, list_safety_findings, list_safety_rounds


@pytest.fixture()
def database(tmp_path):
    database_engine = create_engine(f"sqlite:///{tmp_path / 'safety.db'}")
    Base.metadata.create_all(database_engine)
    sessions = sessionmaker(bind=database_engine, expire_on_commit=False)
    yield sessions
    Base.metadata.drop_all(database_engine)


def test_round_creation_uses_template_and_generation(database):
    def override_db():
        with database() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/safety-rounds",
                json={
                    "vessel_id": "baltic-guardian",
                    "round_type": "General Safety Round",
                    "assigned_to": "Deck Officer",
                    "planned_start": "2026-09-12T18:00:00Z",
                    "notes": "Evening watch",
                },
            )
            assert response.status_code == 201, response.text
            payload = response.json()
            assert payload["round_id"].startswith("SR-2026-")
            assert payload["status"] == "PLANNED"
            assert len(payload["checkpoints"]) >= 3
            assert payload["checkpoints"][0]["status"] == "NOT_CHECKED"
    finally:
        app.dependency_overrides.clear()


def test_checkpoint_and_finding_flow(database):
    def override_db():
        with database() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            created = client.post(
                "/api/v1/safety-rounds",
                json={
                    "vessel_id": "baltic-guardian",
                    "round_type": "Security Round",
                    "assigned_to": "Security Officer",
                    "planned_start": "2026-09-12T19:00:00Z",
                },
            )
            round_id = created.json()["round_id"]
            checkpoints = created.json()["checkpoints"]
            first = checkpoints[0]
            second = checkpoints[1]

            response = client.patch(
                f"/api/v1/safety-rounds/{round_id}/checkpoints/{first['checkpoint_id']}",
                json={"status": "FAIL", "severity": "HIGH", "notes": "Door obstructed", "completed_by": "Security Officer"},
            )
            assert response.status_code == 200, response.text
            second_response = client.patch(
                f"/api/v1/safety-rounds/{round_id}/checkpoints/{second['checkpoint_id']}",
                json={"status": "PASS", "severity": "INFO", "notes": "Clear", "completed_by": "Security Officer"},
            )
            assert second_response.status_code == 200

            for checkpoint in checkpoints[2:]:
                patch = client.patch(
                    f"/api/v1/safety-rounds/{round_id}/checkpoints/{checkpoint['checkpoint_id']}",
                    json={"status": "NOT_APPLICABLE", "severity": "INFO", "notes": "Not relevant", "completed_by": "Security Officer"},
                )
                assert patch.status_code == 200, patch.text

            finding_response = client.get(f"/api/v1/safety-findings?round_id={round_id}")
            assert finding_response.status_code == 200
            assert len(finding_response.json()) >= 1
            payload = finding_response.json()[0]
            assert payload["severity"] == "HIGH"

            complete = client.post(f"/api/v1/safety-rounds/{round_id}/complete")
            assert complete.status_code == 200
            assert complete.json()["status"] == "COMPLETED"
    finally:
        app.dependency_overrides.clear()


def test_invalid_transition_is_rejected(database):
    def override_db():
        with database() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            created = client.post(
                "/api/v1/safety-rounds",
                json={
                    "vessel_id": "ocean-sentinel",
                    "round_type": "Fire Safety Round",
                    "assigned_to": "Officer of the Watch",
                    "planned_start": "2026-09-12T20:00:00Z",
                },
            )
            round_id = created.json()["round_id"]
            response = client.post(f"/api/v1/safety-rounds/{round_id}/complete")
            assert response.status_code == 400
            assert "required checkpoints" in response.json()["detail"].lower()
    finally:
        app.dependency_overrides.clear()


def test_cancelled_round_rejects_start_and_repeat_cancel(database):
    def override_db():
        with database() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            created = client.post(
                "/api/v1/safety-rounds",
                json={
                    "vessel_id": "ocean-sentinel",
                    "round_type": "Security Round",
                },
            )
            assert created.status_code == 201, created.text
            round_id = created.json()["round_id"]

            cancelled = client.post(f"/api/v1/safety-rounds/{round_id}/cancel")
            assert cancelled.status_code == 200, cancelled.text
            assert client.post(f"/api/v1/safety-rounds/{round_id}/start").status_code == 409
            assert client.post(f"/api/v1/safety-rounds/{round_id}/cancel").status_code == 409
    finally:
        app.dependency_overrides.clear()


def test_checkpoint_patch_validates_values_and_preserves_omitted_fields(database):
    def override_db():
        with database() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            created = client.post(
                "/api/v1/safety-rounds",
                json={"vessel_id": "ocean-sentinel", "round_type": "Security Round"},
            )
            assert created.status_code == 201, created.text
            round_id = created.json()["round_id"]
            checkpoint_id = created.json()["checkpoints"][0]["checkpoint_id"]
            url = f"/api/v1/safety-rounds/{round_id}/checkpoints/{checkpoint_id}"

            assert client.patch(url, json={"status": "MAYBE"}).status_code == 422
            assert client.patch(url, json={"severity": "BOGUS"}).status_code == 422
            assert client.patch(url, json={"status": "WARNING", "severity": "MEDIUM", "notes": "Loose fitting"}).status_code == 200
            updated = client.patch(url, json={"completed_by": "Deck Officer"})
            assert updated.status_code == 200
            assert updated.json()["status"] == "WARNING"
            assert updated.json()["severity"] == "MEDIUM"
            assert updated.json()["notes"] == "Loose fitting"
    finally:
        app.dependency_overrides.clear()


def test_templates_and_vessel_validation(database):
    def override_db():
        with database() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            templates = client.get("/api/v1/safety-round-templates")
            assert templates.status_code == 200
            evening = next(item for item in templates.json() if item["name"] == "Evening Safety & Security Round")
            assert [item["name"] for item in evening["checkpoints"][:5]] == [
                "Emergency Exit",
                "Fire Extinguisher",
                "CCTV",
                "Restricted Access",
                "Deck Condition",
            ]
            invalid = client.post(
                "/api/v1/safety-rounds",
                json={"vessel_id": "not-a-vessel", "round_type": "Security Round"},
            )
            assert invalid.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_checkpoint_failures_persist_unique_events_and_findings(database):
    def override_db():
        with database() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            created = client.post(
                "/api/v1/safety-rounds",
                json={"vessel_id": "ocean-sentinel", "round_type": "Security Round"},
            )
            assert created.status_code == 201, created.text
            round_id = created.json()["round_id"]
            checkpoints = created.json()["checkpoints"][:2]
            for checkpoint in checkpoints:
                response = client.patch(
                    f"/api/v1/safety-rounds/{round_id}/checkpoints/{checkpoint['checkpoint_id']}",
                    json={"status": "FAIL", "severity": "HIGH", "notes": "Needs corrective action"},
                )
                assert response.status_code == 200, response.text

            duplicate = client.post(
                "/api/v1/safety-findings",
                json={
                    "round_id": round_id,
                    "checkpoint_id": checkpoints[0]["checkpoint_id"],
                    "vessel_id": "ocean-sentinel",
                    "title": "Duplicate checkpoint finding",
                    "description": "Retry payload",
                    "severity": "CRITICAL",
                },
            )
            assert duplicate.status_code == 201
            current_findings = client.get(f"/api/v1/safety-findings?round_id={round_id}&limit=20").json()
            assert len(current_findings) == 2

            repeated = client.patch(
                f"/api/v1/safety-rounds/{round_id}/checkpoints/{checkpoints[0]['checkpoint_id']}",
                json={"status": "FAIL", "severity": "HIGH", "notes": "Still unresolved"},
            )
            assert repeated.status_code == 200

            failure_events = client.get("/api/security-events?event_type=SAFETY_CHECKPOINT_FAILED&limit=20")
            assert failure_events.status_code == 200
            assert len(failure_events.json()) == 2
            assert len({event["event_id"] for event in failure_events.json()}) == 2
            findings = client.get(f"/api/v1/safety-findings?round_id={round_id}&limit=20")
            assert len(findings.json()) == 2
    finally:
        app.dependency_overrides.clear()


def test_safety_round_updates_broadcast_after_persistence(database, monkeypatch):
    def override_db():
        with database() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        messages = []

        async def capture_broadcast(message):
            with database() as session:
                if message["type"] == "safety_round_created":
                    assert get_safety_round(session, message["data"]["round_id"]) is not None
                if message["type"] == "security_event_created":
                    from db.events import get_event

                    assert get_event(session, message["data"]["event_id"]) is not None
            messages.append(message)

        monkeypatch.setattr(app.state.websocket_manager, "broadcast", capture_broadcast)
        with TestClient(app) as client:
            created = client.post(
                "/api/v1/safety-rounds",
                json={"vessel_id": "baltic-guardian", "round_type": "Security Round"},
            )
            assert created.status_code == 201, created.text
            round_id = created.json()["round_id"]

            started = client.post(f"/api/v1/safety-rounds/{round_id}/start")
            assert started.status_code == 200, started.text
            checkpoint = started.json()["checkpoints"][0]
            updated = client.patch(
                f"/api/v1/safety-rounds/{round_id}/checkpoints/{checkpoint['checkpoint_id']}",
                json={"status": "FAIL", "severity": "HIGH", "notes": "Obstructed"},
            )
            assert updated.status_code == 200, updated.text
            assert [message["type"] for message in messages] == [
                "safety_round_created",
                "safety_round_started",
                "security_event_created",
                "safety_finding_created",
                "security_event_created",
                "safety_checkpoint_updated",
            ]
    finally:
        app.dependency_overrides.clear()


def test_completed_round_and_finding_survive_fresh_api_client(database):
    def override_db():
        with database() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as first_client:
            created = first_client.post(
                "/api/v1/safety-rounds",
                json={"vessel_id": "northern-star", "round_type": "Security Round"},
            )
            assert created.status_code == 201, created.text
            round_id = created.json()["round_id"]
            started = first_client.post(f"/api/v1/safety-rounds/{round_id}/start")
            assert started.status_code == 200
            for index, checkpoint in enumerate(started.json()["checkpoints"]):
                status = "FAIL" if index == 0 else "PASS"
                response = first_client.patch(
                    f"/api/v1/safety-rounds/{round_id}/checkpoints/{checkpoint['checkpoint_id']}",
                    json={"status": status, "severity": "HIGH" if status == "FAIL" else "INFO"},
                )
                assert response.status_code == 200
            completed = first_client.post(f"/api/v1/safety-rounds/{round_id}/complete")
            assert completed.status_code == 200
            finding_id = first_client.get(f"/api/v1/safety-findings?round_id={round_id}").json()[0]["finding_id"]

        with TestClient(app) as restarted_client:
            persisted_round = restarted_client.get(f"/api/v1/safety-rounds/{round_id}")
            persisted_finding = restarted_client.get(f"/api/v1/safety-findings/{finding_id}")
            assert persisted_round.status_code == 200
            assert persisted_round.json()["status"] == "COMPLETED"
            assert all(checkpoint["status"] != "NOT_CHECKED" for checkpoint in persisted_round.json()["checkpoints"])
            assert persisted_finding.status_code == 200
            assert persisted_finding.json()["status"] == "OPEN"
    finally:
        app.dependency_overrides.clear()


def test_resolving_finding_closes_linked_event_and_persists_due_date(database):
    def override_db():
        with database() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            created = client.post(
                "/api/v1/safety-rounds",
                json={"vessel_id": "atlantic-trader", "round_type": "Fire Safety Round"},
            )
            assert created.status_code == 201, created.text
            round_id = created.json()["round_id"]
            checkpoint_id = created.json()["checkpoints"][0]["checkpoint_id"]
            failed = client.patch(
                f"/api/v1/safety-rounds/{round_id}/checkpoints/{checkpoint_id}",
                json={"status": "FAIL", "severity": "HIGH", "notes": "Extinguisher inspection overdue"},
            )
            assert failed.status_code == 200
            finding = client.get(f"/api/v1/safety-findings?round_id={round_id}").json()[0]
            due_date = "2026-10-02T12:00:00Z"
            resolved = client.patch(
                f"/api/v1/safety-findings/{finding['finding_id']}",
                json={"status": "RESOLVED", "assigned_to": "Chief Officer", "due_date": due_date, "resolution_notes": "Replaced and inspected."},
            )
            assert resolved.status_code == 200, resolved.text

            stored = client.get(f"/api/v1/safety-findings/{finding['finding_id']}").json()
            assert stored["status"] == "RESOLVED"
            assert stored["assigned_to"] == "Chief Officer"
            assert stored["due_date"].startswith("2026-10-02T12:00:00")
            assert stored["resolution_notes"] == "Replaced and inspected."
            failed_event = client.get("/api/security-events?event_type=SAFETY_CHECKPOINT_FAILED&limit=10").json()[0]
            resolved_event = client.get("/api/security-events?event_type=SAFETY_FINDING_RESOLVED&limit=10").json()[0]
            assert failed_event["status"] == "RESOLVED"
            assert resolved_event["status"] == "RESOLVED"
    finally:
        app.dependency_overrides.clear()


def test_demo_seed_is_complete_and_idempotent(database):
    with database() as session:
        seed_safety_demo_data(session)
        first_rounds = list_safety_rounds(session)
        seed_safety_demo_data(session)
        second_rounds = list_safety_rounds(session)
        findings = list_safety_findings(session, limit=100)
        assert {round_record.status for round_record in first_rounds} == {"PLANNED", "IN_PROGRESS", "COMPLETED"}
        assert len(second_rounds) == len(first_rounds) == 3
        assert any(finding.status == "RESOLVED" for finding in findings)
        assert any(finding.status == "OPEN" for finding in findings)
