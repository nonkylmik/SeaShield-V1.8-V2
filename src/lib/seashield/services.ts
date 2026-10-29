import { toast } from "sonner";
import * as store from "./store";
import {
  acknowledgeBackendEvent,
  addBackendIncidentNote,
  createBackendIncident,
  fetchVesselPositions,
  refreshSeaShieldBackend,
  reopenBackendIncident,
  resetBackendSimulation,
  runBackendScenario,
  scenarioEventType,
  updateBackendIncident,
} from "./backend";
import { canStartInvestigation, inFlightGuard, injectionTarget } from "./operatorActions";
import { fleetSecurityState, summaryAverage } from "./securityStatus";
import { describeWriteFailure, optimisticWrite } from "./writeFailures";
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
 * (FastAPI → security engine → database) without UI changes.
 */

/** Shows a failed write to the operator; failures are never swallowed. */
export function reportWriteFailure(action: string, cause: unknown) {
  const { title, description } = describeWriteFailure(action, cause);
  toast.error(title, { description });
}

/** After a failed write, re-read the authoritative backend state (degraded if it cannot be reached). */
const reconcileWithBackend = () =>
  refreshSeaShieldBackend().catch(() => store.hydrateFromBackend({ health: "degraded" }));

const scope = <T extends { vesselId: string }>(rows: T[], vesselId: string | "all") =>
  vesselId === "all" ? rows : rows.filter((r) => r.vesselId === vesselId);

/** Operator actions send at most one request at a time per key (see inFlightGuard). */
const actionGuard = inFlightGuard();

/** The outcome of an operator action; "busy" when the same action was already in flight and nothing was sent. */
export type ActionResult =
  | { status: "done"; message: string }
  | { status: "failed"; message: string }
  | { status: "busy" }
  /** Refused before any request was sent. */
  | { status: "not-allowed"; message: string };

export const vesselService = {
  list: (): Vessel[] => store.getState().vessels,
  get: (id: string): Vessel | undefined => store.getState().vessels.find((v) => v.id === id),
  select: (id: string | "all") => store.selectVessel(id),
};

export const positionService = {
  /** Simulated positions from the backend; rejects on failure so the map keeps its last good data. */
  fetch: () => fetchVesselPositions(),
};

export const cameraService = {
  list: (vesselId: string | "all" = "all"): Camera[] => scope(store.getState().cameras, vesselId),
};

export const sensorService = {
  list: (vesselId: string | "all" = "all"): Sensor[] => scope(store.getState().sensors, vesselId),
};

export const eventService = {
  list: (vesselId: string | "all" = "all", limit = 100): SecurityEvent[] =>
    scope(store.getState().events, vesselId).slice(0, limit),
  acknowledge: (id: string) =>
    optimisticWrite({
      apply: () => store.acknowledgeEvent(id),
      send: () => acknowledgeBackendEvent(id, store.getState().operator.name),
      report: (cause) => reportWriteFailure("Acknowledge event", cause),
      reconcile: reconcileWithBackend,
    }),
};

