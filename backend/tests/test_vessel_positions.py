import math
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, delete, event
from sqlalchemy.orm import sessionmaker

import app.main as main
import auth
import simulation.vessel_positions as vessel_positions
from db.database import Base, get_db
from db.models import VesselRecord
from models.positions import Freshness, UnavailablePosition, UnavailableReason, VesselPosition, VesselPositionsResponse
from simulation.simulation_engine import SimulationEngine
from simulation.vessel_positions import (
    EARTH_RADIUS_NM,
    REPORT_INTERVAL,
    SCHEDULE_EPOCH,
    VESSEL_SIMULATIONS,
    FixedOutage,
    RecurringOutage,
    VesselRoute,
    VesselSimulation,
    Waypoint,
    fleet_positions,
    latest_report_time,
    route_position,
    vessel_position,
)

VESSEL_IDS = ("atlantic-trader", "baltic-guardian", "calypso", "iron-horizon", "northern-star", "ocean-sentinel")
NOW = datetime(2026, 10, 27, 12, 4, 10, tzinfo=timezone.utc)
# 10 degrees of longitude along the equator: 600 nm each way, so 12 hours per leg at 50 kn.
EQUATOR = VesselRoute(label="Test equator loop", speed_kn=50, waypoints=(Waypoint(lat=0, lon=0), Waypoint(lat=0, lon=10)))


def at(hour: int, minute: int = 0, second: int = 0, day: int = 27) -> datetime:
    return datetime(2026, 10, day, hour, minute, second, tzinfo=timezone.utc)


def fixed(start: datetime, end: datetime) -> FixedOutage:
    return FixedOutage(start=start, end=end)


def hourly(offset_minutes: int = 10, duration_minutes: int = 30) -> RecurringOutage:
    return RecurringOutage(period=timedelta(hours=1), offset=timedelta(minutes=offset_minutes), duration=timedelta(minutes=duration_minutes))


def simulated(*outages, route: VesselRoute = EQUATOR) -> VesselSimulation:
    return VesselSimulation(route=route, outages=outages)


