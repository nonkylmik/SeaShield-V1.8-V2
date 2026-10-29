import { useRef, useState, type ReactNode } from "react";
import { FastForward, Play, RotateCcw, Square } from "lucide-react";
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
import { simulationService, type ActionResult } from "@/lib/seashield/services";
import {
  consoleInjectionTarget,
  scenarioControls,
  scenarioPanelView,
  startPlan,
  type ScenarioPanelView,
} from "@/lib/seashield/simulationControls";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import { utcTime } from "@/lib/seashield/format";
import { SimulatedInjection } from "./OperatorActions";
import { Panel } from "./primitives";
import { cn } from "@/lib/utils";

type Control = "start" | "next" | "stop" | "reset";

export function SimulationConsole({ className }: { className?: string }) {
  const vessels = useSeaShield((s) => s.vessels);
  const selected = useSeaShield((s) => s.selectedVesselId);
  const log = useSeaShield((s) => s.simLog);
  const logAvailable = useSeaShield((s) => s.simLogAvailable);
  const status = useSeaShield((s) => s.simulationStatus);
  const scenarios = useSeaShield((s) => s.simulationScenarios);
  const lastRefreshAt = useSeaShield((s) => s.lastRefreshAt);
  const backend = useSeaShield((s) => s.connection.backend);
  const view = scenarioPanelView({ lastRefreshAt, backend, status, scenarios });
  const controls = scenarioControls(view, backend, scenarios);

  const [scenarioKey, setScenarioKey] = useState("");
  const [pending, setPending] = useState<Control | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  // Only the key is kept: what starting it would do (including what it replaces) is recomputed from the latest
  // status on every render, so a scenario another operator starts while the dialog is open is shown.
  const [startKey, setStartKey] = useState<string | null>(null);
  const plan = startKey === null ? null : startPlan(startKey, scenarios, view);
  const [confirmReset, setConfirmReset] = useState(false);
  const [targetChoice, setTargetChoice] = useState<string | null>(null);
  const target = consoleInjectionTarget(targetChoice, selected);

  // Set synchronously, unlike state: a repeat in the same tick (a double click) is refused here and cannot clear the
  // in-progress state of the request that is still running.
  const inFlight = useRef(false);
  /** One control request at a time; the outcome shown is the backend's, success or failure. */
  const run = async (control: Control, action: () => Promise<ActionResult>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(control);
    setOutcome(null);
    try {
      const result = await action();
      if (result.status !== "busy")
        setOutcome({ ok: result.status === "done", message: result.message });
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  };

  return (
    <Panel
      title="Simulation engine"
      meta="Prototype V1 · rule-based correlation (not AI)"
      className={className}
      actions={
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          disabled={!controls.canReset || pending !== null}
          className="label-mono flex items-center gap-1.5 border border-border px-2 py-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw className="size-3" /> {pending === "reset" ? "Resetting…" : "Reset…"}
        </button>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <section className="border-b border-border px-3 py-2" aria-label="Scripted scenario">
          <h3 className="label-mono mb-1.5 flex items-center gap-2">
            Scripted scenario
            <span className="rounded-sm border border-caution/50 px-1 text-caution">
              Simulation
            </span>
          </h3>
          <ScenarioStatus view={view} />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Steps run only when you press Next step; there is no simulation clock. No real vessel or
            onboard system is affected.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <select
              value={scenarioKey}
              onChange={(event) => setScenarioKey(event.target.value)}
              aria-label="Scenario to start"
              disabled={!controls.canStart || pending !== null}
              className="h-7 min-w-0 flex-1 rounded-sm border border-input bg-background px-2 font-mono text-xs"
            >
              <option value="">
                {scenarios === null ? "Scenario list unavailable" : "Choose a scenario…"}
              </option>
              {(scenarios ?? []).map((scenario) => (
                <option key={scenario.key} value={scenario.key}>
                  {scenario.label} · {scenario.vesselName ?? scenario.vesselId} ·{" "}
                  {scenario.stepCount} steps
                </option>
              ))}
            </select>
            <ControlButton
              onClick={() => setStartKey(scenarioKey)}
              disabled={!controls.canStart || !scenarioKey || pending !== null}
              icon={<Play className="size-3" />}
              label={pending === "start" ? "Starting…" : "Start…"}
            />
            <ControlButton
              onClick={() => void run("next", simulationService.nextStep)}
              disabled={!controls.canNext || pending !== null}
              icon={<FastForward className="size-3" />}
              label={pending === "next" ? "Running step…" : "Next step"}
            />
            <ControlButton
              onClick={() => void run("stop", simulationService.stopScenario)}
              disabled={!controls.canStop || pending !== null}
              icon={<Square className="size-3" />}
              label={pending === "stop" ? "Stopping…" : "Stop"}
            />
          </div>
          {outcome ? (
            <p
              role={outcome.ok ? "status" : "alert"}
              className={cn("mt-2 text-xs", outcome.ok ? "text-signal" : "text-warning")}
            >
              {outcome.ok ? "" : "Failed: "}
              {outcome.message}
            </p>
          ) : null}
        </section>

        <section className="border-b border-border" aria-label="Single event injection">
          <div className="flex items-center gap-2 px-3 pt-2">
            <span className="label-mono">Target vessel</span>
            <select
              value={target === "all" ? "" : target}
              onChange={(event) => setTargetChoice(event.target.value)}
              aria-label="Target vessel for a simulated event"
              className="h-7 min-w-0 flex-1 rounded-sm border border-input bg-background px-2 font-mono text-xs"
            >
              <option value="">Choose a vessel…</option>
              {vessels.map((vessel) => (
                <option key={vessel.id} value={vessel.id}>
                  {vessel.name}
                </option>
              ))}
            </select>
          </div>
          <SimulatedInjection vesselId={target} />
        </section>

        {logAvailable ? null : (
          <div className="label-mono mx-3 my-2 border border-warning/40 bg-warning/10 px-2 py-1.5 normal-case text-warning">
            Simulation log unavailable
            {log.length ? " — showing the last entries received." : "."}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-xs">
            <tbody>
              {log.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-muted-foreground">
                    {logAvailable
                      ? "No simulated events recorded yet. Start a scenario or inject an event to see events, correlation and incidents update across the console."
                      : "No log entries received yet."}
                  </td>
                </tr>
              ) : (
                log.map((l) => (
                  <tr key={l.id} className="border-b border-border/60">
                    <td className="tabular w-16 px-3 py-1.5 text-muted-foreground">
                      {utcTime(l.ts)}
                    </td>
                    <td className="px-2 py-1.5 font-medium">{l.scenario}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{l.outcome}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={startKey !== null}
        onClose={() => setStartKey(null)}
        title={plan?.replaces ? "Replace the active scenario?" : "Start a simulated scenario?"}
        description="Starts the scripted scenario in the SeaShield simulation and runs its first step now. No real vessel or onboard system is affected."
        confirmLabel={plan?.replaces ? "Replace and start" : "Start scenario"}
        destructive={Boolean(plan?.replaces)}
        // The plan shown is the one confirmed; nothing is confirmed while it cannot be shown accurately.
        confirmDisabled={!plan || !controls.canStart}
        onConfirm={() => {
          if (plan && controls.canStart)
            void run("start", () => simulationService.startScenario(plan.scenario.key));
        }}
      >
        {plan ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="label-mono">Scenario</dt>
              <dd>
                {plan.scenario.label}
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {plan.scenario.key}
                </span>
              </dd>
              <dt className="label-mono">Target vessel</dt>
              <dd>
                {plan.scenario.vesselName ?? "Not in the current fleet"}
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {plan.scenario.vesselId} · fixed by the scenario
                </span>
              </dd>
              <dt className="label-mono">Steps</dt>
              <dd>{plan.scenario.stepCount} (step 1 runs now, then one per Next step)</dd>
            </dl>
            {plan.replaces ? (
              <p
                role="alert"
                className="mt-3 rounded-sm border border-warning/50 bg-warning/10 px-2 py-1.5 text-sm text-warning"
              >
                This replaces {plan.replaces.label}, which is {plan.replaces.state} at step{" "}
                {plan.replaces.step}
                {plan.replaces.stepCount === null ? "" : ` of ${plan.replaces.stepCount}`}. Its
                remaining steps will not run; events it already generated stay in the simulation.
              </p>
            ) : null}
            {controls.canStart ? null : (
              <p role="status" className="mt-3 text-sm text-warning">
                The simulation status is not known right now, so the scenario cannot be started.
              </p>
            )}
          </>
        ) : (
          <p role="status" className="text-sm text-warning">
            This scenario is no longer in the backend&apos;s scenario list.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset the simulation for the whole fleet?"
        description="Simulated data only; no real vessel or onboard system is affected."
        confirmLabel="Reset simulation"
        destructive
        onConfirm={() => void run("reset", simulationService.resetConfirmed)}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Every open security event across the fleet is resolved.</li>
          <li>
            Every open incident across the fleet is closed as resolved (“Closed by simulation
            reset”).
          </li>
          <li>Scenario progress and simulated camera status are cleared.</li>
        </ul>
      </ConfirmDialog>
    </Panel>
  );
}

function ScenarioStatus({ view }: { view: ScenarioPanelView }) {
  if (view.kind === "loading")
    return <p className="text-xs text-muted-foreground">Loading simulation status…</p>;
  if (view.kind === "unavailable")
    return (
      <p role="status" className="text-xs text-warning">
        {view.reason}
      </p>
    );
  if (view.kind === "idle") return <p className="text-xs">No active scenario.</p>;
  const steps =
    view.stepCount === null ? `step ${view.step}` : `step ${view.step} of ${view.stepCount}`;
  const state: Record<typeof view.state, string> = {
    running: "Running · waiting for the next step",
    paused: "Paused · steps are held",
    stopped: "Stopped",
    complete: "Complete · all steps ran",
  };
  return (
    <p className="text-xs">
      <span className="font-medium">{view.label}</span>
      <span className="text-muted-foreground">
        {" "}
        · {view.vesselName} · {steps}
      </span>
      <span
        className={cn(
          "label-mono ml-2",
          view.state === "running" ? "text-signal" : "text-muted-foreground",
        )}
      >
        {state[view.state]}
      </span>
    </p>
  );
}

function ControlButton({
  onClick,
  disabled,
  icon,
  label,
}: {
  onClick: () => void;
  disabled: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 shrink-0 items-center gap-1 rounded-sm border border-border px-2 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon} {label}
    </button>
  );
}

function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  destructive = false,
  confirmDisabled = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={cn(
              destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
