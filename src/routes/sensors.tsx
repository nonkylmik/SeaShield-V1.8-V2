import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { sensorService } from "@/lib/seashield/services";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import { onlineText } from "@/lib/seashield/format";
import { Metric, PageHeader, Panel, SimBanner, StatusDot } from "@/components/seashield/primitives";
import { SENSOR_KINDS } from "@/lib/seashield/data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/sensors")({
  head: () => ({
    meta: [
      { title: "Sensor Monitoring — SeaShield" },
      {
        name: "description",
        content:
          "Simulated vessel sensor monitoring in SeaShield: fire, smoke, temperature, water, motion, door and bilge sensors with alarm and uptime status.",
      },
      { property: "og:title", content: "Sensor Monitoring — SeaShield" },
      {
        property: "og:description",
        content: "Fire, smoke, temperature, water, motion, door and bilge telemetry (simulated).",
      },
    ],
  }),
  component: SensorsView,
});

function SensorsView() {
  const scope = useSeaShield((s) => s.selectedVesselId);
  const sensors = useSeaShield((s) => s.sensors);
  const vessels = useSeaShield((s) => s.vessels);
  const [kind, setKind] = useState<string>("all");
  const rows = useMemo(
    () => sensorService.list(scope).filter((s) => (kind === "all" ? true : s.kind === kind)),
    [scope, sensors, kind],
  );
  const name = (id: string) => vessels.find((v) => v.id === id)?.name ?? id;
  const alarms = rows.filter((r) => r.alarm);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Sensor Monitoring"
        subtitle="Simulated sensor bus telemetry from vessel edge nodes"
        actions={<SimBanner />}
      />
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Metric label="Sensors in scope" value={rows.length} />
          <Metric
            label="Reporting"
            value={rows.filter((r) => r.state === "online").length}
            tone="secure"
            sub="online on sensor bus"
          />
          <Metric
            label="Offline"
            value={rows.filter((r) => r.state === "offline").length}
            tone={rows.some((r) => r.state === "offline") ? "warning" : "secure"}
          />
          <Metric label="Active alarms" value={alarms.length} tone={alarms.length ? "critical" : "secure"} />
        </div>

        <div className="flex items-center gap-2">
          <span className="label-mono">Type</span>
          <button
            onClick={() => setKind("all")}
            className={cn(
              "label-mono border px-2 py-1",
              kind === "all" ? "border-signal text-signal" : "border-border hover:bg-accent",
            )}
          >
            All
          </button>
          {SENSOR_KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cn(
                "label-mono border px-2 py-1",
                kind === k ? "border-signal text-signal" : "border-border hover:bg-accent",
              )}
            >
              {k}
            </button>
          ))}
        </div>

        <Panel title="Sensor register" meta={`${rows.length} points`} scroll>
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-panel-header">
              <tr className="border-b border-border">
                {["", "Type", "Location", "Vessel", "Reading", "State", "Uptime"].map((h) => (
                  <th key={h} className="label-mono px-3 py-1.5 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.id}
                  className={cn("border-b border-border/50 hover:bg-accent/40", s.alarm && "bg-critical/10")}
                >
                  <td className="px-3 py-1.5">
                    <StatusDot state={s.state} pulse={s.alarm} />
                  </td>
                  <td className="label-mono px-3 py-1.5">{s.kind}</td>
                  <td className="px-3 py-1.5">{s.location}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{name(s.vesselId)}</td>
                  <td className={cn("tabular px-3 py-1.5", s.alarm ? "font-semibold text-critical" : "")}>
                    {s.reading}
                  </td>
                  <td className={cn("tabular px-3 py-1.5", onlineText[s.state])}>{s.state.toUpperCase()}</td>
                  <td className="tabular px-3 py-1.5 text-muted-foreground">{s.uptime.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
