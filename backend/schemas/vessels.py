from models.events import Vessel
from simulation.vessel_positions import route_label


class VesselResponse(Vessel):
    """A vessel as the vessel endpoints return it: every Vessel field, plus its simulated route's label."""

    # From the backend route configuration (simulation/vessel_positions.py); None for a vessel without a route.
    route_label: str | None = None


def vessel_response(vessel: Vessel) -> VesselResponse:
    return VesselResponse(**vessel.model_dump(exclude={"status"}), route_label=route_label(vessel.id))
