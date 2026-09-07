import { createFileRoute, Link } from "@tanstack/react-router";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import { elapsed, onlineText, stateColor } from "@/lib/seashield/format";
import { PageHeader, Panel, ScoreBar, SimBanner, StatusDot } from "@/components/seashield/primitives";
import { now } from "@/lib/seashield/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/vessels/")({
  head: () => ({
    meta: [
      { title: "Vessels — SeaShield Security Console" },
      {
        name: "description",
        content:
          "Select a vessel to inspect its physical security, CCTV, access control, sensors, cyber and navigation posture in SeaShield (simulated prototype).",
      },
      { property: "og:title", content: "Vessels — SeaShield Security Console" },
      {
        property: "og:description",
        content: "Per-vessel security breakdown across physical, cyber and navigation systems.",
      },
    ],
  }),
  component: VesselsIndex,
});

function VesselsIndex() {
  const vessels = useSeaShield((s) => s.vessels);
  const t = now();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Vessel Security" subtitle="Select a vessel for full system breakdown" actions={<SimBanner />} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto p-2 md:grid-cols-2 xl:grid-cols-4">
        {vessels.map((v) => (
          <Link key={v.id} to="/vessels/$vesselId" params={{ vesselId: v.id }} className="block">
            <Panel className="h-full transition-colors hover:border-signal/50">
              <div className="flex h-full flex-col gap-3 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{v.name}</div>
                    <div className="label-mono">{v.imo}</div>
                  </div>
                  <StatusDot state={v.securityState} />
                </div>
                <div className="label-mono normal-case">{v.type} · {v.flag}</div>
                <div>
                  <div className="flex items-baseline justify-between">
                    <span className="label-mono">Security score</span>
                    <span className={cn("tabular text-lg font-semibold", stateColor[v.securityState])}>
                      {v.securityScore}
                    </span>
                  </div>
                  <ScoreBar score={v.securityScore} />
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  {[
                    ["Network", v.network],
                    ["GPS / AIS", v.gpsAis],
                    ["Access ctrl", v.accessControl],
                  ].map(([k, val]) => (
                    <div key={k as string} className="flex justify-between gap-2">
                      <dt className="label-mono">{k}</dt>
                      <dd className={cn("tabular", onlineText[val as "online"])}>
                        {(val as string).toUpperCase()}
                      </dd>
                    </div>
                  ))}
                  <div className="flex justify-between gap-2">
                    <dt className="label-mono">Comms</dt>
                    <dd className="tabular text-muted-foreground">{elapsed(v.lastComms, t)}</dd>
                  </div>
                </dl>
                <div className="mt-auto label-mono normal-case">{v.route}</div>
              </div>
            </Panel>
          </Link>
        ))}
      </div>
    </div>
  );
}