def distance_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    half = math.sin((phi2 - phi1) / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_NM * math.asin(math.sqrt(half))


def route_with(*points: tuple[float, float], speed_kn: float = 12) -> VesselRoute:
    return VesselRoute(label="Test route", speed_kn=speed_kn, waypoints=tuple(Waypoint(lat=lat, lon=lon) for lat, lon in points))


# --- Report schedule -------------------------------------------------------------------------------------------------


def test_reports_are_on_fixed_utc_slots_and_visible_from_the_slot_itself():
    simulation = simulated()
    assert latest_report_time(simulation, at(12)) == at(12)
    assert latest_report_time(simulation, at(12, 2, 59)) == at(12)
    assert latest_report_time(simulation, at(12, 3)) == at(12, 3)
    assert (at(12, 3) - SCHEDULE_EPOCH) % REPORT_INTERVAL == timedelta(0)


def test_between_slots_the_latest_report_is_returned_unchanged():
    simulation = simulated()
    reports = {vessel_position("v", simulation, moment) for moment in (at(12), at(12, 1), at(12, 2, 59, ))}
    assert len(reports) == 1


def test_the_same_evaluation_time_always_gives_identical_values():
    first = fleet_positions(VESSEL_IDS, NOW)
    second = fleet_positions(VESSEL_IDS, NOW)
    assert first == second
    assert first.model_dump_json() == second.model_dump_json()


def test_no_report_exists_before_the_schedule_epoch():
    assert vessel_position("v", simulated(), SCHEDULE_EPOCH - timedelta(seconds=1)) == UnavailablePosition(vessel_id="v", reason=UnavailableReason.NO_REPORT)
    assert latest_report_time(simulated(), SCHEDULE_EPOCH) == SCHEDULE_EPOCH


# --- Route maths -----------------------------------------------------------------------------------------------------


def test_positions_follow_the_route_waypoints_and_wrap_around_the_loop():
    leg = timedelta(hours=distance_nm(0, 0, 0, 10) / EQUATOR.speed_kn)
    assert route_position(EQUATOR, SCHEDULE_EPOCH) == (0.0, 0.0, 90.0)
    assert route_position(EQUATOR, SCHEDULE_EPOCH + leg / 2) == (0.0, 5.0, 90.0)
    assert route_position(EQUATOR, SCHEDULE_EPOCH + leg)[:2] == (0.0, 10.0)
    # Past the second waypoint the vessel is on the closing leg, heading back west.
    assert route_position(EQUATOR, SCHEDULE_EPOCH + leg + REPORT_INTERVAL)[2] == 270.0
    assert route_position(EQUATOR, SCHEDULE_EPOCH + leg * 1.5) == (0.0, 5.0, 270.0)
    assert route_position(EQUATOR, SCHEDULE_EPOCH + leg * 2)[:2] == (0.0, 0.0)
    assert route_position(EQUATOR, SCHEDULE_EPOCH + leg * 2 + REPORT_INTERVAL)[2] == 90.0


def test_interpolated_positions_lie_on_the_great_circle_segment():
    route = route_with((50.0, -30.0), (40.0, -60.0))
    first_leg_hours = distance_nm(50.0, -30.0, 40.0, -60.0) / route.speed_kn
    for fraction in (0.1, 0.37, 0.5, 0.9):
        lat, lon, _ = route_position(route, SCHEDULE_EPOCH + timedelta(hours=first_leg_hours * fraction))
        on_arc = distance_nm(50.0, -30.0, lat, lon) + distance_nm(lat, lon, 40.0, -60.0)
        assert on_arc == pytest.approx(distance_nm(50.0, -30.0, 40.0, -60.0), abs=0.01)


def test_consecutive_reports_are_one_interval_of_sailing_apart():
    route = route_with((50.0, -30.0), (40.0, -60.0), speed_kn=20)
    start = SCHEDULE_EPOCH + timedelta(hours=10)
    first, second = route_position(route, start), route_position(route, start + REPORT_INTERVAL)
    assert distance_nm(first[0], first[1], second[0], second[1]) == pytest.approx(20 * REPORT_INTERVAL.total_seconds() / 3600, abs=0.01)


def test_course_is_the_great_circle_bearing_towards_the_segment_end():
    route = route_with((50.0, -30.0), (40.0, -60.0))
    lat, lon, course = route_position(route, SCHEDULE_EPOCH)
    assert (lat, lon) == (50.0, -30.0)
    assert 250 < course < 290
    for hours in range(0, 400, 7):
        assert 0 <= route_position(route, SCHEDULE_EPOCH + timedelta(hours=hours))[2] < 360


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2, delta = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    return math.degrees(math.atan2(math.sin(delta) * math.cos(phi2), math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta))) % 360


