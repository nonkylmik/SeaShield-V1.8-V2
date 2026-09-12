from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from db.database import Base, get_db
from db.repositories.safety_repository import list_safety_rounds, create_safety_round, get_safety_round


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
                    "vessel_id": "MV-BALTIC-GUARDIAN",
                    "round_type": "General Safety Round",
                    "assigned_to": "Deck Officer",
                    "planned_start": "2026-09-12T18:00:00Z",
                    "notes": "Evening watch",
                },
            )
            assert response.status_code == 201, response.text
            payload = response.json()
            assert payload["round_id"].startswith("SR-")
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
                    "vessel_id": "MV-BALTIC-GUARDIAN",
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
                    "vessel_id": "MV-OCEAN-SENTINEL",
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
