import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { incidentService } from "@/lib/seashield/services";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import { severityText, utcStamp, utcTime } from "@/lib/seashield/format";
import { PageHeader, Panel, SeverityTag, SimBanner } from "@/components/seashield/primitives";
import type { Incident, IncidentStatus, Severity } from "@/lib/seashield/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/incidents")({
  head: () => ({
    meta: [
      { title: "Incident Management — SeaShield" },
      {
        name: "description",
        content:
          "SeaShield incident queue: create incidents, set severity and status, review timelines, related events, affected systems and investigation notes (simulated).",
      },
      { property: "og:title", content: "Incident Management — SeaShield" },
      {
        property: "og:description",
        content: "Investigate correlated maritime security incidents with timeline and operator notes.",
      },
    ],
  }),
  component: IncidentsView,
});

const STATUSES: IncidentStatus[] = ["open", "investigating", "contained", "closed"];
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const ASSIGNEES = ["R. Vance", "K. Halvorsen", "M. Okonjo", "D. Reyes", "S. Lindqvist"];

function IncidentsView() {
  const scope = useSeaShield((s) => s.selectedVesselId);
  const incidents = useSeaShield((s) => s.incidents);
  const vessels = useSeaShield((s) => s.vessels);
  const events = useSeaShield((s) => s.events);
  const operator = useSeaShield((s) => s.operator);

  const rows = useMemo(() => incidentService.list(scope), [scope, incidents]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState("");

  const selected: Incident | undefined = rows.find((i) => i.id === selectedId) ?? rows[0];
  const name = (id: string) => vessels.find((v) => v.id === id)?.name ?? id;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Incident Management"
        subtitle="Correlated and manually raised incidents (rule-based correlation, simulated data)"
        actions={
          <div className="flex items-center gap-2">
            <SimBanner />
            <button
              onClick={() => setCreating((c) => !c)}
              className="label-mono flex items-center gap-1 border border-signal/50 bg-signal/10 px-2 py-1 text-signal hover:bg-signal/20"
            >
              <Plus className="size-3" /> New incident
            </button>
          </div>
        }
      />

      {creating ? <CreateForm onDone={() => setCreating(false)} /> : null}

      <div className="grid min-h-0 flex-1 gap-2 overflow-hidden p-2 xl:grid-cols-[1fr_28rem]">
        <Panel title="Incident queue" meta={`${rows.length} incidents`} scroll>
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-panel-header">
              <tr className="border-b border-border">
                {["Ref", "Sev", "Title", "Vessel", "System", "Status", "Assignee", "Opened"].map((h) => (
                  <th key={h} className="label-mono px-3 py-1.5 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr
                  key={i.id}
                  onClick={() => setSelectedId(i.id)}
                  className={cn(
                    "cursor-pointer border-b border-border/50 hover:bg-accent/40",
                    selected?.id === i.id && "bg-accent/60",
                  )}
                >
                  <td className="tabular px-3 py-1.5">{i.ref}</td>
                  <td className="px-3 py-1.5">
                    <SeverityTag severity={i.severity} />
                  </td>
                  <td className={cn("px-3 py-1.5 font-medium", severityText[i.severity])}>{i.title}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{name(i.vesselId)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{i.system}</td>
                  <td className="label-mono px-3 py-1.5">{i.status}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{i.assignee}</td>
                  <td className="tabular px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                    {utcStamp(i.openedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {selected ? (
          <Panel title={`${selected.ref} · investigation`} meta={selected.system} scroll>
            <div className="space-y-3 p-3">
              <div>
                <div className={cn("text-sm font-semibold", severityText[selected.severity])}>
                  {selected.title}
                </div>
                <div className="label-mono mt-1 normal-case">
                  {name(selected.vesselId)} · opened {utcStamp(selected.openedAt)} · updated{" "}
                  {utcTime(selected.updatedAt)}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Field label="Severity">
                  <select
                    value={selected.severity}
                    onChange={(e) => incidentService.update(selected.id, { severity: e.target.value as Severity })}
                    className="h-7 w-full rounded-sm border border-input bg-background px-1 font-mono text-xs"
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select
                    value={selected.status}
                    onChange={(e) => incidentService.setStatus(selected.id, e.target.value as IncidentStatus)}
                    className="h-7 w-full rounded-sm border border-input bg-background px-1 font-mono text-xs"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Assignee">
                  <select
                    value={selected.assignee}
                    onChange={(e) => incidentService.update(selected.id, { assignee: e.target.value })}
                    className="h-7 w-full rounded-sm border border-input bg-background px-1 font-mono text-xs"
                  >
                    {ASSIGNEES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Section title="Timeline">
                <ol className="space-y-1.5 border-l border-border pl-3">
                  {selected.timeline.map((t) => (
                    <li key={t.id} className="text-xs">
                      <span className="tabular mr-2 text-muted-foreground">{utcTime(t.ts)}</span>
                      {t.text}
                    </li>
                  ))}
                </ol>
              </Section>

              <Section title="Related events">
                {selected.eventIds.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No correlated events linked.</p>
                ) : (
                  <ul className="space-y-1">
                    {selected.eventIds.map((id) => {
                      const e = events.find((ev) => ev.id === id);
                      if (!e) return null;
                      return (
                        <li key={id} className="flex items-start gap-2 text-xs">
                          <span className="tabular text-muted-foreground">{utcTime(e.ts)}</span>
                          <SeverityTag severity={e.severity} />
                          <span className="min-w-0 flex-1">{e.title}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>

              <Section title="Investigation notes">
                <ul className="space-y-2">
                  {selected.notes.map((n) => (
                    <li key={n.id} className="border border-border bg-secondary/30 px-2 py-1.5 text-xs">
                      <div className="label-mono normal-case">
                        {n.author} · {utcStamp(n.ts)}
                      </div>
                      <p className="mt-1">{n.body}</p>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add investigation note…"
                    className="h-8 flex-1 rounded-sm border border-input bg-background px-2 text-xs outline-none focus:border-ring"
                  />
                  <button
                    onClick={() => {
                      if (!note.trim()) return;
                      incidentService.addNote(selected.id, note.trim(), operator.name);
                      setNote("");
                    }}
                    className="label-mono border border-border px-2 py-1 hover:bg-accent"
                  >
                    Add
                  </button>
                </div>
              </Section>
            </div>
          </Panel>
        ) : (
          <Panel title="Investigation">
            <p className="p-3 text-xs text-muted-foreground">No incident selected.</p>
          </Panel>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label-mono">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-2">
      <div className="label-mono mb-1.5">{title}</div>
      {children}
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const vessels = useSeaShield((s) => s.vessels);
  const operator = useSeaShield((s) => s.operator);
  const [title, setTitle] = useState("");
  const [vesselId, setVesselId] = useState(vessels[0]!.id);
  const [system, setSystem] = useState("CCTV");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [assignee, setAssignee] = useState(operator.name);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        incidentService.create({ title: title.trim(), vesselId, system, severity, assignee });
        onDone();
      }}
      className="grid shrink-0 grid-cols-1 items-end gap-2 border-b border-border bg-panel px-3 py-2 md:grid-cols-6"
    >
      <label className="md:col-span-2">
        <span className="label-mono">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Short incident description"
          className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs outline-none focus:border-ring"
        />
      </label>
      <label>
        <span className="label-mono">Vessel</span>
        <select
          value={vesselId}
          onChange={(e) => setVesselId(e.target.value)}
          className="h-8 w-full rounded-sm border border-input bg-background px-1 font-mono text-xs"
        >
          {vessels.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="label-mono">System</span>
        <select
          value={system}
          onChange={(e) => setSystem(e.target.value)}
          className="h-8 w-full rounded-sm border border-input bg-background px-1 font-mono text-xs"
        >
          {["CCTV", "Access Control", "Sensors / Safety", "OT / IT Network", "GPS / AIS", "Vessel Systems"].map(
            (s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ),
          )}
        </select>
      </label>
      <label>
        <span className="label-mono">Severity</span>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity)}
          className="h-8 w-full rounded-sm border border-input bg-background px-1 font-mono text-xs"
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <label className="flex-1">
          <span className="label-mono">Assignee</span>
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="h-8 w-full rounded-sm border border-input bg-background px-1 font-mono text-xs"
          >
            {ASSIGNEES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="label-mono mt-auto h-8 border border-signal/50 bg-signal/10 px-3 text-signal hover:bg-signal/20"
        >
          Create
        </button>
      </div>
    </form>
  );
}
