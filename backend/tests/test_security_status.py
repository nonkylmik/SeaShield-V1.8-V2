from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.main as main
from db.database import Base, get_db
from db.repositories.event_repository import create_event_record
from db.repositories.vessel_repository import get_vessel_record
from models.events import Vessel
from models.security_status import STATUS_BANDS, SecurityStatus, status_for_score
from simulation.simulation_engine import SimulationEngine

SEVERITY_ORDER = [SecurityStatus.SECURE.value, SecurityStatus.ELEVATED.value, SecurityStatus.WARNING.value, SecurityStatus.CRITICAL.value]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    database_engine = create_engine(f"sqlite:///{tmp_path / 'security_status.db'}", connect_args={"check_same_thread": False})
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


def store_vessel_row(sessions, vessel_id: str, *, score: int, status: str) -> None:
    """Writes a vessel row directly, as stale or legacy data would be stored."""
    with sessions() as database:
        record = get_vessel_record(database, vessel_id)
        record.score, record.status = score, status
        database.commit()


@pytest.mark.parametrize(
    ("score", "status"),
    [(100, "SECURE"), (86, "SECURE"), (85, "ELEVATED"), (72, "ELEVATED"), (71, "WARNING"), (55, "WARNING"), (54, "CRITICAL"), (0, "CRITICAL")],
)
def test_score_bands(score, status):
    assert status_for_score(score) == status


def test_every_score_has_one_status_and_higher_scores_are_never_less_secure():
    statuses = [status_for_score(score) for score in range(0, 101)]
    assert set(statuses) == set(SEVERITY_ORDER)
    ranks = [SEVERITY_ORDER.index(status) for status in statuses]
    assert ranks == sorted(ranks, reverse=True)
    assert [minimum for minimum, _ in STATUS_BANDS] == sorted((minimum for minimum, _ in STATUS_BANDS), reverse=True)


@pytest.mark.parametrize("supplied", ["SECURE", "CRITICAL", "", "UNKNOWN", None])
def test_vessel_status_is_derived_from_score_and_ignores_supplied_status(supplied):
    fields = {"id": "v", "name": "Test", "imo": "IMO 0000000", "base_score": 95, "score": 60}
    vessel = Vessel(**fields) if supplied is None else Vessel(**fields, status=supplied)
    assert vessel.status == "WARNING"


def test_vessel_status_follows_score_changes_after_construction():
    vessel = Vessel(id="v", name="Test", imo="IMO 0000000", base_score=95, score=95)
    assert vessel.status == "SECURE"

    vessel.score = 50

    assert vessel.status == "CRITICAL"
    assert vessel.model_dump()["status"] == "CRITICAL"
    assert '"status":"CRITICAL"' in vessel.model_dump_json()


@pytest.mark.parametrize("stored_status", ["SECURE", "WARNING", "", "BOGUS"])
def test_api_derives_status_from_score_when_stored_status_conflicts_or_is_missing(client, stored_status):
    test_client, sessions = client
    store_vessel_row(sessions, "calypso", score=60, status=stored_status)

    listed = next(vessel for vessel in test_client.get("/api/v1/vessels").json() if vessel["id"] == "calypso")
    single = test_client.get("/api/v1/vessels/calypso").json()
    security = test_client.get("/security/calypso").json()

    assert (listed["score"], listed["status"]) == (60, "WARNING")
    assert (single["score"], single["status"]) == (60, "WARNING")
    assert security == {"vessel_id": "calypso", "score": 60, "status": "WARNING"}


def test_engine_api_persisted_and_notified_status_agree(client):
    test_client, sessions = client
    messages = []

    async def record(payload: dict) -> None:
        messages.append(payload)

    main.engine.set_broadcaster(record)
    event = {"event_id": "evt-status", "timestamp": "2026-10-26T10:00:00Z", "vessel_id": "calypso", "event_type": "UNKNOWN_DEVICE", "category": "CYBER", "severity": "CRITICAL", "source": "test", "description": "test"}

    assert test_client.post("/api/security-events", json=event).status_code == 201

    with sessions() as database:
        stored = get_vessel_record(database, "calypso")
    engine_vessel = next(vessel for vessel in main.engine.vessels if vessel.id == "calypso")
    api_vessel = test_client.get("/api/v1/vessels/calypso").json()
    notified = [message["data"]["status"] for message in messages if message["type"] in {"security_score_changed", "vessel_status_changed"}]
    assert (stored.score, stored.status) == (72, "ELEVATED")
    assert (engine_vessel.score, engine_vessel.status) == (72, "ELEVATED")
    assert (api_vessel["score"], api_vessel["status"]) == (72, "ELEVATED")
    assert notified == ["ELEVATED", "ELEVATED"]


def test_startup_sync_rewrites_stored_statuses_from_legacy_bands(client, monkeypatch):
    _, sessions = client
    # An open CRITICAL event puts calypso at 92 - 20 = 72: WARNING under the previous three-level bands, ELEVATED now.
    with sessions() as database:
        create_event_record(database, event_id="evt-legacy", timestamp=datetime.now(timezone.utc), vessel_id="calypso", event_type="UNKNOWN_DEVICE", category="CYBER", severity="CRITICAL", source="test", description="legacy")
    store_vessel_row(sessions, "calypso", score=72, status="WARNING")

    monkeypatch.setattr(main, "engine", SimulationEngine(seed=7))
    with sessions() as database:
        main.sync_engine_from_db(database)

    with sessions() as database:
        stored = get_vessel_record(database, "calypso")
    assert (stored.score, stored.status) == (72, "ELEVATED")
