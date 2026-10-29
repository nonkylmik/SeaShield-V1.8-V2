import type {
  Incident,
  OnlineState,
  SecurityEvent,
  SecurityState,
  Severity,
  Vessel,
} from "./types";

/**
 * The fleet summary strip and the incident evidence on /map, from data the backend already sends: the fleet security
 * summary, the vessel list and the incidents (all read in one refresh, so they agree) and the loaded security events.
 * Nothing here scores or classifies: it counts and joins backend values. Type-only imports, so tests load it without
 * a bundler.
 */

/** How many of the most recent security events a refresh loads; older evidence is reported as not loaded. */
export const LOADED_EVENT_LIMIT = 100;

/** Open until closed: the backend's RESOLVED and FALSE POSITIVE are "closed" in the UI. */
export const isOpenIncident = (incident: Pick<Incident, "status">) => incident.status !== "closed";

/** The backend's four security states and unknown, most severe first. */
export const SECURITY_STATE_ORDER: SecurityState[] = [
  "critical",
  "warning",
  "elevated",
  "secure",
  "unknown",
];

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

export type FleetSummaryView =
  | { kind: "loading" }
  /** No backend data has been received, so there is nothing to summarise. */
  | { kind: "unavailable" }
  | { kind: "empty"; asOf: number; live: boolean }
  | {
      kind: "summary";
      /** From the security summary; null when it sent no usable count. */
      vesselCount: number | null;
      /** The backend's fleet average and its classification of that average. */
      average: { score: number; state: SecurityState } | null;
      vesselsByState: Record<SecurityState, number>;
      openIncidents: number;
      openBySeverity: Record<Severity, number>;
      /** When the figures were received. */
      asOf: number;
      /** False when the backend is unreachable: the figures are the last ones received. */
      live: boolean;
    };

function countBy<K extends string>(keys: K[], values: K[]): Record<K, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const value of values) counts[value] += 1;
  return counts;
}

export function fleetSummaryView(input: {
  lastRefreshAt: number | null;
  backend: OnlineState;
  vesselCount: number | null;
  average: { score: number; state: SecurityState } | null;
  vessels: Pick<Vessel, "securityState">[];
  incidents: Pick<Incident, "status" | "severity">[];
}): FleetSummaryView {
  const { lastRefreshAt, backend, vesselCount } = input;
  // Before the first refresh the store holds demo fixtures, which must never be summarised as the fleet.
  if (lastRefreshAt === null) return { kind: backend === "online" ? "loading" : "unavailable" };
  const live = backend === "online";
  if (vesselCount === 0) return { kind: "empty", asOf: lastRefreshAt, live };
  const open = input.incidents.filter(isOpenIncident);
  return {
    kind: "summary",
    vesselCount,
    average: input.average,
    vesselsByState: countBy(
      SECURITY_STATE_ORDER,
      input.vessels.map((vessel) => vessel.securityState),
    ),
    openIncidents: open.length,
    openBySeverity: countBy(
      SEVERITY_ORDER,
      open.map((incident) => incident.severity),
    ),
    asOf: lastRefreshAt,
    live,
  };
}

export type EvidenceItem =
  | { kind: "loaded"; event: SecurityEvent }
  /** Linked by the backend but not among the events loaded; never dropped silently. */
  | { kind: "not-loaded"; eventId: string };

/**
 * The events an incident links as its evidence: loaded ones oldest first (the order the correlation built up), then
 * the ones outside the loaded window, in the incident's order.
 */
export function incidentEvidence(
  incident: Pick<Incident, "eventIds">,
  events: SecurityEvent[],
): { items: EvidenceItem[]; notLoaded: number } {
  const byId = new Map(events.map((event) => [event.id, event]));
  const ids = [...new Set(incident.eventIds)];
  const loaded = ids
    .flatMap((id) => byId.get(id) ?? [])
    .sort((a, b) => a.ts - b.ts)
    .map((event): EvidenceItem => ({ kind: "loaded", event }));
  const missing = ids
    .filter((id) => !byId.has(id))
    .map((eventId): EvidenceItem => ({ kind: "not-loaded", eventId }));
  return { items: [...loaded, ...missing], notLoaded: missing.length };
}
