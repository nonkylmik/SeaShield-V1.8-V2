from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, delete
from sqlalchemy.orm import sessionmaker

import app.main as main
import simulation.vessel_positions as vessel_positions
from db.database import Base, get_db
from db.models import VesselRecord
from simulation.simulation_engine import SimulationEngine
from simulation.vessel_positions import VESSEL_SIMULATIONS, VesselRoute, Waypoint, route_label

VESSEL_IDS = ("atlantic-trader", "baltic-guardian", "calypso", "iron-horizon", "northern-star", "ocean-sentinel")
# The vessel fields the frontend already depends on; route_label is added, nothing is removed.
EXISTING_FIELDS = {"id", "name", "imo", "base_score", "score", "last_communication", "status"}
WAYPOINTS = (Waypoint(lat=0, lon=0), Waypoint(lat=0, lon=10))


def route(label: str) -> VesselRoute:
    return VesselRoute(label=label, speed_kn=12, waypoints=WAYPOINTS)


# --- Configuration ---------------------------------------------------------------------------------------------------


def test_every_fleet_vessel_has_a_distinct_valid_route_label():
    labels = {vessel_id: VESSEL_SIMULATIONS[vessel_id].route.label for vessel_id in VESSEL_IDS}
    assert all(1 <= len(label) <= 80 and label == label.strip() for label in labels.values())
    assert len(set(labels.values())) == len(labels)
    assert labels == {vessel_id: route_label(vessel_id) for vessel_id in VESSEL_IDS}


def test_labels_describe_the_configured_loops():
    # The label must name the sea area the waypoints sail in; checked against each loop's first waypoint.
    expected = {
        "atlantic-trader": ("Transatlantic", (49.5, -6.5)),
        "baltic-guardian": ("Baltic", (54.8, 18.9)),
        "calypso": ("Gulf of Aden", (12.55, 43.45)),
        "iron-horizon": ("Mediterranean", (36.0, -5.5)),
        "northern-star": ("North Sea", (52.0, 3.6)),
        "ocean-sentinel": ("Biscay", (49.8, -3.0)),
    }
    for vessel_id, (area, first) in expected.items():
        configured = VESSEL_SIMULATIONS[vessel_id].route
        assert area in configured.label
        assert (configured.waypoints[0].lat, configured.waypoints[0].lon) == first


@pytest.mark.parametrize("label", ["", "   ", "x" * 81, None])
def test_invalid_route_labels_are_rejected(label):
    with pytest.raises(ValidationError):
        route(label)


def test_a_route_label_is_trimmed_and_may_use_all_80_characters():
    assert route("x" * 80).label == "x" * 80
    assert route("  North Sea loop  ").label == "North Sea loop"


def test_a_vessel_without_a_route_has_no_label():
    assert route_label("no-such-vessel") is None


# --- API ---------------------------------------------------------------------------------------------------------------


@pytest.fixture()
def api(tmp_path, monkeypatch):
    database_engine = create_engine(f"sqlite:///{tmp_path / 'route_labels.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(database_engine)
    sessions = sessionmaker(bind=database_engine, expire_on_commit=False)
    monkeypatch.setattr(main, "SessionLocal", sessions)
    monkeypatch.setattr(main, "engine", SimulationEngine(seed=7))

    def override_db():
        with sessions() as session:
            yield session

    main.app.dependency_overrides[get_db] = override_db
    main.app.dependency_overrides[main.position_evaluation_time] = lambda: datetime(2026, 10, 27, 12, tzinfo=timezone.utc)
    with TestClient(main.app) as test_client:
        yield test_client, sessions
    main.app.dependency_overrides.clear()
    database_engine.dispose()


@pytest.mark.parametrize("path", ["/vessels", "/api/v1/vessels"])
def test_both_vessel_list_paths_return_each_route_label(api, path):
    test_client, _ = api
    vessels = test_client.get(path).json()
    assert sorted(vessel["id"] for vessel in vessels) == sorted(VESSEL_IDS)
    for vessel in vessels:
        assert set(vessel) == EXISTING_FIELDS | {"route_label"}
        assert vessel["route_label"] == VESSEL_SIMULATIONS[vessel["id"]].route.label


def test_the_vessel_detail_returns_its_route_label(api):
    test_client, _ = api
    for vessel_id in VESSEL_IDS:
        vessel = test_client.get(f"/api/v1/vessels/{vessel_id}").json()
        assert set(vessel) == EXISTING_FIELDS | {"route_label"}
        assert vessel["route_label"] == VESSEL_SIMULATIONS[vessel_id].route.label
    assert test_client.get("/api/v1/vessels/no-such-vessel").status_code == 404


def test_existing_vessel_fields_are_unchanged(api):
    test_client, _ = api
    listed = {vessel["id"]: vessel for vessel in test_client.get("/api/v1/vessels").json()}
    for vessel_id, vessel in listed.items():
        detail = test_client.get(f"/api/v1/vessels/{vessel_id}").json()
        assert detail == vessel
        model = next(item for item in main.engine.vessels if item.id == vessel_id)
        assert (vessel["name"], vessel["imo"], vessel["score"], vessel["status"]) == (model.name, model.imo, model.score, model.status)


def test_a_vessel_without_a_configured_route_has_a_null_label(api, monkeypatch):
    test_client, _ = api
    monkeypatch.setattr(vessel_positions, "VESSEL_SIMULATIONS", {k: v for k, v in VESSEL_SIMULATIONS.items() if k != "calypso"})
    listed = {vessel["id"]: vessel for vessel in test_client.get("/api/v1/vessels").json()}
    assert listed["calypso"]["route_label"] is None
    assert listed["northern-star"]["route_label"] == VESSEL_SIMULATIONS["northern-star"].route.label
    assert test_client.get("/api/v1/vessels/calypso").json()["route_label"] is None


def test_labels_are_returned_before_any_vessel_is_persisted(api):
    # With no vessel rows the endpoints fall back to the engine's vessels; the label must still be there.
    test_client, sessions = api
    with sessions() as database:
        database.execute(delete(VesselRecord))
        database.commit()
    vessels = test_client.get("/api/v1/vessels").json()
    assert {vessel["id"]: vessel["route_label"] for vessel in vessels} == {vessel_id: VESSEL_SIMULATIONS[vessel_id].route.label for vessel_id in VESSEL_IDS}
    assert test_client.get("/api/v1/vessels/calypso").json()["route_label"] == VESSEL_SIMULATIONS["calypso"].route.label


def test_the_positions_api_is_unchanged(api):
    test_client, _ = api
    body = test_client.get("/api/v1/vessels/positions").json()
    assert set(body) == {"evaluated_at", "positions", "unavailable"}
    assert all("route_label" not in position for position in body["positions"])
