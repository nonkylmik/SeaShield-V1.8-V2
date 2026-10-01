import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardCheck, Plus, X } from "lucide-react";
import {
  cancelSafetyRound,
  completeSafetyRound,
  createSafetyRound,
  loadMoreSafetyRounds,
  listSafetyRoundTemplates,
  startSafetyRound,
  updateSafetyCheckpoint,
  updateSafetyFinding,
} from "@/lib/seashield/backend";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import type {
  SafetyCheckpointStatus,
  SafetyFinding,
  SafetyFindingStatus,
  SafetyRound,
  SafetyRoundTemplate,
  SafetySeverity,
  Vessel,
} from "@/lib/seashield/types";
import { Metric, PageHeader, Panel } from "@/components/seashield/primitives";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/safety-rounds")({
  head: () => ({ meta: [{ title: "Safety Rounds — SeaShield" }] }),
  component: SafetyRoundsPage,
});

const CHECKPOINT_STATUSES: SafetyCheckpointStatus[] = ["PASS", "WARNING", "FAIL", "NOT_APPLICABLE"];
const FINDING_STATUSES: SafetyFindingStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "DISMISSED"];
const SEVERITIES: SafetySeverity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

const statusStyle: Record<string, string> = {
  PLANNED: "text-muted-foreground border-border",
  IN_PROGRESS: "text-signal border-signal/40",
  OVERDUE: "text-critical border-critical/50",
  COMPLETED: "text-secure border-secure/40",
  CANCELLED: "text-muted-foreground border-border",
  PASS: "text-secure border-secure/40",
  WARNING: "text-warning border-warning/40",
  FAIL: "text-critical border-critical/50",
  NOT_APPLICABLE: "text-muted-foreground border-border",
  NOT_CHECKED: "text-muted-foreground border-border",
  OPEN: "text-critical border-critical/50",
  IN_PROGRESS_FINDING: "text-warning border-warning/40",
  RESOLVED: "text-secure border-secure/40",
  DISMISSED: "text-muted-foreground border-border",
  INFO: "text-muted-foreground border-border",
  LOW: "text-signal border-signal/40",
  MEDIUM: "text-warning border-warning/40",
  HIGH: "text-critical border-critical/50",
  CRITICAL: "text-critical border-critical/50",
};

function statusClass(status: string, finding = false) {
  const key = finding && status === "IN_PROGRESS" ? "IN_PROGRESS_FINDING" : status;
  return statusStyle[key] ?? statusStyle.NOT_CHECKED;
}

