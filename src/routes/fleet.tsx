import { createFileRoute, Link } from "@tanstack/react-router";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import { elapsed, onlineText, stateColor } from "@/lib/seashield/format";
import { PageHeader, Panel, ScoreBar, SimBanner, StatusDot } from "@/components/seashield/primitives";
import { now } from "@/lib/seashield/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/fleet")({
  head: () => ({
    meta: [
      { title: "Fleet Monitoring — SeaShield" },
      {
        name: "description",
        content:
          "Fleet monitoring grid for SeaShield: security status, camera and cyber posture, active incidents and last communication per cargo vessel (simulated).",
      },
      { property: "og:title", content: "Fleet Monitoring — SeaShield" },
      {
        property: "og:description",
        content: "Per-vessel security, CCTV and cyber posture across the monitored cargo fleet.",
      },
    ],
  }),
  component: FleetView,
});

function FleetView() {
  const vessels = useSeaShield((s) => s.vessels);
  const cameras = useSeaShield((s) => s.cameras);
  const incidents = useSeaShield((s) => s.incidents);
  const t = now();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Fleet Monitoring"
        subtitle={`${vessels.length} commercial cargo vessels under simulated monitoring`}
        actions={<SimBanner />}
      />
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <Panel title="Fleet register" meta="all values simulated" scroll>
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-panel-header">
              <tr className="border-b border-border">
                {[
                  "Vessel",
                  "IMO",
                  "Type / flag",
                  "Security",
                  "Score",
                  "Cameras",
                  "Cyber",
                  "Incidents",
                  "Last comms",
                  "Position",
                ].map((h) => (
                  <th key={h} className="label-mono px-3 py-2 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vessels.map((v) => {
                const cams = cameras.filter((c) => c.vesselId === v.id);
                const online = cams.filter((c) => c.state === "online").length;
                const open = incidents.filter((i) => i.vesselId === v.id && i.status !== "closed");
                return (
                  <tr key={v.id} className="border-b border-border/50 hover:bg-accent/40">
                    <td className="px-3 py-2 font-medium">
                      <Link
                        to="/vessels/$vesselId"
                        params={{ vesselId: v.id }}
                        className="hover:text-signal"
                      >
                        {v.name}
                      </Link>
                    </td>
                    <td className="tabular px-3 py-2 text-muted-foreground">{v.imo}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {v.type} · {v.flag}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <StatusDot state={v.securityState} />
                        <span className={cn("label-mono", stateColor[v.securityState])}>
                          {v.securityState}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-20">
                          <ScoreBar score={v.securityScore} />
                        </span>
                        <span className="tabular">{v.securityScore}</span>
                      </div>
                    </td>
                    <td className={cn("tabular px-3 py-2", online === cams.length ? "text-secure" : "text-caution")}>
                      {online}/{cams.length}
                    </td>
                    <td className={cn("label-mono px-3 py-2", stateColor[v.cyber])}>{v.cyber}</td>
                    <td className={cn("tabular px-3 py-2", open.length ? "text-warning" : "text-muted-foreground")}>
                      {open.length}
                    </td>
                    <td className={cn("tabular px-3 py-2", onlineText[v.network])}>
                      {elapsed(v.lastComms, t)} ago
                    </td>
                    <td className="tabular px-3 py-2 text-muted-foreground">{v.position}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
