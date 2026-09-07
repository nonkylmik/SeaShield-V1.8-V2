import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { securityService } from "@/lib/seashield/services";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import { stateColor } from "@/lib/seashield/format";
import { Metric, PageHeader, Panel, ScoreBar, SimBanner } from "@/components/seashield/primitives";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Security Reporting — SeaShield" },
      {
        name: "description",
        content:
          "SeaShield reporting view: security events by category, incident breakdown, camera and sensor uptime, access violations and per-vessel security score (simulated).",
      },
      { property: "og:title", content: "Security Reporting — SeaShield" },
      {
        property: "og:description",
        content: "Compliance-oriented reporting across events, uptime, violations and security scores.",
      },
    ],
  }),
  component: ReportsView,
});

function ReportsView() {
  const scope = useSeaShield((s) => s.selectedVesselId);
  const state = useSeaShield((s) => s);
  const s = useMemo(() => securityService.fleetSummary(scope), [scope, state]);

  const inScope = <T extends { vesselId: string }>(rows: T[]) =>
    scope === "all" ? rows : rows.filter((r) => r.vesselId === scope);

  const events = inScope(state.events);
  const cameras = inScope(state.cameras);
  const sensors = inScope(state.sensors);
  const access = inScope(state.access);
  const incidents = inScope(state.incidents);
  const vessels = scope === "all" ? state.vessels : state.vessels.filter((v) => v.id === scope);

  const byCategory = ["cyber", "access", "sensor", "camera", "navigation", "system"].map((c) => ({
    c,
    n: events.filter((e) => e.category === c).length,
  }));
  const max = Math.max(1, ...byCategory.map((b) => b.n));

  const camUptime = cameras.length
    ? cameras.reduce((a, c) => a + c.uptime, 0) / cameras.length
    : 0;
  const senUptime = sensors.length ? sensors.reduce((a, c) => a + c.uptime, 0) / sensors.length : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Security Reporting"
        subtitle="Reporting period: current simulated session"
        actions={<SimBanner text="Simulated reporting data — not for compliance use" />}
      />
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Metric label="Security events" value={events.length} sub="in current scope" />
          <Metric label="Incidents" value={incidents.length} sub={`${s.activeIncidents} still active`} />
          <Metric
            label="Camera uptime"
            value={`${camUptime.toFixed(1)}%`}
            tone={camUptime > 98 ? "secure" : "caution"}
          />
          <Metric
            label="Sensor uptime"
            value={`${senUptime.toFixed(1)}%`}
            tone={senUptime > 98 ? "secure" : "caution"}
          />
          <Metric
            label="Access violations"
            value={access.filter((a) => a.result !== "authorized").length}
            tone="caution"
          />
          <Metric label="Avg security score" value={s.avgScore} tone={s.avgScore >= 86 ? "secure" : "caution"}>
            <ScoreBar score={s.avgScore} />
          </Metric>
        </div>

        <div className="grid gap-2 xl:grid-cols-3">
          <Panel title="Events by category" meta="current session" scroll>
            <ul className="space-y-2 p-3">
              {byCategory.map((b) => (
                <li key={b.c}>
                  <div className="flex justify-between text-xs">
                    <span className="label-mono">{b.c}</span>
                    <span className="tabular">{b.n}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div className="h-full bg-signal" style={{ width: `${(b.n / max) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Incident breakdown" meta="by severity and status" scroll>
            <table className="w-full text-xs">
              <tbody>
                {["critical", "high", "medium", "low", "info"].map((sev) => (
                  <tr key={sev} className="border-b border-border/50">
                    <td className="label-mono px-3 py-1.5">{sev}</td>
                    <td className="tabular px-3 py-1.5 text-right">
                      {incidents.filter((i) => i.severity === sev).length}
                    </td>
                  </tr>
                ))}
                {["open", "investigating", "contained", "closed"].map((st) => (
                  <tr key={st} className="border-b border-border/50">
                    <td className="label-mono px-3 py-1.5 text-signal">{st}</td>
                    <td className="tabular px-3 py-1.5 text-right">
                      {incidents.filter((i) => i.status === st).length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Per-vessel security score" meta="simulated scoring model" scroll>
            <ul>
              {vessels.map((v) => (
                <li key={v.id} className="border-b border-border/50 px-3 py-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate">{v.name}</span>
                    <span className={cn("tabular font-semibold", stateColor[v.securityState])}>
                      {v.securityScore}
                    </span>
                  </div>
                  <div className="mt-1">
                    <ScoreBar score={v.securityScore} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <Panel title="Camera and sensor availability" meta="device level" className="max-h-96" scroll>
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-panel-header">
              <tr className="border-b border-border">
                {["Device", "Type", "Location / zone", "State", "Uptime"].map((h) => (
                  <th key={h} className="label-mono px-3 py-1.5 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cameras.map((c) => (
                <tr key={c.id} className="border-b border-border/50">
                  <td className="tabular px-3 py-1.5">{c.label}</td>
                  <td className="label-mono px-3 py-1.5">camera</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{c.zone}</td>
                  <td className="label-mono px-3 py-1.5">{c.state}</td>
                  <td className="tabular px-3 py-1.5">{c.uptime.toFixed(1)}%</td>
                </tr>
              ))}
              {sensors.map((c) => (
                <tr key={c.id} className="border-b border-border/50">
                  <td className="tabular px-3 py-1.5">{c.id.toUpperCase()}</td>
                  <td className="label-mono px-3 py-1.5">{c.kind}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{c.location}</td>
                  <td className="label-mono px-3 py-1.5">{c.state}</td>
                  <td className="tabular px-3 py-1.5">{c.uptime.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
