import type { SecurityState } from "./types";

/**
 * The backend owns vessel security status (backend/models/security_status.py). The UI displays the status
 * the API sends and never classifies scores itself.
 */
const API_STATES = new Map<string, SecurityState>([
  ["SECURE", "secure"],
  ["ELEVATED", "elevated"],
  ["WARNING", "warning"],
  ["CRITICAL", "critical"],
]);

/** A missing or unrecognised status is shown as unknown, never as secure. */
export function securityStateFromApi(status: string | null | undefined): SecurityState {
  return (status && API_STATES.get(status.trim().toUpperCase())) || "unknown";
}

// Most severe first: a vessel that cannot be classified outranks every confirmed state except critical.
const FLEET_PRECEDENCE: SecurityState[] = ["critical", "unknown", "warning", "elevated", "secure"];

/** Fleet status is the most severe status of its vessels. */
export function fleetSecurityState(states: SecurityState[]): SecurityState {
  return FLEET_PRECEDENCE.find((state) => states.includes(state)) ?? "secure";
}

type Classified = { score: number; state: SecurityState };

/**
 * The average shown in a summary and its colour, both from the backend: for the whole fleet, the fleet average
 * and the backend's classification of that average (not the worst vessel's status); for one selected vessel,
 * its score and status. Without backend data the local average is shown unclassified.
 */
export function summaryAverage(
  vessels: { securityScore: number; securityState: SecurityState }[],
  singleVessel: boolean,
  fleetAverage: Classified | null,
): Classified {
  const [selected] = vessels;
  if (singleVessel && selected)
    return { score: selected.securityScore, state: selected.securityState };
  if (fleetAverage) return fleetAverage;
  const total = vessels.reduce((sum, vessel) => sum + vessel.securityScore, 0);
  return { score: vessels.length ? Math.round(total / vessels.length) : 0, state: "unknown" };
}
