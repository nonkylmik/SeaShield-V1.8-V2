import * as store from "./store";
import { resetBackendSimulation, runBackendScenario, updateBackendIncident } from "./backend";
import type {
  AccessRecord,
  Camera,
  CyberFinding,
  Incident,
  IncidentStatus,
  SecurityEvent,
  Sensor,
  Severity,
  Vessel,
} from "./types";

/**
 * Service layer. The UI must only talk to these abstractions.
 *
 * Prototype V1: every call resolves against the local simulation store.
 * Later: each method becomes an HTTP call to the Python/FastAPI backend
 * (FastAPI → security engine → PostgreSQL) without UI changes.
 */

const scope = <T extends { vesselId: string }>(rows: T[], vesselId: string | "all") =>
  vesselId === "all" ? rows : rows.filter((r) => r.vesselId === vesselId);

export const vesselService = {
  list: (): Vessel[] => store.getState().vessels,
  get: (id: string): Vessel | undefined => store.getState().vessels.find((v) => v.id === id),
  select: (id: string | "all") => store.selectVessel(id),
};

export const cameraService = {
  list: (vesselId: string | "all" = "all"): Camera[] =>
    scope(store.getState().cameras, vesselId),
};

export const sensorService = {
  list: (vesselId: string | "all" = "all"): Sensor[] =>
    scope(store.getState().sensors, vesselId),
};

export const eventService = {
  list: (vesselId: string | "all" = "all", limit = 100): SecurityEvent[] =>
    scope(store.getState().events, vesselId).slice(0, limit),
  acknowledge: (id: string) => store.acknowledgeEvent(id),
};

export const incidentService = {
  list: (vesselId: string | "all" = "all"): Incident[] =>
    scope(store.getState().incidents, vesselId),
  get: (id: string): Incident | undefined =>
    store.getState().incidents.find((i) => i.id === id || i.ref === id),
  create: (input: {
    title: string;
    vesselId: string;
    system: string;
    severity: Severity;
    assignee: string;
  }) => store.createIncident(input),
  setStatus: (id: string, status: IncidentStatus) => {
    store.setIncidentStatus(id, status);
    void updateBackendIncident(id, status).catch(() => undefined);
  },
  update: (id: string, patch: Partial<Pick<Incident, "severity" | "assignee" | "status">>) =>
    store.updateIncident(id, patch),
  addNote: (id: string, body: string, author: string) => store.addIncidentNote(id, body, author),
};

export const securityService = {
  cyberFindings: (vesselId: string | "all" = "all"): CyberFinding[] =>
    scope(store.getState().cyber, vesselId),
  accessRecords: (vesselId: string | "all" = "all"): AccessRecord[] =>
    scope(store.getState().access, vesselId),
  notifications: () => store.getState().notifications,
  markNotificationsRead: () => store.markNotificationsRead(),
  connection: () => store.getState().connection,
  operator: () => store.getState().operator,
  fleetSummary: (vesselId: string | "all" = "all") => {
    const s = store.getState();
    const vessels = vesselId === "all" ? s.vessels : s.vessels.filter((v) => v.id === vesselId);
    const cams = scope(s.cameras, vesselId);
    const sensors = scope(s.sensors, vesselId);
    const incidents = scope(s.incidents, vesselId);
    const cyber = scope(s.cyber, vesselId);
    const access = scope(s.access, vesselId);
    const avg = vessels.length
      ? Math.round(vessels.reduce((a, v) => a + v.securityScore, 0) / vessels.length)
      : 0;
    return {
      vessels: vessels.length,
      camerasOnline: cams.filter((c) => c.state === "online").length,
      camerasTotal: cams.length,
      sensorsOnline: sensors.filter((c) => c.state === "online").length,
      sensorsTotal: sensors.length,
      sensorAlarms: sensors.filter((s2) => s2.alarm).length,
      activeIncidents: incidents.filter((i) => i.status !== "closed").length,
      criticalIncidents: incidents.filter((i) => i.status !== "closed" && i.severity === "critical")
        .length,
      cyberAlerts: cyber.filter((c) => c.severity === "high" || c.severity === "critical").length,
      cyberTotal: cyber.length,
      unauthorizedAccess: access.filter((a) => a.result !== "authorized").length,
      avgScore: avg,
      fleetState:
        vessels.some((v) => v.securityState === "critical")
          ? ("critical" as const)
          : vessels.some((v) => v.securityState === "warning")
            ? ("warning" as const)
            : vessels.some((v) => v.securityState === "elevated")
              ? ("elevated" as const)
              : ("secure" as const),
    };
  },
};

export const simulationService = {
  scenarios: store.SCENARIOS,
  trigger: async (id: store.ScenarioId, vesselId: string) => {
    void vesselId;
    return runBackendScenario(id);
  },
  log: () => store.getState().simLog,
  reset: async () => resetBackendSimulation(),
};