function SafetyRoundsPage() {
  const rounds = useSeaShield((state) => state.safetyRounds);
  const findings = useSeaShield((state) => state.safetyFindings);
  const vessels = useSeaShield((state) => state.vessels);
  const backendState = useSeaShield((state) => state.connection.backend);
  const operator = useSeaShield((state) => state.operator);
  const [templates, setTemplates] = useState<SafetyRoundTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [vesselFilter, setVesselFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [assignedFilter, setAssignedFilter] = useState("");
  const [startFilter, setStartFilter] = useState("");
  const [endFilter, setEndFilter] = useState("");
  const [hasMore, setHasMore] = useState(rounds.length >= 100);
  const [loadingMore, setLoadingMore] = useState(false);
  const historyInitialized = useRef(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listSafetyRoundTemplates()
      .then(setTemplates)
      .catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(() => {
    if (historyInitialized.current || backendState !== "online") return;
    historyInitialized.current = true;
    setHasMore(rounds.length >= 100);
  }, [backendState, rounds.length]);

  const selectedRound = rounds.find((round) => round.round_id === selectedId) ?? null;
  const scopedRounds = useMemo(
    () =>
      rounds.filter(
        (round) =>
          (vesselFilter === "all" || round.vessel_id === vesselFilter) &&
          (typeFilter === "all" || round.round_type === typeFilter) &&
          (statusFilter === "all" || round.status === statusFilter) &&
          (!assignedFilter ||
            round.assigned_to.toLowerCase().includes(assignedFilter.toLowerCase())) &&
          (!startFilter || (round.planned_start ?? "") >= startFilter) &&
          (!endFilter || (round.planned_start ?? "") <= `${endFilter}T23:59:59`),
      ),
    [rounds, vesselFilter, typeFilter, statusFilter, assignedFilter, startFilter, endFilter],
  );
  const now = Date.now();
  const openFindings = findings.filter(
    (finding) => !["RESOLVED", "DISMISSED"].includes(finding.status),
  );
  const activeCount = rounds.filter((round) => round.status === "IN_PROGRESS").length;
  const completedToday = rounds.filter(
    (round) =>
      round.completed_at &&
      new Date(round.completed_at).toDateString() === new Date().toDateString(),
  ).length;
  const overdueCount = rounds.filter(
    (round) =>
      round.status === "OVERDUE" ||
      (round.status === "PLANNED" && round.planned_start && Date.parse(round.planned_start) < now),
  ).length;
  const criticalCount = openFindings.filter((finding) => finding.severity === "CRITICAL").length;

  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The operation could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    setError("");
    try {
      const count = await loadMoreSafetyRounds(rounds.length, {
        vesselId: vesselFilter === "all" ? undefined : vesselFilter,
        roundType: typeFilter === "all" ? undefined : typeFilter,
        status: statusFilter === "all" ? undefined : statusFilter,
        assignedTo: assignedFilter || undefined,
        start: startFilter ? new Date(`${startFilter}T00:00:00`).toISOString() : undefined,
        end: endFilter ? new Date(`${endFilter}T23:59:59`).toISOString() : undefined,
      });
      setHasMore(count === 50);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load more rounds.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Safety Rounds"
        subtitle="Vessel inspections · checkpoint status · corrective actions"
        actions={
          <button
            onClick={() => setShowCreate((value) => !value)}
            className="inline-flex h-8 items-center gap-2 border border-signal/50 bg-signal/10 px-3 text-xs font-semibold text-signal hover:bg-signal/20"
          >
            <Plus className="size-4" /> New round
          </button>
        }
      />
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        {error ? (
          <div
            role="alert"
            className="border border-critical/50 bg-critical/10 px-3 py-2 text-xs text-critical"
          >
            {error}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Metric
            label="Active rounds"
            value={activeCount}
            tone={activeCount ? "signal" : "default"}
          />
          <Metric label="Completed today" value={completedToday} tone="secure" />
          <Metric
            label="Open findings"
            value={openFindings.length}
            tone={openFindings.length ? "warning" : "secure"}
          />
          <Metric
            label="Critical findings"
            value={criticalCount}
            tone={criticalCount ? "critical" : "secure"}
          />
          <Metric
            label="Overdue rounds"
            value={overdueCount}
            tone={overdueCount ? "critical" : "secure"}
          />
        </div>

        {showCreate ? (
          <CreateRoundForm
            vessels={vessels}
            templates={templates}
            operator={operator.name}
            busy={busy}
            onCancel={() => setShowCreate(false)}
            onCreate={(payload) =>
              void perform(async () => {
                const round = await createSafetyRound(payload);
                setSelectedId(round.round_id);
                setShowCreate(false);
              })
            }
          />
        ) : null}

        <div className="grid min-h-[32rem] gap-2 2xl:grid-cols-[minmax(32rem,1.2fr)_minmax(28rem,0.8fr)]">
          <Panel
            title="Round history"
            meta={`${scopedRounds.length} shown`}
            scroll
            bodyClassName="flex min-h-0 flex-col"
          >
            <div className="flex flex-wrap gap-2 border-b border-border p-2">
              <select
                aria-label="Filter by vessel"
                value={vesselFilter}
                onChange={(event) => setVesselFilter(event.target.value)}
                className="h-8 min-w-40 border border-input bg-background px-2 text-xs"
              >
                <option value="all">All vessels</option>
                {vessels.map((vessel) => (
                  <option key={vessel.id} value={vessel.id}>
                    {vessel.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by round type"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                className="h-8 min-w-44 border border-input bg-background px-2 text-xs"
              >
                <option value="all">All round types</option>
                {templates.map((template) => (
                  <option key={template.name} value={template.name}>
                    {template.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-8 min-w-36 border border-input bg-background px-2 text-xs"
              >
                <option value="all">All statuses</option>
                {["PLANNED", "IN_PROGRESS", "OVERDUE", "COMPLETED", "CANCELLED"].map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
              <input
                aria-label="Filter by assigned operator"
                placeholder="Assigned operator"
                value={assignedFilter}
                onChange={(event) => setAssignedFilter(event.target.value)}
                className="h-8 min-w-40 border border-input bg-background px-2 text-xs"
              />
              <label className="flex h-8 items-center gap-1 border border-input px-2">
                <span className="label-mono">From</span>
                <input
                  aria-label="Start date filter"
                  type="date"
                  value={startFilter}
                  onChange={(event) => setStartFilter(event.target.value)}
                  className="bg-background text-xs"
                />
              </label>
              <label className="flex h-8 items-center gap-1 border border-input px-2">
                <span className="label-mono">To</span>
                <input
                  aria-label="End date filter"
                  type="date"
                  value={endFilter}
                  onChange={(event) => setEndFilter(event.target.value)}
                  className="bg-background text-xs"
                />
              </label>
            </div>
            <div className="min-w-[48rem] flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-panel-header text-left">
                  <tr>
                    {[
                      "Round ID",
                      "Vessel",
                      "Round type",
                      "Assigned",
                      "Status",
                      "Progress",
                      "Findings",
                      "Planned",
                    ].map((label) => (
                      <th key={label} className="label-mono px-2 py-2 font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scopedRounds.map((round) => {
                    const done = round.checkpoints.filter(
                      (item) => item.status !== "NOT_CHECKED",
                    ).length;
                    const roundFindings = findings.filter(
                      (finding) => finding.round_id === round.round_id,
                    );
                    return (
                      <tr
                        key={round.round_id}
                        className={cn(
                          "cursor-pointer border-t border-border/60 hover:bg-accent/40",
                          selectedId === round.round_id && "bg-accent/30",
                        )}
                        onClick={() => setSelectedId(round.round_id)}
                      >
                        <td className="whitespace-nowrap px-2 py-2 font-mono text-signal">
                          {round.round_id}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          {vessels.find((vessel) => vessel.id === round.vessel_id)?.name ??
                            round.vessel_id}
                        </td>
                        <td className="max-w-44 truncate px-2 py-2">{round.round_type}</td>
                        <td className="whitespace-nowrap px-2 py-2">{round.assigned_to}</td>
                        <td className="px-2 py-2">
                          <StatusTag status={round.status} />
                        </td>
                        <td className="tabular whitespace-nowrap px-2 py-2">
                          {done}/{round.checkpoints.length}
                        </td>
                        <td className="tabular px-2 py-2">{roundFindings.length}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                          {formatDate(round.planned_start)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {scopedRounds.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No safety rounds match these filters.
                </div>
              ) : null}
              {hasMore ? (
                <div className="border-t border-border p-2 text-center">
                  <button
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                    className="h-8 border border-border px-3 text-xs hover:bg-accent disabled:opacity-40"
                  >
                    {loadingMore ? "Loading…" : "Load more history"}
                  </button>
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel
            title={selectedRound ? selectedRound.round_id : "Round workspace"}
            meta={selectedRound?.status ?? "select a round"}
            scroll
          >
            {selectedRound ? (
              <RoundDetail
                round={selectedRound}
                findings={findings.filter((finding) => finding.round_id === selectedRound.round_id)}
                vesselName={
                  vessels.find((vessel) => vessel.id === selectedRound.vessel_id)?.name ??
                  selectedRound.vessel_id
                }
                busy={busy}
                onRun={perform}
              />
            ) : (
              <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
                <ClipboardCheck className="size-7 text-signal" />
                <p className="text-sm">Select a round to view its checkpoints and findings.</p>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function CreateRoundForm({
  vessels,
  templates,
  operator,
  busy,
  onCancel,
  onCreate,
}: {
  vessels: Vessel[];
  templates: SafetyRoundTemplate[];
  operator: string;
  busy: boolean;
  onCancel: () => void;
  onCreate: (payload: {
    vessel_id: string;
    round_type: string;
    assigned_to: string;
    planned_start: string;
    notes: string;
    template_name: string;
  }) => void;
}) {
  const [vesselId, setVesselId] = useState(vessels[0]?.id ?? "");
  const [roundType, setRoundType] = useState(templates[0]?.name ?? "");
  const [assignedTo, setAssignedTo] = useState(operator);
  const [plannedStart, setPlannedStart] = useState(() => {
    const date = new Date();
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState("");
  const template = templates.find((item) => item.name === roundType);

  useEffect(() => {
    if (!roundType && templates[0]) setRoundType(templates[0].name);
  }, [roundType, templates]);

  return (
    <Panel
      title="Create safety round"
      meta="template checkpoints are copied at creation"
      actions={
        <button
          onClick={onCancel}
          title="Close"
          aria-label="Close create form"
          className="border border-border p-1 hover:bg-accent"
        >
          <X className="size-3.5" />
        </button>
      }
    >
      <form
        className="grid gap-3 p-3 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!vesselId || !roundType || !assignedTo.trim()) return;
          onCreate({
            vessel_id: vesselId,
            round_type: roundType,
            assigned_to: assignedTo.trim(),
            planned_start: new Date(plannedStart).toISOString(),
            notes,
            template_name: roundType,
          });
        }}
      >
        <label className="grid gap-1 text-xs">
          <span className="label-mono">Vessel</span>
          <select
            required
            value={vesselId}
            onChange={(event) => setVesselId(event.target.value)}
            className="h-9 border border-input bg-background px-2"
          >
            {vessels.map((vessel) => (
              <option key={vessel.id} value={vessel.id}>
                {vessel.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          <span className="label-mono">Round template</span>
          <select
            required
            value={roundType}
            onChange={(event) => setRoundType(event.target.value)}
            className="h-9 border border-input bg-background px-2"
          >
            {templates.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          <span className="label-mono">Assigned operator</span>
          <input
            required
            value={assignedTo}
            onChange={(event) => setAssignedTo(event.target.value)}
            className="h-9 border border-input bg-background px-2"
          />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="label-mono">Planned start</span>
          <input
            type="datetime-local"
            required
            value={plannedStart}
            onChange={(event) => setPlannedStart(event.target.value)}
            className="h-9 border border-input bg-background px-2"
          />
        </label>
        <label className="grid gap-1 text-xs md:col-span-2">
          <span className="label-mono">Notes</span>
          <textarea
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="resize-y border border-input bg-background px-2 py-1.5"
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2 md:col-span-2">
          <div className="min-w-0 flex-1">
            <span className="text-xs text-muted-foreground">
              {template?.checkpoints.length ?? 0} ordered checkpoints
            </span>
            <div className="mt-1 flex flex-wrap gap-1">
              {template?.checkpoints.map((checkpoint) => (
                <span
                  key={checkpoint.sequence}
                  className="border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  {String(checkpoint.sequence).padStart(2, "0")} {checkpoint.name}
                </span>
              ))}
            </div>
          </div>
          <button
            disabled={busy || !template || !vesselId}
            className="h-9 border border-signal/50 bg-signal/10 px-4 text-xs font-semibold text-signal disabled:opacity-50"
          >
            Create round
          </button>
        </div>
      </form>
    </Panel>
  );
}

function RoundDetail({
  round,
  findings,
  vesselName,
  busy,
  onRun,
}: {
  round: SafetyRound;
  findings: SafetyFinding[];
  vesselName: string;
  busy: boolean;
  onRun: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const done = round.checkpoints.filter((checkpoint) => checkpoint.status !== "NOT_CHECKED").length;
  const completion = round.checkpoints.length
    ? Math.round((done / round.checkpoints.length) * 100)
    : 0;
  const editable = ["PLANNED", "IN_PROGRESS", "OVERDUE"].includes(round.status);
  const activeFindings = findings.filter(
    (finding) => !["RESOLVED", "DISMISSED"].includes(finding.status),
  );

  return (
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <div className="label-mono">Vessel</div>
          <div className="mt-0.5 font-medium">{vesselName}</div>
        </div>
        <div>
          <div className="label-mono">Round type</div>
          <div className="mt-0.5">{round.round_type}</div>
        </div>
        <div>
          <div className="label-mono">Assigned to</div>
          <div className="mt-0.5">{round.assigned_to}</div>
        </div>
        <div>
          <div className="label-mono">Started</div>
          <div className="mt-0.5">{formatDate(round.started_at)}</div>
        </div>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-xs">
          <span>
            {done} / {round.checkpoints.length} checkpoints
          </span>
          <span className="tabular">{completion}%</span>
        </div>
        <div className="h-1.5 overflow-hidden bg-secondary">
          <div
            className="h-full bg-signal transition-[width]"
            style={{ width: `${completion}%` }}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {round.status === "PLANNED" || round.status === "OVERDUE" ? (
          <button
            disabled={busy}
            onClick={() => void onRun(() => startSafetyRound(round.round_id))}
            className="h-8 border border-signal/50 bg-signal/10 px-3 text-xs text-signal"
          >
            Start round
          </button>
        ) : null}
        {round.status === "IN_PROGRESS" ? (
          <button
            disabled={
              busy || done < round.checkpoints.filter((checkpoint) => checkpoint.required).length
            }
            onClick={() => void onRun(() => completeSafetyRound(round.round_id))}
            className="h-8 border border-secure/50 bg-secure/10 px-3 text-xs text-secure disabled:opacity-40"
          >
            Complete round
          </button>
        ) : null}
        {editable ? (
          <button
            disabled={busy}
            onClick={() => void onRun(() => cancelSafetyRound(round.round_id))}
            className="h-8 border border-border px-3 text-xs text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
        ) : null}
        {!editable ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3.5" /> Historical record · read-only
          </span>
        ) : null}
      </div>

      <section className="space-y-2">
        <h3 className="label-mono border-b border-border pb-1">Checkpoints · sequence</h3>
        {round.checkpoints.map((checkpoint) => (
          <div
            key={checkpoint.checkpoint_id}
            className="border border-border/80 bg-background/40 p-2.5"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {String(checkpoint.sequence).padStart(2, "0")}
                  </span>
                  <span className="text-xs font-semibold">{checkpoint.name}</span>
                  <StatusTag status={checkpoint.status} />
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {checkpoint.category} · {checkpoint.location}
                  {checkpoint.required ? " · Required" : " · Optional"}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{checkpoint.description}</p>
              </div>
            </div>
            {editable ? (
              <div className="mt-2 space-y-2">
                <textarea
                  aria-label={`Notes for ${checkpoint.name}`}
                  rows={1}
                  value={notes[checkpoint.checkpoint_id] ?? checkpoint.notes ?? ""}
                  onChange={(event) =>
                    setNotes((current) => ({
                      ...current,
                      [checkpoint.checkpoint_id]: event.target.value,
                    }))
                  }
                  placeholder="Inspection note"
                  className="w-full resize-y border border-input bg-background px-2 py-1.5 text-xs"
                />
                <div className="flex flex-wrap gap-1.5">
                  {CHECKPOINT_STATUSES.map((status) => (
                    <button
                      key={status}
                      disabled={busy}
                      onClick={() =>
                        void onRun(() =>
                          updateSafetyCheckpoint(round.round_id, checkpoint.checkpoint_id, {
                            status,
                            severity:
                              status === "FAIL" ? "HIGH" : status === "WARNING" ? "MEDIUM" : "INFO",
                            notes: notes[checkpoint.checkpoint_id] ?? checkpoint.notes ?? "",
                            completed_by: round.assigned_to,
                          }),
                        )
                      }
                      className={cn(
                        "h-7 border px-2 text-[10px] font-semibold hover:bg-accent disabled:opacity-40",
                        checkpoint.status === status
                          ? statusClass(status)
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {status === "NOT_APPLICABLE" ? "N/A" : status}
                    </button>
                  ))}
                </div>
              </div>
            ) : checkpoint.notes ? (
              <p className="mt-2 border-l-2 border-border pl-2 text-xs text-muted-foreground">
                {checkpoint.notes}
              </p>
            ) : null}
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between border-b border-border pb-1">
          <h3 className="label-mono">Corrective findings</h3>
          <span className="label-mono">{activeFindings.length} unresolved</span>
        </div>
        {findings.length ? (
          findings.map((finding) => (
            <FindingItem
              key={finding.finding_id}
              finding={finding}
              busy={busy}
              onSave={(patch) => onRun(() => updateSafetyFinding(finding.finding_id, patch))}
            />
          ))
        ) : (
          <p className="py-2 text-xs text-muted-foreground">No findings recorded for this round.</p>
        )}
      </section>
    </div>
  );
}

function FindingItem({
  finding,
  busy,
  onSave,
}: {
  finding: SafetyFinding;
  busy: boolean;
  onSave: (patch: {
    status?: SafetyFindingStatus;
    severity?: SafetySeverity;
    assigned_to?: string;
    due_date?: string | null;
    resolution_notes?: string;
  }) => Promise<void>;
}) {
  const [assignedTo, setAssignedTo] = useState(finding.assigned_to ?? "");
  const [resolution, setResolution] = useState(finding.resolution_notes);
  const [dueDate, setDueDate] = useState(finding.due_date?.slice(0, 10) ?? "");
  return (
    <div className="border border-border p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusTag status={finding.severity} />
        <strong className="min-w-0 flex-1 text-xs">{finding.title}</strong>
        <StatusTag status={finding.status} finding />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {finding.location || "Location not specified"} · {finding.description}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-[10px]">
          <span className="label-mono">Assigned to</span>
          <input
            value={assignedTo}
            onChange={(event) => setAssignedTo(event.target.value)}
            className="h-8 border border-input bg-background px-2 text-xs"
          />
        </label>
        <label className="grid gap-1 text-[10px]">
          <span className="label-mono">Status</span>
          <select
            value={finding.status}
            onChange={(event) => void onSave({ status: event.target.value as SafetyFindingStatus })}
            disabled={busy}
            className="h-8 border border-input bg-background px-2 text-xs"
          >
            {FINDING_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[10px]">
          <span className="label-mono">Due date</span>
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className="h-8 border border-input bg-background px-2 text-xs"
          />
        </label>
        <label className="grid gap-1 text-[10px] sm:col-span-2">
          <span className="label-mono">Resolution notes</span>
          <textarea
            rows={2}
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
            className="resize-y border border-input bg-background px-2 py-1.5 text-xs"
          />
        </label>
      </div>
      <button
        disabled={busy}
        onClick={() =>
          void onSave({
            assigned_to: assignedTo,
            due_date: dueDate ? new Date(`${dueDate}T00:00:00`).toISOString() : null,
            resolution_notes: resolution,
          })
        }
        className="mt-2 h-7 border border-border px-2.5 text-[10px] hover:bg-accent disabled:opacity-40"
      >
        Save corrective action
      </button>
    </div>
  );
}

function StatusTag({ status, finding = false }: { status: string; finding?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap border px-1.5 py-0.5 font-mono text-[9px] font-semibold",
        statusClass(status, finding),
      )}
    >
      {status === "NOT_APPLICABLE" ? "N/A" : status}
    </span>
  );
}

function formatDate(value: string | null) {
  return value
    ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "Not started";
}
