"""Deterministic simulated vessel position reports (simulation only; no real AIS, GPS or network data).

Each vessel with a route reports on a fixed UTC schedule: one report every REPORT_INTERVAL, counted from
SCHEDULE_EPOCH. The report at slot T holds the vessel's position on its route at T. Outage windows suppress the slots
inside them, so the latest report freezes at the last slot before an outage and resumes at the first slot at or
after its end. Nothing is persisted and nothing is extrapolated: the result depends only on this configuration and
the evaluation time, never on security events or other database state.
"""
from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from datetime import datetime, timedelta, timezone
from functools import cached_property
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from models.positions import Freshness, PositionSource, UnavailablePosition, UnavailableReason, VesselPosition, VesselPositionsResponse

SCHEDULE_EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)
REPORT_INTERVAL = timedelta(minutes=3)
# Provisional thresholds, measured from the report time (position_at), never from the request time.
STALE_AFTER = timedelta(minutes=15)
LOST_AFTER = timedelta(hours=2)
EARTH_RADIUS_NM = 3440.065

_JUST_BEFORE = timedelta(microseconds=1)


class Waypoint(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, frozen=True)

    lat: float = Field(ge=-85, le=85)
    lon: float = Field(ge=-180, lt=180)


class VesselRoute(BaseModel):
    """A closed loop: the vessel sails waypoint to waypoint and back from the last to the first, at constant speed."""

    model_config = ConfigDict(allow_inf_nan=False, frozen=True)

    # Shown on the vessel pages as the simulated route, so it must describe these waypoints (trimmed, 1-80 characters).
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    speed_kn: float = Field(gt=0, le=50)
    waypoints: tuple[Waypoint, ...] = Field(min_length=2)

    @model_validator(mode="after")
    def valid_segments(self) -> VesselRoute:
        for start, end in self.segments:
            if (start.lat, start.lon) == (end.lat, end.lon):
                raise ValueError("a route segment has zero length (repeated waypoint)")
            if abs(end.lon - start.lon) >= 180:
                raise ValueError("a route segment crosses the antimeridian, which phase 1 routes do not support")
        return self

    @property
    def segments(self) -> list[tuple[Waypoint, Waypoint]]:
        points = self.waypoints
        return [(points[index], points[(index + 1) % len(points)]) for index in range(len(points))]

    @cached_property
    def segment_lengths_nm(self) -> tuple[float, ...]:
        return tuple(_central_angle(_vector(start), _vector(end)) * EARTH_RADIUS_NM for start, end in self.segments)


class FixedOutage(BaseModel):
    """Suppresses every report slot in [start, end)."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["fixed"] = "fixed"
    start: AwareDatetime
    end: AwareDatetime

    @model_validator(mode="after")
    def ends_after_start(self) -> FixedOutage:
        if self.end <= self.start:
            raise ValueError("an outage must end after it starts")
        return self

    def window_containing(self, at: datetime) -> tuple[datetime, datetime] | None:
        return (self.start, self.end) if self.start <= at < self.end else None


class RecurringOutage(BaseModel):
    """Window k covers [SCHEDULE_EPOCH + offset + k * period, that start + duration), anchored to UTC, not to server start."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["recurring"] = "recurring"
    period: timedelta
    offset: timedelta
    duration: timedelta

    @field_validator("duration")
    @classmethod
    def positive_duration(cls, duration: timedelta) -> timedelta:
        if duration <= timedelta(0):
            raise ValueError("duration must be positive")
        return duration

    @model_validator(mode="after")
    def fits_its_period(self) -> RecurringOutage:
        if not timedelta(0) <= self.offset < self.period:
            raise ValueError("offset must be at least 0 and less than the period")
        # Every gap between windows then holds at least one report slot, so the vessel reports between outages.
        if self.period - self.duration < REPORT_INTERVAL:
            raise ValueError("the gap between recurring windows must be at least one report interval")
        return self

    def window_containing(self, at: datetime) -> tuple[datetime, datetime] | None:
        cycle = (at - SCHEDULE_EPOCH - self.offset) // self.period
        start = SCHEDULE_EPOCH + self.offset + cycle * self.period
        return (start, start + self.duration) if at < start + self.duration else None