def angle_between(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


@pytest.mark.parametrize("fraction", [0.0, 0.25, 0.49, 0.5, 0.75, 0.99, 0.999])
def test_course_points_in_the_direction_of_travel_along_the_whole_leg(fraction):
    # Includes the far half of the leg, where the course is taken from the start waypoint, and just before the end.
    route = route_with((50.0, -30.0), (40.0, -60.0), speed_kn=50)
    leg_hours = distance_nm(50.0, -30.0, 40.0, -60.0) / route.speed_kn
    moment = SCHEDULE_EPOCH + timedelta(hours=leg_hours * fraction)
    lat, lon, course = route_position(route, moment)
    ahead_lat, ahead_lon, _ = route_position(route, moment + timedelta(minutes=1))
    assert angle_between(course, bearing_deg(lat, lon, ahead_lat, ahead_lon)) < 0.5


def test_course_just_before_a_waypoint_is_forward_not_reversed():
    leg = timedelta(hours=distance_nm(0, 0, 0, 10) / EQUATOR.speed_kn)
    assert route_position(EQUATOR, SCHEDULE_EPOCH + leg - timedelta(minutes=1))[2] == 90.0
    assert route_position(EQUATOR, SCHEDULE_EPOCH + leg * 2 - timedelta(minutes=1))[2] == 270.0


def test_every_configured_route_stays_within_coordinate_ranges():
    for simulation in VESSEL_SIMULATIONS.values():
        for minutes in range(0, 7 * 24 * 60, 37):
            lat, lon, course = route_position(simulation.route, SCHEDULE_EPOCH + timedelta(minutes=minutes))
            assert -90 <= lat <= 90 and -180 <= lon < 180 and 0 <= course < 360


# --- Outage windows --------------------------------------------------------------------------------------------------


def test_the_review_example_never_resurrects_a_suppressed_report():
    simulation = simulated(fixed(at(11, 58), at(12, 2, 30)))
    assert latest_report_time(simulation, at(11, 59)) == at(11, 57)
    assert latest_report_time(simulation, at(12, 2, 45)) == at(11, 57)
    assert latest_report_time(simulation, at(12, 3)) == at(12, 3)


def test_a_window_is_half_open_on_slot_boundaries():
    simulation = simulated(fixed(at(12), at(12, 30)))
    assert latest_report_time(simulation, at(12)) == at(11, 57)
    assert latest_report_time(simulation, at(12, 29, 59)) == at(11, 57)
    assert latest_report_time(simulation, at(12, 30)) == at(12, 30)


def test_overlapping_windows_act_as_their_union():
    simulation = simulated(fixed(at(12), at(12, 20)), fixed(at(12, 10), at(12, 40)))
    # The first window ends at 12:20 inside the second: the position stays frozen at 11:57.
    assert latest_report_time(simulation, at(12, 25)) == at(11, 57)
    # 12:40 is not a slot: the union ended, but the next report is the 12:42 slot.
    assert latest_report_time(simulation, at(12, 41)) == at(11, 57)
    assert latest_report_time(simulation, at(12, 42)) == at(12, 42)
    adjacent = simulated(fixed(at(12), at(12, 10)), fixed(at(12, 10), at(12, 20)))
    assert latest_report_time(adjacent, at(12, 15)) == at(11, 57)


def test_fixed_and_recurring_windows_combine():
    simulation = simulated(hourly(), fixed(at(12, 30), at(12, 50)))
    assert latest_report_time(simulation, at(12, 45)) == at(12, 9)
    assert latest_report_time(simulation, at(12, 50)) == at(12, 9)
    assert latest_report_time(simulation, at(12, 51)) == at(12, 51)


def test_recurring_windows_are_anchored_to_the_schedule_epoch():
    outage = hourly()
    assert outage.window_containing(at(12, 15)) == (at(12, 10), at(12, 40))
    assert outage.window_containing(at(3, 39, 59)) == (at(3, 10), at(3, 40))
    assert outage.window_containing(at(12, 40)) is None
    assert outage.window_containing(at(12, 9, 59)) is None
    simulation = simulated(outage)
    assert latest_report_time(simulation, at(12, 12)) == at(12, 9)
    assert latest_report_time(simulation, at(13, 39)) == at(13, 9)
    assert latest_report_time(simulation, at(13, 42)) == at(13, 42)


def test_recurring_windows_across_midnight_utc():
    simulation = simulated(RecurringOutage(period=timedelta(hours=24), offset=timedelta(hours=23), duration=timedelta(hours=2)))
    assert latest_report_time(simulation, at(0, 30, day=28)) == at(22, 57)
    assert latest_report_time(simulation, at(1, day=28)) == at(1, day=28)


def test_an_outage_freezes_every_reported_value():
    simulation = simulated(fixed(at(12), at(12, 30)))
    frozen = [vessel_position("v", simulation, moment) for moment in (at(12, 1), at(12, 14), at(12, 29, 59))]
    for position in frozen:
        assert (position.lat, position.lon, position.course_deg, position.speed_kn) == (frozen[0].lat, frozen[0].lon, frozen[0].course_deg, frozen[0].speed_kn)
        assert position.position_at == position.received_at == at(11, 57)
    recovered = vessel_position("v", simulation, at(12, 30))
    assert recovered.position_at == at(12, 30)
    assert (recovered.lat, recovered.lon) != (frozen[0].lat, frozen[0].lon)


def test_outages_covering_every_slot_since_the_epoch_mean_no_report():
    simulation = simulated(fixed(SCHEDULE_EPOCH - timedelta(days=1), at(13)))
    assert vessel_position("v", simulation, at(12)) == UnavailablePosition(vessel_id="v", reason=UnavailableReason.NO_REPORT)
    assert vessel_position("v", simulation, at(13)).position_at == at(13)


# --- Freshness -------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("age", "expected"),
    [
        (timedelta(minutes=15) - timedelta(milliseconds=1), Freshness.CURRENT),
        (timedelta(minutes=15), Freshness.STALE),
        (timedelta(hours=2) - timedelta(milliseconds=1), Freshness.STALE),
        (timedelta(hours=2), Freshness.LOST),
    ],
)
def test_freshness_boundaries_against_the_last_eligible_report(age, expected):
    simulation = simulated(fixed(at(12), at(18)))
    position = vessel_position("v", simulation, at(11, 57) + age)
    assert position.position_at == at(11, 57)
    assert position.freshness == expected


