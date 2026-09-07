import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import { elapsed, onlineText, severityText, stateColor, utcTime } from "@/lib/seashield/format";
import {
  Metric,
  PageHeader,
  Panel,
  ScoreBar,
  SeverityTag,
  SimBanner,
  StatusDot,
} from "@/components/seashield/primitives";
import { CameraTile } from "@/components/seashield/CameraTile";
import { now } from "@/lib/seashield/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/vessels/$vesselId")({
  head: () => ({
    meta: [
      { title: "Vessel Security Detail — SeaShield" },
      {
        name: "description",
        content:
          "Vessel-level SeaShield view: physical security, CCTV, access control, sensors, cybersecurity, network and GPS/AIS status with a simulated security score.",
      },
      { property: "og:title", content: "Vessel Security Detail — SeaShield" },
      {
        property: "og:description",
        content: "Full simulated system breakdown for a single monitored cargo vessel.",
      },
    ],
  }),
  component: VesselDetail,
});

function VesselDetail() {
  const { vesselId } = Route.useParams();
  const vessel = useSeaShield((s) => s.vessels.find((v) => v.id === vesselId));
  const cameras = useSeaShield((s) => s.cameras.filter((c) => c.vesselId === vesselId));
  const sensors = useSeaShield((s) => s.sensors.filter((c) => c.vesselId === vesselId));
  const access = useSeaShield((s) => s.access.filter((a) => a.vesselId === vesselId).slice(0, 8));
  const cyber = useSeaShield((s) => s.cyber.filter((c) => c.vesselId === vesselId).slice(0, 8));
  const incidents = useSeaShield((s) => s.incidents.filter((i) => i.vesselId === vesselId));
  const events = useSeaShield((s) => s.events.filter((e) => e.vesselId === vesselId).slice(0, 20));

  if (!vessel) throw notFound();
  const t = now();
  const camsOnline = cameras.filter((c) => c.state === "online").length;
  const sensorsOnline = sensors.filter((s) => s.state === "online").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={vessel.name}
        subtitle={`${vessel.imo} · ${vessel.type} · ${vessel.flag} · ${vessel.route}`}
        actions={
          <div className="flex items-center gap-2">
            <SimBanner />
            <Link to="/vessels" className="label-mono flex items-center gap-1 border border-border px-2 py-1 hover:bg-accent">
              <ArrowLeft className="size-3" /> Vessels
            </Link>
          </div>
        }
      />
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <Metric
            label="Security score"
            value={vessel.securityScore}
            tone={vessel.securityState === "secure" ? "secure" : vessel.securityState === "critical" ? "critical" : "caution"}
            sub={vessel.securityState.toUpperCase()}
          >
            <ScoreBar score={vessel.securityScore} />
          </Metric>
          <SystemMetric label="Physical security" state={vessel.physical} />
          <Metric label="CCTV" value={`${camsOnline}/${cameras.length}`} tone={camsOnline === cameras.length ? "secure" : "caution"} sub="feeds online" />
          <SystemMetric label="Access control" online={vessel.accessControl} />
          <Metric label="Sensors" value={`${sensorsOnline}/${sensors.length}`} tone={sensorsOnline === sensors.length ? "secure" : "caution"} sub="reporting" />
          <SystemMetric label="Cybersecurity" state={vessel.cyber} />
          <SystemMetric label="Network" online={vessel.network} />
          <SystemMetric label="GPS / AIS" online={vessel.gpsAis} sub={vessel.position} />
        </div>

        <Panel title="CCTV — simulated feeds" meta={`${cameras.length} cameras`}>
          <div className="grid grid-cols-2 gap-2 p-2 md:grid-cols-4 2xl:grid-cols-8">
            {cameras.map((c) => (
              <CameraTile key={c.id} camera={c} vesselName={c.zone} />
            ))}
          </div>
        </Panel>

        <div className="grid gap-2 xl:grid-cols-3">
          <Panel title="Sensors" meta={`${sensors.length} points`} className="max-h-80" scroll>
            <table className="w-full text-xs">
              <tbody>
                {sensors.map((s) => (
                  <tr key={s.id} className={cn("border-b border-border/50", s.alarm && "bg-critical/10")}>
                    <td className="px-3 py-1.5">
                      <StatusDot state={s.state} pulse={s.alarm} />
                    </td>
                    <td className="label-mono px-2 py-1.5">{s.kind}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{s.location}</td>
                    <td className={cn("tabular px-3 py-1.5 text-right", s.alarm ? "text-critical" : "")}>
                      {s.reading}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Access control log" meta="latest events" className="max-h-80" scroll>
            <table className="w-full text-xs">
              <tbody>
                {access.map((a) => (
                  <tr key={a.id} className="border-b border-border/50">
                    <td className="tabular px-3 py-1.5 text-muted-foreground">{utcTime(a.ts)}</td>
                    <td className="px-2 py-1.5">{a.area}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{a.person}</td>
                    <td
                      className={cn(
                        "label-mono px-3 py-1.5 text-right",
                        a.result === "authorized"
                          ? "text-secure"
                          : a.result === "denied"
                            ? "text-warning"
                            : "text-critical",
                      )}
                    >
                      {a.result}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Cybersecurity findings" meta="simulated" className="max-h-80" scroll>
            <table className="w-full text-xs">
              <tbody>
                {cyber.map((c) => (
                  <tr key={c.id} className="border-b border-border/50">
                    <td className="px-3 py-1.5">
                      <SeverityTag severity={c.severity} />
                    </td>
                    <td className="px-2 py-1.5">{c.summary}</td>
                    <td className="tabular px-3 py-1.5 text-right text-muted-foreground">{c.host}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        <div className="grid gap-2 xl:grid-cols-2">
          <Panel title="Incidents" meta={`${incidents.length} total`} className="max-h-72" scroll>
            <ul>
              {incidents.length === 0 ? (
                <li className="p-3 text-xs text-muted-foreground">No incidents recorded for this vessel.</li>
              ) : (
                incidents.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
                    <SeverityTag severity={i.severity} />
                    <span className="tabular text-[10px] text-muted-foreground">{i.ref}</span>
                    <span className={cn("min-w-0 flex-1 truncate text-xs", severityText[i.severity])}>{i.title}</span>
                    <span className="label-mono">{i.status}</span>
                  </li>
                ))
              )}
            </ul>
          </Panel>

          <Panel title="Vessel event log" meta={`comms ${elapsed(vessel.lastComms, t)} ago`} className="max-h-72" scroll>
            <ul>
              {events.map((e) => (
                <li key={e.id} className="flex items-start gap-2 border-b border-border/50 px-3 py-1.5 text-xs">
                  <span className="tabular text-muted-foreground">{utcTime(e.ts)}</span>
                  <SeverityTag severity={e.severity} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{e.title}</span>{" "}
                    <span className="text-muted-foreground">{e.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function SystemMetric({
  label,
  state,
  online,
  sub,
}: {
  label: string;
  state?: "secure" | "elevated" | "warning" | "critical";
  online?: "online" | "degraded" | "offline";
  sub?: string;
}) {
  const text = state ? state.toUpperCase() : online!.toUpperCase();
  const cls = state ? stateColor[state] : onlineText[online!];
  return (
    <div className="flex min-w-0 flex-col justify-between gap-2 border border-border bg-panel px-3 py-2.5">
      <div className="label-mono truncate">{label}</div>
      <div className={cn("tabular flex items-center gap-2 text-lg leading-none font-semibold", cls)}>
        <StatusDot state={(state ?? online)!} />
        {text}
      </div>
      <div className="label-mono truncate normal-case">{sub ?? "simulated telemetry"}</div>
    </div>
  );
}