Outage = Annotated[FixedOutage | RecurringOutage, Field(discriminator="kind")]


class VesselSimulation(BaseModel):
    model_config = ConfigDict(frozen=True)

    route: VesselRoute
    outages: tuple[Outage, ...] = ()


def _route(label: str, speed_kn: float, *points: tuple[float, float]) -> VesselRoute:
    return VesselRoute(label=label, speed_kn=speed_kn, waypoints=tuple(Waypoint(lat=lat, lon=lon) for lat, lon in points))


# Backend-owned, version-controlled simulation configuration, assigned by vessel ID. Routes are hand-authored sea-lane
# loops for display; they make no claim of navigational accuracy. The outage windows are simulated, configurable demo
# scenarios that exercise the STALE and LOST states, not predictions about real vessel communications.
VESSEL_SIMULATIONS: dict[str, VesselSimulation] = {
    "baltic-guardian": VesselSimulation(route=_route("Baltic loop · Gulf of Gdańsk ↔ Gulf of Finland", 14.0, (54.80, 18.90), (55.40, 15.80), (57.30, 19.60), (59.60, 23.00), (57.00, 20.50))),
    "northern-star": VesselSimulation(
        route=_route("North Sea loop · Rotterdam ↔ Stavanger", 13.0, (52.00, 3.60), (54.00, 3.50), (57.50, 4.00), (58.80, 5.20), (56.00, 6.00)),
        # Demo: a 30-minute outage at 10 minutes past every UTC hour, so the vessel turns STALE and recovers.
        outages=(RecurringOutage(period=timedelta(hours=1), offset=timedelta(minutes=10), duration=timedelta(minutes=30)),),
    ),
    "ocean-sentinel": VesselSimulation(route=_route("Channel–Biscay loop · Ushant ↔ Cape Finisterre", 15.0, (49.80, -3.00), (48.20, -5.70), (45.50, -3.00), (43.50, -9.60), (47.00, -7.00))),
    "atlantic-trader": VesselSimulation(
        route=_route("Transatlantic loop · Western Approaches ↔ US north-east coast", 17.0, (49.50, -6.50), (47.00, -30.00), (44.00, -50.00), (40.40, -69.00), (38.00, -50.00), (40.00, -30.00), (47.50, -9.50)),
        # Demo: a 3-hour outage at 02:00 and 14:00 UTC, so the vessel reaches LOST and recovers.
        outages=(RecurringOutage(period=timedelta(hours=12), offset=timedelta(hours=2), duration=timedelta(hours=3)),),
    ),
    "iron-horizon": VesselSimulation(route=_route("Mediterranean loop · Gibraltar ↔ Port Said", 16.0, (36.00, -5.50), (37.50, 2.00), (37.30, 11.50), (34.50, 24.00), (31.80, 32.00), (33.00, 26.00), (35.50, 16.00), (37.00, 0.50))),
    "calypso": VesselSimulation(route=_route("Gulf of Aden loop · Bab el-Mandeb ↔ Socotra approaches", 12.0, (12.55, 43.45), (12.10, 46.00), (12.70, 49.50), (13.20, 52.50), (12.40, 49.00), (11.90, 45.50))),
}


def route_label(vessel_id: str) -> str | None:
    """The configured simulated route's label, or None for a vessel without a route."""
    simulation = VESSEL_SIMULATIONS.get(vessel_id)
    return simulation.route.label if simulation else None


def _vector(point: Waypoint) -> tuple[float, float, float]:
    lat, lon = math.radians(point.lat), math.radians(point.lon)
    return (math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat))