def test_a_long_outage_reaches_lost_and_then_recovers():
    simulation = simulated(fixed(at(12), at(18)))
    lost = vessel_position("v", simulation, at(17, 59))
    assert (lost.freshness, lost.position_at) == (Freshness.LOST, at(11, 57))
    recovered = vessel_position("v", simulation, at(18))
    assert (recovered.freshness, recovered.position_at) == (Freshness.CURRENT, at(18))


def test_a_reporting_vessel_is_always_current():
    simulation = simulated()
    for seconds in range(0, 3600, 61):
        assert vessel_position("v", simulation, at(12) + timedelta(seconds=seconds)).freshness == Freshness.CURRENT


# --- Configuration and contract validation ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "points",
    [
        ((10.0, 10.0),),
        ((float("nan"), 0.0), (1.0, 1.0)),
        ((0.0, float("inf")), (1.0, 1.0)),
        ((86.0, 0.0), (1.0, 1.0)),
        ((0.0, 180.0), (1.0, 1.0)),
        ((0.0, 0.0), (0.0, 0.0), (1.0, 1.0)),
        ((0.0, 170.0), (0.0, -170.0)),
        ((0.0, 0.0), (5.0, 5.0), (0.0, 0.0)),
    ],
    ids=["one-waypoint", "nan-lat", "inf-lon", "lat-out-of-range", "lon-180", "repeated-waypoint", "antimeridian", "closing-zero-length"],
)
def test_invalid_routes_are_rejected(points):
    with pytest.raises(ValidationError):
        route_with(*points)


def test_a_closing_segment_across_the_antimeridian_is_rejected():
    with pytest.raises(ValidationError):
        route_with((0.0, 170.0), (10.0, 175.0), (5.0, 0.0), (0.0, -170.0))


@pytest.mark.parametrize("speed", [0, -1, float("nan"), float("inf"), 51])
def test_invalid_speeds_are_rejected(speed):
    with pytest.raises(ValidationError):
        route_with((0.0, 0.0), (1.0, 1.0), speed_kn=speed)


def test_invalid_outage_windows_are_rejected():
    with pytest.raises(ValidationError):
        fixed(at(12), at(12))
    with pytest.raises(ValidationError):
        FixedOutage(start=datetime(2026, 10, 27, 12), end=datetime(2026, 10, 27, 13))
    for period, offset, duration in [
        (timedelta(hours=1), timedelta(0), timedelta(0)),
        (timedelta(hours=1), timedelta(minutes=-1), timedelta(minutes=10)),
        (timedelta(hours=1), timedelta(hours=1), timedelta(minutes=10)),
        (timedelta(hours=1), timedelta(0), timedelta(minutes=58)),
    ]:
        with pytest.raises(ValidationError):
            RecurringOutage(period=period, offset=offset, duration=duration)


def position_fields(**changes) -> dict:
    fields = {"vessel_id": "calypso", "lat": 12.5, "lon": 45.0, "course_deg": 90.0, "speed_kn": 12.0, "position_at": at(12), "received_at": at(12), "source": "SIMULATED", "freshness": "CURRENT"}
    return fields | changes


@pytest.mark.parametrize(
    "changes",
    [
        {"lat": float("nan")},
        {"lon": float("inf")},
        {"lat": 90.5},
        {"lon": -180.5},
        {"course_deg": 360.0},
        {"speed_kn": float("inf")},
        {"speed_kn": -1.0},
        {"position_at": datetime(2026, 10, 27, 12)},
        {"received_at": at(11, 59)},
        {"vessel_id": ""},
        {"vessel_id": "x" * 101},
        {"source": "AIS"},
    ],
)
def test_the_contract_rejects_invalid_position_values(changes):
    with pytest.raises(ValidationError):
        VesselPosition(**position_fields(**changes))


