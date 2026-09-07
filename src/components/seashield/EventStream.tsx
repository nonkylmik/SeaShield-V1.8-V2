import { eventService } from "@/lib/seashield/services";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import { severityText, utcTime } from "@/lib/seashield/format";
import { SeverityTag } from "./primitives";
import { cn } from "@/lib/utils";

export function EventStream({ limit = 60 }: { limit?: number }) {
  const scope = useSeaShield((s) => s.selectedVesselId);
  const events = useSeaShield((s) => s.events);
  const vessels = useSeaShield((s) => s.vessels);
  const rows = (scope === "all" ? events : events.filter((e) => e.vesselId === scope)).slice(0, limit);
  const name = (id: string) => vessels.find((v) => v.id === id)?.name ?? id;

  return (
    <table className="w-full border-collapse text-xs">
      <thead className="sticky top-0 z-10 bg-panel-header">
        <tr className="border-b border-border">
          {["Time", "Sev", "Category", "Vessel", "Event", "Source", ""].map((h) => (
            <th key={h} className="label-mono px-3 py-1.5 text-left font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => (
          <tr key={e.id} className="border-b border-border/50 hover:bg-accent/40">
            <td className="tabular px-3 py-1.5 whitespace-nowrap text-muted-foreground">{utcTime(e.ts)}</td>
            <td className="px-3 py-1.5">
              <SeverityTag severity={e.severity} />
            </td>
            <td className="label-mono px-3 py-1.5">{e.category}</td>
            <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{name(e.vesselId)}</td>
            <td className="px-3 py-1.5">
              <span className={cn("font-medium", severityText[e.severity])}>{e.title}</span>
              <span className="ml-2 text-muted-foreground">{e.detail}</span>
            </td>
            <td className="tabular px-3 py-1.5 text-muted-foreground">{e.source}</td>
            <td className="px-3 py-1.5 text-right">
              {e.acknowledged ? (
                <span className="label-mono">ack</span>
              ) : (
                <button
                  onClick={() => eventService.acknowledge(e.id)}
                  className="label-mono border border-border px-1.5 py-0.5 hover:bg-accent"
                >
                  ack
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