export const incidentService = {
  list: (vesselId: string | "all" = "all"): Incident[] =>
    scope(store.getState().incidents, vesselId),
  get: (id: string): Incident | undefined =>
    store.getState().incidents.find((i) => i.id === id || i.ref === id),
  create: async (input: {
    title: string;
    vesselId: string;
    system: string;
    severity: Severity;
    assignee: string;
  }): Promise<boolean> => {
    // Not optimistic: the backend assigns the incident ID, so the incident appears once it is saved.
    try {
      const incident = await createBackendIncident(input);
      store.notifyIncidentOpened(incident.incident_id, input.severity, input.vesselId, input.title);
      return true;
    } catch (cause) {
      reportWriteFailure("Create incident", cause);
      return false;
    }
  },
  setStatus: (id: string, status: IncidentStatus) =>
    optimisticWrite({
      apply: () => store.setIncidentStatus(id, status),
      send: () => updateBackendIncident(id, { status }, store.getState().operator.name),
      report: (cause) => reportWriteFailure("Update incident status", cause),
      reconcile: reconcileWithBackend,
    }),
  update: (id: string, patch: Partial<Pick<Incident, "severity" | "assignee" | "status">>) =>
    optimisticWrite({
      apply: () => store.updateIncident(id, patch),
      send: () => updateBackendIncident(id, patch, store.getState().operator.name),
      report: (cause) => reportWriteFailure("Update incident", cause),
      reconcile: reconcileWithBackend,
    }),
  /**
   * NEW → INVESTIGATING through the existing incident update, only where canStartInvestigation allows it. One request
   * per incident at a time; on failure the local change is undone, reported, and the backend state re-read.
   */
  startInvestigation: async (id: string): Promise<ActionResult> => {
    // A repeat while the request is in flight is "busy": the optimistic change already moved it out of NEW.
    if (actionGuard.isPending(`investigate:${id}`)) return { status: "busy" };
    const incident = incidentService.get(id);
    if (!incident || !canStartInvestigation(incident))
      return {
        status: "not-allowed",
        message: "Only a NEW incident can be moved to investigation.",
      };
    let failure = "";
    const attempt = await actionGuard.run(`investigate:${id}`, () =>
      optimisticWrite({
        apply: () => store.setIncidentStatus(id, "investigating"),
        send: () =>
          updateBackendIncident(id, { status: "investigating" }, store.getState().operator.name),
        report: (cause) => {
          failure = describeWriteFailure("Start investigation", cause).description;
          reportWriteFailure("Start investigation", cause);
        },
        reconcile: reconcileWithBackend,
      }),
    );
    if (!attempt.ran) return { status: "busy" };
    return attempt.value
      ? { status: "done", message: `${incident.ref} is now under investigation.` }
      : { status: "failed", message: failure };
  },
  isStartingInvestigation: (id: string) => actionGuard.isPending(`investigate:${id}`),
  /** Deliberately reopens a closed incident; not optimistic (the backend reopens its evidence too). */
  reopen: async (id: string, reason: string): Promise<boolean> => {
    try {
      await reopenBackendIncident(id, reason);
      return true;
    } catch (cause) {
      reportWriteFailure("Reopen incident", cause);
      return false;
    }
  },
  addNote: (id: string, body: string, author: string) =>
    optimisticWrite({
      apply: () => store.addIncidentNote(id, body, author),
      send: () => addBackendIncidentNote(id, body, author),
      report: (cause) => reportWriteFailure("Add note", cause),
      reconcile: reconcileWithBackend,
    }),
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
    const average = summaryAverage(vessels, vesselId !== "all", s.fleetAverage);
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
      avgScore: average.score,
      avgState: average.state,
      fleetState: fleetSecurityState(vessels.map((v) => v.securityState)),
    };
  },
};

export const simulationService = {
  scenarios: store.SCENARIOS,
  /** The outcome text, or null when the injection failed (the failure is reported). */
  trigger: async (id: store.ScenarioId, vesselId: string): Promise<string | null> => {
    try {
      return await runBackendScenario(id, vesselId);
    } catch (cause) {
      reportWriteFailure("Run scenario", cause);
      return null;
    }
  },
  /** The backend event type a scenario injects, shown before an operator confirms an injection. */
  eventType: (id: store.ScenarioId): string | null => scenarioEventType(id),
  /**
   * Injects one simulated event for one vessel, after the operator confirmed it. While an injection is in flight,
   * another is refused rather than queued. Never contacts a real vessel: it calls the backend simulation only.
   */
  inject: async (id: store.ScenarioId, vesselId: string): Promise<ActionResult> => {
    const s = store.getState();
    const target = injectionTarget({
      selectedVesselId: vesselId,
      vessels: s.vessels,
      dataSource: s.dataSource,
      backend: s.connection.backend,
    });
    if (target.kind !== "ready") return { status: "not-allowed", message: target.reason };
    const attempt = await actionGuard.run("inject", async (): Promise<ActionResult> => {
      try {
        return { status: "done", message: await runBackendScenario(id, vesselId) };
      } catch (cause) {
        reportWriteFailure("Inject simulated event", cause);
        return {
          status: "failed",
          message: describeWriteFailure("Inject simulated event", cause).description,
        };
      }
    });
    return attempt.ran ? attempt.value : { status: "busy" };
  },
  isInjecting: () => actionGuard.isPending("inject"),
  log: () => store.getState().simLog,
  reset: async (): Promise<boolean> => {
    try {
      await resetBackendSimulation();
      return true;
    } catch (cause) {
      reportWriteFailure("Reset simulation", cause);
      return false;
    }
  },
};