def test_the_contract_rejects_future_reports_and_duplicate_vessels():
    position = VesselPosition(**position_fields())
    with pytest.raises(ValidationError):
        VesselPositionsResponse(evaluated_at=at(11, 59), positions=[position], unavailable=[])
    with pytest.raises(ValidationError):
        VesselPositionsResponse(evaluated_at=at(12), positions=[position], unavailable=[UnavailablePosition(vessel_id="calypso", reason=UnavailableReason.NO_ROUTE)])


def test_every_fleet_vessel_has_a_route_and_the_demo_windows_are_configured():
    assert set(VESSEL_SIMULATIONS) == set(VESSEL_IDS)
    assert VESSEL_SIMULATIONS["northern-star"].outages == (hourly(),)
    assert VESSEL_SIMULATIONS["atlantic-trader"].outages == (RecurringOutage(period=timedelta(hours=12), offset=timedelta(hours=2), duration=timedelta(hours=3)),)
    assert all(not VESSEL_SIMULATIONS[vessel_id].outages for vessel_id in ("baltic-guardian", "ocean-sentinel", "iron-horizon", "calypso"))


def test_fleet_positions_lists_every_vessel_exactly_once_in_the_given_order():
    response = fleet_positions(["calypso", "unrouted", "baltic-guardian"], NOW)
    assert [position.vessel_id for position in response.positions] == ["calypso", "baltic-guardian"]
    assert response.unavailable == [UnavailablePosition(vessel_id="unrouted", reason=UnavailableReason.NO_ROUTE)]


# --- API ---------------------------------------------------------------------------------------------------------------


