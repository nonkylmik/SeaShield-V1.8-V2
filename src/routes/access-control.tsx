import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { securityService } from "@/lib/seashield/services";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import { utcStamp } from "@/lib/seashield/format";
import { Metric, PageHeader, Panel, SimBanner } from "@/components/seashield/primitives";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/access-control")({
  head: () => ({
    meta: [
      { title: "Access Control — SeaShield" },
      {
        name: "description",
        content:
          "Simulated vessel access control log in SeaShield: authorized, denied and suspicious credential events across restricted shipboard areas.",
      },
      { property: "og:title", content: "Access Control — SeaShield" },
      {
        property: "og:description",
        content: "Authorized, denied and suspicious access events for restricted vessel areas.",
      },
    ],
  }),
  component: AccessView,
});

const RESULT_CLS = {
  authorized: "text-secure",
  denied: "text-warning",
  suspicious: "text-critical",
} as const;

function AccessView() {
  const scope = useSeaShield((s) => s.selectedVesselId);
  const access = useSeaShield((s) => s.access);
  const vessels = useSeaShield((s) => s.vessels);
  const rows = useMemo(
    () => securityService.accessRecords(scope).slice().sort((a, b) => b.ts - a.ts),
    [scope, access],
  );
  const name = (id: string) => vessels.find((v) => v.id === id)?.name ?? id;

  const areas = Array.from(new Set(rows.filter((r) => r.restricted).map((r) => r.area)));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Access Control"
        subtitle="Simulated credential events from vessel access control gateways"
        actions={<SimBanner />}
      />
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Metric label="Events in scope" value={rows.length} />
          <Metric
            label="Authorized"
            value={rows.filter((r) => r.result === "authorized").length}
            tone="secure"
          />
          <Metric
            label="Denied"
            value={rows.filter((r) => r.result === "denied").length}
            tone={rows.some((r) => r.result === "denied") ? "warning" : "secure"}
          />
          <Metric
            label="Suspicious"
            value={rows.filter((r) => r.result === "suspicious").length}
            tone={rows.some((r) => r.result === "suspicious") ? "critical" : "secure"}
          />
        </div>

        <div className="grid gap-2 xl:grid-cols-[1fr_18rem]">
          <Panel title="Access event log" meta={`${rows.length} records`} className="max-h-[34rem]" scroll>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel-header">
                <tr className="border-b border-border">
                  {["Timestamp", "Vessel", "Area", "Credential", "Holder", "Restricted", "Result"].map((h) => (
                    <th key={h} className="label-mono px-3 py-1.5 text-left font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-accent/40">
                    <td className="tabular px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                      {utcStamp(r.ts)}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{name(r.vesselId)}</td>
                    <td className="px-3 py-1.5">{r.area}</td>
                    <td className="tabular px-3 py-1.5">{r.credential}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.person}</td>
                    <td className="label-mono px-3 py-1.5">{r.restricted ? "yes" : "no"}</td>
                    <td className={cn("label-mono px-3 py-1.5 font-semibold", RESULT_CLS[r.result])}>
                      {r.result}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Restricted areas" meta="simulated zones" scroll>
            <ul>
              {areas.map((a) => {
                const violations = rows.filter((r) => r.area === a && r.result !== "authorized").length;
                return (
                  <li key={a} className="flex items-center justify-between border-b border-border/50 px-3 py-2 text-xs">
                    <span>{a}</span>
                    <span className={cn("tabular", violations ? "text-warning" : "text-secure")}>
                      {violations} violations
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
