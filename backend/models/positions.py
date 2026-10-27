"""Contract of GET /api/v1/vessels/positions: the latest simulated position report per vessel.

Two times are kept apart: `position_at` is when the represented position was reported, while a vessel's
`last_communication` (models/events.py) is the time of its latest security event. Freshness is classified from
`evaluated_at - position_at` only, never from the request time or a security event.
"""
from enum import Enum
from typing import Annotated

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

VesselId = Annotated[str, Field(min_length=1, max_length=100)]


class PositionSource(str, Enum):
    SIMULATED = "SIMULATED"


class Freshness(str, Enum):
    CURRENT = "CURRENT"
    STALE = "STALE"
    LOST = "LOST"


class UnavailableReason(str, Enum):
    NO_ROUTE = "NO_ROUTE"
    NO_REPORT = "NO_REPORT"


class VesselPosition(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, frozen=True)

    vessel_id: VesselId
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    course_deg: float | None = Field(default=None, ge=0, lt=360)
    speed_kn: float | None = Field(default=None, ge=0)
    position_at: AwareDatetime
    # For simulated reports: the report's recorded receipt time (equal to position_at), not a network receipt time.
    received_at: AwareDatetime
    source: PositionSource
    freshness: Freshness

    @model_validator(mode="after")
    def received_after_reported(self) -> "VesselPosition":
        if self.received_at < self.position_at:
            raise ValueError("received_at must not be earlier than position_at")
        return self


class UnavailablePosition(BaseModel):
    model_config = ConfigDict(frozen=True)

    vessel_id: VesselId
    reason: UnavailableReason


class VesselPositionsResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    evaluated_at: AwareDatetime
    positions: list[VesselPosition]
    unavailable: list[UnavailablePosition]

    @model_validator(mode="after")
    def reports_not_in_the_future(self) -> "VesselPositionsResponse":
        for position in self.positions:
            if position.position_at > self.evaluated_at or position.received_at > self.evaluated_at:
                raise ValueError(f"position report for {position.vessel_id} is later than evaluated_at")
        listed = [position.vessel_id for position in self.positions] + [item.vessel_id for item in self.unavailable]
        if len(listed) != len(set(listed)):
            raise ValueError("each vessel must appear exactly once in positions or unavailable")
        return self
