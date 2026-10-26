/** One entry of `GET /api/v1/simulation/log`: an event the simulation recorded. */
export type ApiSimulationLogEntry = {
  event_id: string;
  timestamp: string;
  vessel_id: string;
  event_type: string;
  severity: string;
  status: string;
  scenario: string;
  scenario_label: string;
  incident_ids: string[];
};

/**
 * The console line for a recorded simulation event, e.g. "MV Calypso · CAMERA OFFLINE (medium) → INC-0241".
 * Built only from what the backend recorded; nothing is generated in the browser.
 */
export function simulationLogOutcome(entry: ApiSimulationLogEntry, vesselName: string): string {
  const event = `${entry.event_type.replaceAll("_", " ")} (${entry.severity.toLowerCase()})`;
  const correlation = entry.incident_ids.length ? ` → ${entry.incident_ids.join(", ")}` : "";
  const resolved = entry.status === "RESOLVED" ? " · resolved" : "";
  return `${vesselName} · ${event}${correlation}${resolved}`;
}
