import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { securityService } from "@/lib/seashield/services";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import { utcTime } from "@/lib/seashield/format";
import { Metric, PageHeader, Panel, SeverityTag, SimBanner } from "@/components/seashield/primitives";
import { EventStream } from "@/components/seashield/EventStream";
import type { CyberFinding } from "@/lib/seashield/types";

export const Route = createFileRoute("/cybersecurity")({
  head: () => ({
    meta: [
      { title: "Cybersecurity Monitoring — SeaShield" },
      {
        name: "description",
        content:
          "Simulated vessel network monitoring in SeaShield: unknown devices, failed authentication, suspicious traffic, firewall blocks and network anomalies.",
      },
      { property: "og:title", content: "Cybersecurity Monitoring — SeaShield" },
      {
        property: "og:description",
        content: "Rule-based, fully simulated cyber event monitoring for vessel IT and OT networks.",
      },
    ],
  }),
  component: CyberView,
});

const KIND_LABEL: Record<CyberFinding["kind"], string> = {
  "unknown-device": "Unknown devices",
  "failed-auth": "Failed authentication",
  "suspicious-traffic": "Suspicious traffic",
  "firewall-block": "Firewall blocks",
  anomaly: "Network anomalies",
};

function CyberView() {
  const scope = useSeaShield((s) => s.selectedVesselId);
  const cyber = useSeaShield((s) => s.cyber);
  const vessels = useSeaShield((s) => s.vessels);
  const rows = useMemo(() => securityService.cyberFindings(scope), [scope, cyber]);
  const name = (id: string) => vessels.find((v) => v.id === id)?.name ?? id;

  const counts = (Object.keys(KIND_LABEL) as CyberFinding["kind"][]).map((k) => ({
    kind: k,
    label: KIND_LABEL[k],
    n: rows.filter((r) => r.kind === k).length,
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Cybersecurity Monitoring"
        subtitle="Simulated network and authentication telemetry — no real network is inspected"
        actions={<SimBanner text="Simulated · not real threat detection" />}
      />
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {counts.map((c) => (
            <Metric
              key={c.kind}
              label={c.label}
              value={c.n}
              tone={
                c.kind === "suspicious-traffic" || c.kind === "failed-auth"
                  ? c.n
                    ? "warning"
                    : "secure"
                  : "default"
              }
              sub="in current scope"
            />
          ))}
        </div>

        <Panel title="Cyber findings" meta={`${rows.length} records`} className="max-h-[26rem]" scroll>
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-panel-header">
              <tr className="border-b border-border">
                {["Time", "Sev", "Type", "Vessel", "Summary", "Host", "Count"].map((h) => (
                  <th key={h} className="label-mono px-3 py-1.5 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-accent/40">
                  <td className="tabular px-3 py-1.5 text-muted-foreground">{utcTime(r.ts)}</td>
                  <td className="px-3 py-1.5">
                    <SeverityTag severity={r.severity} />
                  </td>
                  <td className="label-mono px-3 py-1.5">{r.kind}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{name(r.vesselId)}</td>
                  <td className="px-3 py-1.5">{r.summary}</td>
                  <td className="tabular px-3 py-1.5 text-muted-foreground">{r.host}</td>
                  <td className="tabular px-3 py-1.5">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Correlated cyber event stream" meta="rule-based, not AI" className="min-h-72" scroll>
          <EventStream limit={40} />
        </Panel>
      </div>
    </div>
  );
}
