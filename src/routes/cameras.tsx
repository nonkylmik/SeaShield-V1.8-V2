import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import { CAMERA_ZONES } from "@/lib/seashield/data";
import { Metric, PageHeader, Panel, SimBanner } from "@/components/seashield/primitives";
import { CameraTile } from "@/components/seashield/CameraTile";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cameras")({
  head: () => ({
    meta: [
      { title: "CCTV Wall — SeaShield" },
      {
        name: "description",
        content:
          "SeaShield CCTV monitoring wall with simulated placeholder feeds for bridge, deck, cargo, engine room, port, starboard, stern and entrance cameras.",
      },
      { property: "og:title", content: "CCTV Wall — SeaShield" },
      {
        property: "og:description",
        content: "Multi-panel simulated camera wall with per-zone status and uptime.",
      },
    ],
  }),
  component: CamerasView,
});

function CamerasView() {
  const scope = useSeaShield((s) => s.selectedVesselId);
  const cameras = useSeaShield((s) => s.cameras);
  const vessels = useSeaShield((s) => s.vessels);
  const [zone, setZone] = useState<string>("all");
  const [layout, setLayout] = useState<2 | 4 | 6>(4);

  const rows = useMemo(
    () =>
      cameras
        .filter((c) => (scope === "all" ? true : c.vesselId === scope))
        .filter((c) => (zone === "all" ? true : c.zone === zone)),
    [cameras, scope, zone],
  );
  const online = rows.filter((c) => c.state === "online").length;
  const name = (id: string) => vessels.find((v) => v.id === id)?.name ?? id;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="CCTV Monitoring Wall"
        subtitle="All feeds are simulated placeholders — no live video is streamed in Prototype V1"
        actions={<SimBanner text="Simulated feeds only" />}
      />
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="label-mono">Zone</span>
        <select
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          className="h-7 rounded-sm border border-input bg-background px-2 font-mono text-xs outline-none focus:border-ring"
        >
          <option value="all">All zones</option>
          {CAMERA_ZONES.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        <span className="label-mono ml-4">Grid</span>
        {[2, 4, 6].map((n) => (
          <button
            key={n}
            onClick={() => setLayout(n as 2 | 4 | 6)}
            className={cn(
              "label-mono border px-2 py-1",
              layout === n ? "border-signal text-signal" : "border-border hover:bg-accent",
            )}
          >
            {n}×
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <Metric label="Feeds in view" value={rows.length} />
          <Metric label="Online" value={`${online}/${rows.length}`} tone={online === rows.length ? "secure" : "caution"} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <Panel>
          <div
            className={cn(
              "grid gap-2 p-2",
              layout === 2 && "grid-cols-1 md:grid-cols-2",
              layout === 4 && "grid-cols-2 md:grid-cols-4",
              layout === 6 && "grid-cols-3 md:grid-cols-6",
            )}
          >
            {rows.map((c) => (
              <CameraTile key={c.id} camera={c} vesselName={`${name(c.vesselId)} · ${c.zone}`} />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
