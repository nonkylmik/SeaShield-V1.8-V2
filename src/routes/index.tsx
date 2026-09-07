import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { securityService } from "@/lib/seashield/services";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import { elapsed, severityText, stateColor, utcTime } from "@/lib/seashield/format";
import {
  Metric,
  PageHeader,
  Panel,
  ScoreBar,
  SeverityTag,
  SimBanner,
  StatusDot,
} from "@/components/seashield/primitives";
import { EventStream } from "@/components/seashield/EventStream";
import { SimulationConsole } from "@/components/seashield/SimulationConsole";
import { now } from "@/lib/seashield/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SeaShield — Security Operations Dashboard" },
      {
        name: "description",
        content:
          "SeaShield fleet security operations dashboard: vessel security status, CCTV, sensors, cyber alerts and active incidents (simulated prototype).",
      },
      { property: "og:title", content: "SeaShield — Security Operations Dashboard" },
      {
        property: "og:description",
        content: "Fleet-wide maritime physical and cybersecurity monitoring console.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const scope = useSeaShield((s) => s.selectedVesselId);
  const vessels = useSeaShield((s) => s.vessels);
  const incidents = useSeaShield((s) => s.incidents);
  const cyber = useSeaShield((s) => s.cyber);
  const s = useMemo(() => securityService.fleetSummary(scope), [scope, vessels, incidents, cyber]);
  const activeIncidents = incidents.filter((i) => i.status !== "closed").slice(0, 6);
  const t = now();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Security Operations Dashboard"
        subtitle={scope === "all" ? "Fleet-wide monitoring" : vessels.find((v) => v.id === scope)?.name}
        actions={<SimBanner />}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto p-2 xl:grid-cols-[1fr_25rem]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
            <Metric
              label="Fleet security"
              value={<span className={stateColor[s.fleetState]}>{s.fleetState.toUpperCase()}</span>}
              sub={`avg score ${s.avgScore}`}
            >
              <ScoreBar score={s.avgScore} />
            </Metric>
            <Metric label="Vessels monitored" value={s.vessels} sub="edge nodes linked" />
            <Metric
              label="Cameras online"
              value={`${s.camerasOnline}/${s.camerasTotal}`}
              tone={s.camerasOnline === s.camerasTotal ? "secure" : "caution"}
              sub="simulated feeds"
            />
            <Metric
              label="Active incidents"
              value={s.activeIncidents}
              tone={s.activeIncidents ? "warning" : "secure"}
              sub={`${s.criticalIncidents} critical`}
            />
            <Metric
              label="Cyber alerts"
              value={s.cyberAlerts}
              tone={s.cyberAlerts ? "warning" : "secure"}
              sub={`${s.cyberTotal} findings total`}
            />
            <Metric
              label="Sensors online"
              value={`${s.sensorsOnline}/${s.sensorsTotal}`}
              tone={s.sensorAlarms ? "critical" : "secure"}
              sub={`${s.sensorAlarms} in alarm`}
            />
            <Metric
              label="Unauthorized access"
              value={s.unauthorizedAccess}
              tone={s.unauthorizedAccess ? "caution" : "secure"}
              sub="denied / suspicious"
            />
          </div>

          <div className="grid min-h-0 gap-2 lg:grid-cols-2">
            <Panel title="Fleet security posture" meta={`${vessels.length} vessels`} scroll>
              <ul>
                {vessels.map((v) => (
                  <li key={v.id} className="border-b border-border/60 last:border-0">
                    <Link
                      to="/vessels/$vesselId"
                      params={{ vesselId: v.id }}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-accent/40"
                    >
                      <StatusDot state={v.securityState} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{v.name}</span>
                        <span className="label-mono text-[10px]">{v.imo}</span>
                      </span>
                      <span className="w-28">
                        <ScoreBar score={v.securityScore} />
                      </span>
                      <span className={cn("tabular w-8 text-right text-xs", stateColor[v.securityState])}>
                        {v.securityScore}
                      </span>
                      <span className="tabular w-14 text-right text-[10px] text-muted-foreground">
                        {elapsed(v.lastComms, t)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel
              title="Active incidents"
              meta={`${activeIncidents.length} open`}
              actions={
                <Link to="/incidents" className="label-mono border border-border px-2 py-1 hover:bg-accent">
                  Open queue
                </Link>
              }
              scroll
            >
              {activeIncidents.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                  <ShieldCheck className="size-6 text-secure" />
                  <p className="text-xs text-muted-foreground">No active incidents in scope.</p>
                </div>
              ) : (
                <ul>
                  {activeIncidents.map((i) => (
                    <li key={i.id} className="border-b border-border/60 px-3 py-2 last:border-0">
                      <div className="flex items-center gap-2">
                        <SeverityTag severity={i.severity} />
                        <span className="tabular text-[10px] text-muted-foreground">{i.ref}</span>
                        <span className="label-mono ml-auto">{i.status}</span>
                      </div>
                      <div className={cn("mt-1 text-xs font-medium", severityText[i.severity])}>
                        {i.title}
                      </div>
                      <div className="label-mono mt-0.5 normal-case">
                        {vessels.find((v) => v.id === i.vesselId)?.name} · {i.system} · {i.assignee}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel
            title="Recent security events"
            meta={<span className="flex items-center gap-1"><AlertTriangle className="size-3" /> live stream</span>}
            className="min-h-72"
            scroll
          >
            <EventStream limit={40} />
          </Panel>
        </div>

        <SimulationConsole className="min-h-[36rem] xl:min-h-0" />
      </div>
    </div>
  );
}
