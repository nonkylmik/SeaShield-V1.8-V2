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