def _central_angle(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    cross = (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
    return math.atan2(math.sqrt(sum(component * component for component in cross)), sum(x * y for x, y in zip(a, b)))


def _bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial great-circle bearing from point 1 to point 2, in degrees clockwise from north."""
    phi1, phi2, delta = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    y = math.sin(delta) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta)
    return math.degrees(math.atan2(y, x)) % 360


def route_position(route: VesselRoute, report_at: datetime) -> tuple[float, float, float]:
    """(lat, lon, course_deg) at `report_at`, by spherical interpolation along the current great-circle segment."""
    hours = (report_at - SCHEDULE_EPOCH).total_seconds() / 3600
    distance = (route.speed_kn * hours) % sum(route.segment_lengths_nm)
    for (start, end), length in zip(route.segments, route.segment_lengths_nm):
        if distance < length:
            break
        distance -= length
    angle = length / EARTH_RADIUS_NM
    fraction = min(distance / length, 1.0)
    a, b = _vector(start), _vector(end)
    weight_a, weight_b = math.sin((1 - fraction) * angle) / math.sin(angle), math.sin(fraction * angle) / math.sin(angle)
    x, y, z = (weight_a * p + weight_b * q for p, q in zip(a, b))
    lat, lon = math.degrees(math.atan2(z, math.hypot(x, y))), math.degrees(math.atan2(y, x))
    # The course along the arc at this point, taken from the farther waypoint so it stays defined near either end.
    course = _bearing_deg(lat, lon, end.lat, end.lon) if fraction < 0.5 else (_bearing_deg(lat, lon, start.lat, start.lon) + 180) % 360
    lon = round((lon + 180) % 360 - 180, 5)
    return round(lat, 5), -180.0 if lon == 180.0 else lon, round(course, 1) % 360


def _latest_slot(at: datetime) -> datetime | None:
    if at < SCHEDULE_EPOCH:
        return None
    return SCHEDULE_EPOCH + ((at - SCHEDULE_EPOCH) // REPORT_INTERVAL) * REPORT_INTERVAL


def latest_report_time(simulation: VesselSimulation, at: datetime) -> datetime | None:
    """The latest slot at or before `at` outside every outage window; overlapping windows act as their union."""
    slot = _latest_slot(at)
    while slot is not None:
        windows = [window for window in (outage.window_containing(slot) for outage in simulation.outages) if window is not None]
        if not windows:
            return slot
        slot = _latest_slot(min(start for start, _ in windows) - _JUST_BEFORE)
    return None


def freshness_for_age(age: timedelta) -> Freshness:
    if age < STALE_AFTER:
        return Freshness.CURRENT
    if age < LOST_AFTER:
        return Freshness.STALE
    return Freshness.LOST


def vessel_position(vessel_id: str, simulation: VesselSimulation | None, at: datetime) -> VesselPosition | UnavailablePosition:
    if simulation is None:
        return UnavailablePosition(vessel_id=vessel_id, reason=UnavailableReason.NO_ROUTE)
    report_at = latest_report_time(simulation, at)
    if report_at is None:
        return UnavailablePosition(vessel_id=vessel_id, reason=UnavailableReason.NO_REPORT)
    lat, lon, course = route_position(simulation.route, report_at)
    return VesselPosition(
        vessel_id=vessel_id,
        lat=lat,
        lon=lon,
        course_deg=course,
        speed_kn=simulation.route.speed_kn,
        position_at=report_at,
        received_at=report_at,
        source=PositionSource.SIMULATED,
        freshness=freshness_for_age(at - report_at),
    )


def fleet_positions(vessel_ids: Iterable[str], at: datetime, simulations: Mapping[str, VesselSimulation] | None = None) -> VesselPositionsResponse:
    """The latest report for each listed vessel, in the given order; vessels without one are listed as unavailable."""
    configured = VESSEL_SIMULATIONS if simulations is None else simulations
    results = [vessel_position(vessel_id, configured.get(vessel_id), at) for vessel_id in vessel_ids]
    return VesselPositionsResponse(
        evaluated_at=at,
        positions=[result for result in results if isinstance(result, VesselPosition)],
        unavailable=[result for result in results if isinstance(result, UnavailablePosition)],
    )
