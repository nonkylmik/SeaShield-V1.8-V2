import type { OnlineState } from "./types";

/**
 * Scripted-scenario controls in the dashboard's simulation console. The backend owns the scenarios
 * (GET /api/v1/simulation/scenarios) and their progress (GET /api/v1/simulation/status); this module only validates
 * and presents them. A scenario advances one step per request: there is no simulation clock. Type-only imports, so
 * tests load it without a bundler.
 */

export type SimulationRunState = "idle" | "running" | "paused" | "stopped" | "complete";

export interface SimulationStatus {
  /** The scenario key, or null when none has been started since the last reset. */
  scenario: string | null;
  state: SimulationRunState;
  /** Steps run so far. */
  index: number;
}

export interface ScenarioDefinition {
  key: string;
  label: string;
  /** Fixed by the scenario; the operator does not choose it. */
  vesselId: string;
  vesselName: string | null;
  stepCount: number;
}

const RUN_STATES = new Map<string, SimulationRunState>([
  ["IDLE", "idle"],
  ["RUNNING", "running"],
  ["PAUSED", "paused"],
  ["STOPPED", "stopped"],
  ["COMPLETE", "complete"],
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A valid status response, or null (shown as unavailable, never guessed). */
export function parseSimulationStatus(raw: unknown): SimulationStatus | null {
  if (!isRecord(raw)) return null;
  const scenario = raw["scenario"];
  const status = raw["status"];
  const index = raw["index"];
  const state = typeof status === "string" ? RUN_STATES.get(status.toUpperCase()) : undefined;
  if (!state || !(scenario === null || typeof scenario === "string")) return null;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return null;
  return { scenario, state, index };
}

/** The scenario list, or null when any entry breaks the contract (a partial list is never shown as complete). */
export function parseScenarios(raw: unknown): ScenarioDefinition[] | null {
  if (!Array.isArray(raw)) return null;
  const scenarios: ScenarioDefinition[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return null;
    const key = entry["key"];
    const label = entry["label"];
    const vesselId = entry["vessel_id"];
    const vesselName = entry["vessel_name"];
    const stepCount = entry["step_count"];
    if (
      typeof key !== "string" ||
      !key ||
      typeof label !== "string" ||
      typeof vesselId !== "string"
    )
      return null;
    if (!(vesselName === null || typeof vesselName === "string")) return null;
    if (typeof stepCount !== "number" || !Number.isInteger(stepCount) || stepCount < 1) return null;
    scenarios.push({ key, label, vesselId, vesselName, stepCount });
  }
  return scenarios;
}

export type ScenarioPanelView =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string }
  | { kind: "idle" }
  | {
      kind: "scenario";
      state: Exclude<SimulationRunState, "idle">;
      key: string;
      label: string;
      vesselName: string;
      step: number;
      /** Null when the scenario is not in the list the backend sent. */
      stepCount: number | null;
    };

export function scenarioPanelView(input: {
  lastRefreshAt: number | null;
  backend: OnlineState;
  status: SimulationStatus | null;
  scenarios: ScenarioDefinition[] | null;
}): ScenarioPanelView {
  const { lastRefreshAt, backend, status, scenarios } = input;
  if (lastRefreshAt === null)
    return backend === "online"
      ? { kind: "loading" }
      : { kind: "unavailable", reason: "No backend data received: simulation status is unknown." };
  if (!status)
    return { kind: "unavailable", reason: "Simulation status could not be read from the backend." };
  if (status.state === "idle" || status.scenario === null) return { kind: "idle" };
  const definition = scenarios?.find((scenario) => scenario.key === status.scenario);
  return {
    kind: "scenario",
    state: status.state,
    key: status.scenario,
    label: definition?.label ?? status.scenario,
    vesselName: definition ? (definition.vesselName ?? definition.vesselId) : "unknown vessel",
    step: status.index,
    stepCount: definition?.stepCount ?? null,
  };
}

/** Which controls are offered. Nothing is offered while the status is unknown or the backend is unreachable. */
export function scenarioControls(
  view: ScenarioPanelView,
  backend: OnlineState,
  scenarios: ScenarioDefinition[] | null,
) {
  const known = backend === "online" && (view.kind === "idle" || view.kind === "scenario");
  const state = view.kind === "scenario" ? view.state : null;
  return {
    canStart: known && scenarios !== null && scenarios.length > 0,
    canNext: known && state === "running",
    canStop: known && (state === "running" || state === "paused"),
  };
}

export interface StartPlan {
  scenario: ScenarioDefinition;
  /** The scenario this start replaces, when one is running or paused. */
  replaces: {
    label: string;
    step: number;
    stepCount: number | null;
    state: "running" | "paused";
  } | null;
}

/** What starting `key` would do, shown for confirmation; null for a key the backend did not list. */
export function startPlan(
  key: string,
  scenarios: ScenarioDefinition[] | null,
  view: ScenarioPanelView,
): StartPlan | null {
  const scenario = scenarios?.find((candidate) => candidate.key === key);
  if (!scenario) return null;
  if (view.kind === "scenario" && (view.state === "running" || view.state === "paused"))
    return {
      scenario,
      replaces: {
        label: view.label,
        step: view.step,
        stepCount: view.stepCount,
        state: view.state,
      },
    };
  return { scenario, replaces: null };
}

/**
 * The outcome line for a step, from the backend's response ({ event, correlation } or null). A null response means
 * no step ran; it is not reported as a step.
 */
export function stepOutcome(result: unknown, vesselName: (id: string) => string): string {
  if (!isRecord(result) || !isRecord(result["event"]))
    return "No step ran: no scenario is running.";
  const event = result["event"];
  const type =
    typeof event["event_type"] === "string" ? event["event_type"].replaceAll("_", " ") : "Event";
  const vessel =
    typeof event["vessel_id"] === "string" ? vesselName(event["vessel_id"]) : "unknown vessel";
  const correlation =
    isRecord(result["correlation"]) && typeof result["correlation"]["title"] === "string"
      ? ` · correlated: ${result["correlation"]["title"]}`
      : "";
  return `Simulated step: ${type} on ${vessel}${correlation}`;
}

/**
 * The injection target in the console: the operator's explicit choice, else the vessel selected in the top bar (a
 * prefill the confirmation dialog names), else none. Never the first vessel of the fleet.
 */
export function consoleInjectionTarget(
  choice: string | null,
  selectedVesselId: string | "all",
): string | "all" {
  if (choice !== null) return choice || "all";
  return selectedVesselId;
}
