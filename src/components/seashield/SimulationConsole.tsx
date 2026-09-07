import { useState } from "react";
import { Play, RotateCcw, Zap } from "lucide-react";
import { simulationService } from "@/lib/seashield/services";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import { utcTime } from "@/lib/seashield/format";
import { Panel } from "./primitives";
import { cn } from "@/lib/utils";

export function SimulationConsole({ className }: { className?: string }) {
  const vessels = useSeaShield((s) => s.vessels);
  const selected = useSeaShield((s) => s.selectedVesselId);
  const log = useSeaShield((s) => s.simLog);
  const [target, setTarget] = useState<string>("");
  const vesselId = target || (selected !== "all" ? selected : vessels[0]!.id);
  const [flash, setFlash] = useState<string | null>(null);

  const fire = async (id: (typeof simulationService.scenarios)[number]["id"]) => {
    const outcome = await simulationService.trigger(id, vesselId);
    setFlash(outcome);
    window.setTimeout(() => setFlash(null), 4000);
  };

  return (
    <Panel
      title="Simulation engine"
      meta="Prototype V1 · rule-based correlation (not AI)"
      className={className}
      actions={
        <button
          onClick={() => void simulationService.reset()}
          className="label-mono flex items-center gap-1.5 border border-border px-2 py-1 hover:bg-accent"
        >
          <RotateCcw className="size-3" /> Reset
        </button>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="label-mono">Target vessel</span>
          <select
            value={vesselId}
            onChange={(e) => setTarget(e.target.value)}
            className="h-7 flex-1 rounded-sm border border-input bg-background px-2 font-mono text-xs outline-none focus:border-ring"
          >
            {vessels.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-1.5 p-3 xl:grid-cols-3">
          {simulationService.scenarios.map((s) => (
            <button
              key={s.id}
              onClick={() => fire(s.id)}
              className={cn(
                "group flex items-center justify-between gap-2 border border-border bg-secondary/40 px-2 py-2 text-left text-xs transition-colors hover:border-signal/60 hover:bg-accent",
                s.severity === "critical" && "border-critical/40 hover:border-critical",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{s.label}</span>
                <span className="label-mono text-[9px]">{s.group}</span>
              </span>
              <Play className="size-3 shrink-0 text-muted-foreground group-hover:text-signal" />
            </button>
          ))}
        </div>
        {flash ? (
          <div className="label-mono mx-3 mb-2 flex items-center gap-2 border border-signal/40 bg-signal/10 px-2 py-1.5 normal-case text-signal">
            <Zap className="size-3" /> {flash}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto border-t border-border">
          <table className="w-full text-xs">
            <tbody>
              {log.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-muted-foreground">
                    No simulated events triggered yet. Fire a scenario to see events, correlation and
                    incidents update across the console.
                  </td>
                </tr>
              ) : (
                log.map((l) => (
                  <tr key={l.id} className="border-b border-border/60">
                    <td className="tabular w-16 px-3 py-1.5 text-muted-foreground">{utcTime(l.ts)}</td>
                    <td className="px-2 py-1.5 font-medium">{l.scenario}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{l.outcome}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}
