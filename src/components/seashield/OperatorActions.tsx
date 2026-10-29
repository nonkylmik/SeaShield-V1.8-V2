import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { onlineText, utcStamp } from "@/lib/seashield/format";
import { canStartInvestigation, injectionTarget } from "@/lib/seashield/operatorActions";
import { incidentService, simulationService } from "@/lib/seashield/services";
import type { ScenarioId } from "@/lib/seashield/store";
import type { Incident } from "@/lib/seashield/types";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import { cn } from "@/lib/utils";

/** Operator actions in the tactical map's vessel panel. Simulation only: nothing here reaches a real vessel. */

type PendingInjection = {
  vesselId: string;
  vesselName: string;
  imo: string;
  scenarioId: ScenarioId;
  label: string;
  eventType: string | null;
};

/**
 * Injects a simulated event for `vesselId` after explicit confirmation of the vessel and event type. Only one
 * injection is in flight at a time; there is no fallback vessel ("all" means none chosen).
 */
export function SimulatedInjection({ vesselId: selectedVesselId }: { vesselId: string | "all" }) {
  const vessels = useSeaShield((s) => s.vessels);
  const dataSource = useSeaShield((s) => s.dataSource);
  const backend = useSeaShield((s) => s.connection.backend);
  const target = injectionTarget({ selectedVesselId, vessels, dataSource, backend });
  const [scenarioId, setScenarioId] = useState<ScenarioId | "">("");
  const [confirming, setConfirming] = useState<PendingInjection | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const scenario = simulationService.scenarios.find((candidate) => candidate.id === scenarioId);

  const review = () => {
    if (target.kind !== "ready" || !scenario || pending) return;
    setResult(null);
    setConfirming({
      vesselId: target.vesselId,
      vesselName: target.vesselName,
      imo: target.imo,
      scenarioId: scenario.id,
      label: scenario.label,
      eventType: simulationService.eventType(scenario.id),
    });
  };
  const confirm = async (request: PendingInjection) => {
    setConfirming(null);
    setPending(true);
    const outcome = await simulationService.inject(request.scenarioId, request.vesselId);
    setPending(false);
    if (outcome.status === "busy") return;
    setResult({ ok: outcome.status === "done", message: outcome.message });
  };

  return (
    <div className="border-t border-border px-3 py-2">
      <h3 className="label-mono mb-1.5 flex items-center gap-2">
        Simulated event injection
        <span className="rounded-sm border border-caution/50 px-1 text-caution">Simulation</span>
      </h3>
      <p className="mb-2 text-xs text-muted-foreground">
        Adds a simulated event to the SeaShield simulation for this vessel. No real vessel, sensor
        or onboard system is contacted.
      </p>
      {target.kind === "unavailable" ? (
        <p role="status" className="text-xs text-warning">
          {target.reason}
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <select
            value={scenarioId}
            onChange={(event) => setScenarioId(event.target.value as ScenarioId | "")}
            aria-label="Simulated event type"
            disabled={pending}
            className="h-7 min-w-0 flex-1 rounded-sm border border-input bg-background px-2 text-xs"
          >
            <option value="">Choose a simulated event…</option>
            {simulationService.scenarios.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} · {option.group}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={review}
            disabled={!scenario || pending}
            className="h-7 shrink-0 rounded-sm border border-signal/50 bg-signal/10 px-2 text-xs text-signal hover:bg-signal/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "Injecting…" : "Inject…"}
          </button>
        </div>
      )}
      {result ? (
        <p
          role={result.ok ? "status" : "alert"}
          className={cn("mt-2 text-xs", result.ok ? "text-signal" : "text-warning")}
        >
          {result.ok ? "Simulated: " : "Not injected: "}
          {result.message}
        </p>
      ) : null}
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Inject a simulated event?</AlertDialogTitle>
            <AlertDialogDescription>
              This adds a simulated event to the SeaShield simulation. No real vessel or onboard
              system is affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirming ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="label-mono">Target vessel</dt>
              <dd>
                {confirming.vesselName}
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {confirming.imo || "no IMO"} · {confirming.vesselId}
                </span>
              </dd>
              <dt className="label-mono">Event</dt>
              <dd>
                {confirming.label}
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {confirming.eventType ?? "not mapped to a backend event"}
                </span>
              </dd>
            </dl>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!confirming?.eventType}
              onClick={() => {
                if (confirming) void confirm(confirming);
              }}
            >
              Inject simulated event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** NEW → INVESTIGATING for one incident; shown only where canStartInvestigation allows it. */
export function StartInvestigation({ incident }: { incident: Incident }) {
  const backendOnline = useSeaShield((s) => s.connection.backend === "online");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offered = pending || canStartInvestigation(incident);
  if (!offered && !error) return null;

  const start = async () => {
    setPending(true);
    setError(null);
    const outcome = await incidentService.startInvestigation(incident.id);
    setPending(false);
    if (outcome.status === "failed" || outcome.status === "not-allowed") setError(outcome.message);
  };

  return (
    <div className="mt-1 ml-1 flex flex-wrap items-center gap-2">
      {offered ? (
        <button
          type="button"
          onClick={() => void start()}
          disabled={pending || !backendOnline}
          title={backendOnline ? undefined : "Backend unreachable"}
          aria-label={`Start investigation of ${incident.ref}`}
          className="label-mono rounded-sm border border-signal/50 px-1.5 py-0.5 text-signal hover:bg-signal/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Starting investigation…" : "Start investigation"}
        </button>
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-warning">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The vessel's cameras as the backend describes them: location, online, recording and last heartbeat. Metadata of a
 * simulated camera only; there is no video feed and no frame rate or uptime is shown.
 */
export function VesselCameras({ vesselId }: { vesselId: string }) {
  const cameras = useSeaShield((s) => s.cameras).filter((camera) => camera.vesselId === vesselId);
  const demo = useSeaShield((s) => s.dataSource !== "backend");
  return (
    <div className="border-t border-border px-3 py-2">
      <h3 className="label-mono mb-1.5">Cameras · simulated metadata</h3>
      {cameras.length ? (
        <ul className="space-y-1.5 text-xs">
          {cameras.map((camera) => (
            <li key={camera.id}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 break-words">{camera.zone}</span>
                <span className={cn("label-mono shrink-0", onlineText[camera.state])}>
                  {camera.state}
                </span>
              </div>
              <div className="tabular text-muted-foreground">
                {camera.recording ? "Recording (simulated)" : "Not recording"} · last heartbeat{" "}
                {utcStamp(camera.lastFrame)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="label-mono normal-case">No simulated camera on this vessel.</p>
      )}
      <p className="label-mono mt-1.5 normal-case text-caution">
        Simulated camera · metadata only, no video feed{demo ? " · demo data" : ""}
      </p>
    </div>
  );
}