@pytest.fixture()
def api(tmp_path, monkeypatch):
    database_engine = create_engine(f"sqlite:///{tmp_path / 'vessel_positions.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(database_engine)
    sessions = sessionmaker(bind=database_engine, expire_on_commit=False)
    monkeypatch.setattr(main, "SessionLocal", sessions)
    monkeypatch.setattr(main, "engine", SimulationEngine(seed=7))

    def override_db():
        with sessions() as session:
            yield session

    main.app.dependency_overrides[get_db] = override_db
    main.app.dependency_overrides[main.position_evaluation_time] = lambda: NOW
    with TestClient(main.app) as test_client:
        yield test_client, sessions, database_engine
    main.app.dependency_overrides.clear()
    database_engine.dispose()


def positions(test_client, **params) -> dict:
    response = test_client.get("/api/v1/vessels/positions", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_the_endpoint_lists_every_vessel_once_with_utc_timestamps(api):
    test_client, _, _ = api
    body = positions(test_client)
    assert body["evaluated_at"] == "2026-10-27T12:04:10Z"
    assert sorted(position["vessel_id"] for position in body["positions"]) == sorted(VESSEL_IDS)
    assert body["unavailable"] == []
    for position in body["positions"]:
        assert position["source"] == "SIMULATED"
        assert position["position_at"].endswith("Z") and position["received_at"] == position["position_at"]
        assert position["freshness"] == "CURRENT"
    assert body == fleet_positions([vessel["id"] for vessel in test_client.get("/api/v1/vessels").json()], NOW).model_dump(mode="json")


def test_the_endpoint_filters_by_vessel_and_validates_the_id(api):
    test_client, _, _ = api
    body = positions(test_client, vessel_id="calypso")
    assert [position["vessel_id"] for position in body["positions"]] == ["calypso"]
    assert test_client.get("/api/v1/vessels/positions", params={"vessel_id": "no-such-vessel"}).status_code == 404
    assert test_client.get("/api/v1/vessels/positions?vessel_id=").status_code == 422
    assert test_client.get("/api/v1/vessels/positions", params={"vessel_id": "x" * 101}).status_code == 422
    # The positions route does not shadow, and is not shadowed by, the single-vessel route.
    assert test_client.get("/api/v1/vessels/calypso").json()["id"] == "calypso"


def test_a_vessel_without_a_route_is_listed_as_unavailable(api, monkeypatch):
    test_client, _, _ = api
    monkeypatch.setattr(vessel_positions, "VESSEL_SIMULATIONS", {key: value for key, value in VESSEL_SIMULATIONS.items() if key != "calypso"})
    body = positions(test_client)
    assert body["unavailable"] == [{"vessel_id": "calypso", "reason": "NO_ROUTE"}]
    assert "calypso" not in [position["vessel_id"] for position in body["positions"]]
    assert positions(test_client, vessel_id="calypso") == {"evaluated_at": "2026-10-27T12:04:10Z", "positions": [], "unavailable": [{"vessel_id": "calypso", "reason": "NO_ROUTE"}]}


def test_an_empty_fleet_returns_two_empty_lists(api):
    test_client, sessions, _ = api
    with sessions() as database:
        database.execute(delete(VesselRecord))
        database.commit()
    main.engine.vessels = []
    assert positions(test_client) == {"evaluated_at": "2026-10-27T12:04:10Z", "positions": [], "unavailable": []}


def test_security_event_changes_never_alter_positions(api):
    test_client, _, _ = api
    baseline = positions(test_client)

    def unchanged(step: str) -> None:
        assert positions(test_client) == baseline, step

    for event_type in ("GPS_ANOMALY", "AIS_ANOMALY", "COMMUNICATION_INSTABILITY"):
        assert test_client.post("/api/v1/simulation/inject", json={"vessel_id": "atlantic-trader", "event_type": event_type}).status_code == 200
    assert test_client.post("/api/v1/simulation/inject", json={"vessel_id": "calypso", "event_type": "COMMUNICATION_INSTABILITY"}).status_code == 200
    unchanged("inject")

    events = test_client.get("/api/security-events").json()
    standalone = next(item["event_id"] for item in events if item["vessel_id"] == "calypso" and item["event_type"] == "COMMUNICATION_INSTABILITY")
    assert test_client.post(f"/api/security-events/{standalone}/acknowledge", json={}).status_code == 200
    unchanged("acknowledge")

    incident_id = next(item["incident_id"] for item in test_client.get("/api/v1/incidents").json() if item["vessel_id"] == "atlantic-trader")
    assert test_client.patch(f"/api/v1/incidents/{incident_id}", json={"status": "RESOLVED"}).status_code == 200
    unchanged("resolve")
    assert test_client.post(f"/api/v1/incidents/{incident_id}/reopen", json={"reason": "Recheck"}).status_code == 200
    unchanged("reopen")
    assert test_client.delete(f"/api/security-events/{standalone}").status_code == 204
    unchanged("delete")
    assert test_client.post("/api/v1/simulation/reset").status_code == 200
    unchanged("reset")


def test_a_positions_request_is_read_only(api):
    test_client, _, database_engine = api
    engine_before = ([item.event_id for item in main.engine.events], [item.model_dump() for item in main.engine.incidents.get_all()], [vessel.model_dump() for vessel in main.engine.vessels])
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(database_engine, "before_cursor_execute", record)
    try:
        positions(test_client)
        positions(test_client, vessel_id="calypso")
    finally:
        event.remove(database_engine, "before_cursor_execute", record)
    assert statements, "the request should read the vessel list"
    assert [statement for statement in statements if not statement.lstrip().upper().startswith("SELECT")] == []
    engine_after = ([item.event_id for item in main.engine.events], [item.model_dump() for item in main.engine.incidents.get_all()], [vessel.model_dump() for vessel in main.engine.vessels])
    assert engine_after == engine_before


def test_the_endpoint_requires_a_session_when_auth_is_required(api, monkeypatch):
    test_client, _, _ = api
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setattr(auth, "SESSION_SECRET", "test-session-secret")
    monkeypatch.setattr(auth, "PASSWORD_DIGEST", auth._digest(auth.DEMO_PASSWORD))
    assert test_client.get("/api/v1/vessels/positions").status_code == 401
    assert test_client.post("/api/auth/login", json={"email": auth.DEMO_EMAIL, "password": auth.DEMO_PASSWORD}).status_code == 200
    assert test_client.get("/api/v1/vessels/positions").status_code == 200
