import type { IncidentStatus } from "./types";

/**
 * The backend owns the incident lifecycle (backend/models/incidents.py). The UI offers only the status changes
 * the backend lists for an incident; it keeps no copy of the rules.
 */
const UI_STATUS = new Map<string, IncidentStatus>([
  ["NEW", "open"],
  ["INVESTIGATING", "investigating"],
  ["CONTAINED", "contained"],
  ["RESOLVED", "closed"],
]);

/** The UI statuses the backend allows next. FALSE POSITIVE has no UI status, so it is not offered. */
export function uiAllowedStatuses(allowed: string[] | undefined): IncidentStatus[] {
  const statuses = (allowed ?? []).flatMap((status) => {
    const mapped = UI_STATUS.get(status.toUpperCase());
    return mapped ? [mapped] : [];
  });
  return [...new Set(statuses)];
}

/** Options for the status selector: the current status first, then the allowed changes. */
export function statusOptions(
  current: IncidentStatus,
  allowed: IncidentStatus[],
): IncidentStatus[] {
  return [current, ...allowed.filter((status) => status !== current)];
}
