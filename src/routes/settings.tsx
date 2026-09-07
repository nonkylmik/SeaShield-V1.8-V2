import { createFileRoute } from "@tanstack/react-router";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import { simulationService } from "@/lib/seashield/services";
import { PageHeader, Panel, SimBanner, StatusDot } from "@/components/seashield/primitives";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — SeaShield Console" },
      {
        name: "description",
        content:
          "SeaShield workstation settings: operator profile, edge and backend connection targets, simulation mode and data source configuration for Prototype V1.",
      },
      { property: "og:title", content: "Settings — SeaShield Console" },
      {
        property: "og:description",
        content: "Operator profile, connection targets and simulation configuration.",
      },
    ],
  }),
  component: SettingsView,
});

function SettingsView() {
  const operator = useSeaShield((s) => s.operator);
  const connection = useSeaShield((s) => s.connection);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Settings"
        subtitle="Workstation and data source configuration"
        actions={<SimBanner />}
      />
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="grid gap-2 xl:grid-cols-2">
          <Panel title="Operator">
            <dl className="divide-y divide-border text-xs">
              {[
                ["Name", operator.name],
                ["Role", operator.role],
                ["Shift", operator.shift],
                ["Workstation", "OPS-01 (desktop)"],
                ["Session mode", "Local prototype session"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between px-3 py-2">
                  <dt className="label-mono">{k}</dt>
                  <dd className="tabular">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Connections">
            <dl className="divide-y divide-border text-xs">
              <div className="flex items-center justify-between px-3 py-2">
                <dt className="label-mono">Vessel edge server</dt>
                <dd className="flex items-center gap-2">
                  <StatusDot state={connection.edge} />
                  <span className="tabular">simulated · edge-agent</span>
                </dd>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <dt className="label-mono">Central backend</dt>
                <dd className="flex items-center gap-2">
                  <StatusDot state={connection.backend} pulse={false} />
                  <span className="tabular">mock service layer</span>
                </dd>
              </div>
              <div className="flex justify-between px-3 py-2">
                <dt className="label-mono">Planned backend</dt>
                <dd className="tabular">Python / FastAPI → PostgreSQL</dd>
              </div>
              <div className="flex justify-between px-3 py-2">
                <dt className="label-mono">Data mode</dt>
                <dd className="tabular text-signal">{connection.mode}</dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Simulation">
            <div className="space-y-3 p-3 text-xs">
              <p className="text-muted-foreground">
                All vessels, cameras, sensors, network findings and security events in this build are
                simulated. Nothing connects to real vessels, cameras, networks or security
                infrastructure, and event correlation is rule-based — not AI and not real threat
                detection.
              </p>
              <button
                onClick={() => simulationService.reset()}
                className="label-mono border border-border px-2 py-1 hover:bg-accent"
              >
                Reset simulated state
              </button>
            </div>
          </Panel>

          <Panel title="Keyboard shortcuts">
            <dl className="divide-y divide-border text-xs">
              {[
                ["F1 – F10", "Jump to console views in sidebar order"],
                ["Ctrl / ⌘ + K", "Focus global search"],
                ["Esc", "Clear search input"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between px-3 py-2">
                  <dt className="tabular">{k}</dt>
                  <dd className="text-muted-foreground">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Desktop packaging" className="xl:col-span-2">
            <div className="space-y-2 p-3 text-xs text-muted-foreground">
              <p>
                The interface is built as a full-screen, single-window operations console with no
                marketing surfaces, so it can be wrapped as a native desktop application (Electron or
                Tauri) for Windows and Linux workstations without UI changes.
              </p>
              <p>
                UI components read data only through the service layer (vesselService, cameraService,
                sensorService, eventService, incidentService, securityService), so switching from
                simulated data to the FastAPI backend does not require rewriting the interface.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
