import type { Incident, OnlineState, Vessel } from "./types";

/**
 * Rules for the operator actions in the tactical map's vessel panel: injecting a simulated event for the selected
 * vessel and starting an investigation. Type-only imports, so tests load it without a bundler.
 */

/** The vessel a simulated event would be injected for, or why none can be. Never a substitute vessel. */
export type InjectionTarget =
  | { kind: "ready"; vesselId: string; vesselName: string; imo: string }
  | { kind: "unavailable"; reason: string };

export function injectionTarget(input: {
  selectedVesselId: string | "all";
  vessels: Pick<Vessel, "id" | "name" | "imo">[];
  dataSource: "seed" | "backend";
  backend: OnlineState;
}): InjectionTarget {
  const { selectedVesselId, vessels, dataSource, backend } = input;
  if (selectedVesselId === "all")
    return { kind: "unavailable", reason: "Select a vessel to inject a simulated event." };
  if (dataSource !== "backend")
    return {
      kind: "unavailable",
      reason:
        "No backend data received: the vessels listed are demo data and cannot receive simulated events.",
    };
  if (backend !== "online")
    return {
      kind: "unavailable",
      reason: "Backend unreachable: simulated events cannot be injected until it reconnects.",
    };
  const vessel = vessels.find((candidate) => candidate.id === selectedVesselId);
  if (!vessel)
    return {
      kind: "unavailable",
      reason:
        "This vessel is not in the backend vessel list, so it cannot receive simulated events.",
    };
  return { kind: "ready", vesselId: vessel.id, vesselName: vessel.name, imo: vessel.imo };
}

/**
 * Runs at most one task per key at a time. A call while that key's task is pending is refused (not queued), so a
 * double click or a repeated confirmation never sends a second request.
 */
export function inFlightGuard() {
  const pending = new Set<string>();
  return {
    isPending: (key: string) => pending.has(key),
    async run<R>(
      key: string,
      task: () => Promise<R>,
    ): Promise<{ ran: false } | { ran: true; value: R }> {
      if (pending.has(key)) return { ran: false };
      pending.add(key);
      try {
        return { ran: true, value: await task() };
      } finally {
        pending.delete(key);
      }
    },
  };
}

/**
 * "Start investigation" is NEW → INVESTIGATING only: offered for a NEW incident ("open" in the UI) and only when the
 * backend lists INVESTIGATING among its allowed transitions. CONTAINED → INVESTIGATING is not this action.
 */
export function canStartInvestigation(
  incident: Pick<Incident, "status" | "allowedStatuses">,
): boolean {
  return incident.status === "open" && incident.allowedStatuses.includes("investigating");
}
