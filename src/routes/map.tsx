import { createFileRoute, Link } from "@tanstack/react-router";
import { RadioTower, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FleetMap, type CenterRequest } from "@/components/seashield/FleetMap";
import {
  PageHeader,
  Panel,
  ScoreBar,
  SeverityTag,
  StatusDot,
} from "@/components/seashield/primitives";
import { elapsed, stateColor, utcStamp } from "@/lib/seashield/format";
import {
  buildMapRows,
  feedAfterFailure,
  feedAfterSuccess,
  filterRows,
  fleetCounts,
  freshnessLabel,
  highestSeverity,
  INITIAL_FEED,
  markerStyle,
  matchesQuery,
  NO_FILTERS,
  startPositionPolling,
  type MapFilters,
  type MapRow,
  type PositionFeed,
} from "@/lib/seashield/mapModel";
import type { PositionFreshness } from "@/lib/seashield/positions";
import { positionStatusText, vesselContext } from "@/lib/seashield/vesselContext";
import { positionService, vesselService } from "@/lib/seashield/services";
import type { SecurityState, Severity } from "@/lib/seashield/types";
import { useSeaShield } from "@/lib/seashield/useSeaShield";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "Tactical Map — SeaShield" },
      {
        name: "description",
        content:
          "Simulated fleet overview for SeaShield: backend-owned simulated vessel positions with security status and position freshness. Not real AIS data and not a navigational chart.",
      },
      { property: "og:title", content: "Tactical Map — SeaShield" },
    ],
  }),
  component: MapView,
});

const SECURITY_FILTERS: SecurityState[] = ["secure", "elevated", "warning", "critical", "unknown"];
const FRESHNESS_FILTERS: PositionFreshness[] = ["current", "stale", "lost"];
const SEVERITY_FILTERS: Severity[] = ["critical", "high", "medium", "low"];

/** Polls the positions API every 60 s while the map is open; keeps the last good data when a refresh fails. */
function usePositionFeed(): PositionFeed {
  const [feed, setFeed] = useState<PositionFeed>(INITIAL_FEED);
  useEffect(
    () =>
      startPositionPolling({
        load: positionService.fetch,
        onSuccess: (snapshot) => setFeed((current) => feedAfterSuccess(current, snapshot)),
        onFailure: (cause) => setFeed((current) => feedAfterFailure(current, cause)),
      }),
    [],
  );
  return feed;
}

function MapView() {
  const vessels = useSeaShield((s) => s.vessels);
  const incidents = useSeaShield((s) => s.incidents);
  const selectedVesselId = useSeaShield((s) => s.selectedVesselId);
  const backend = useSeaShield((s) => s.connection.backend);
  const feed = usePositionFeed();
  const [filters, setFilters] = useState<MapFilters>(NO_FILTERS);
  const [centerRequest, setCenterRequest] = useState<CenterRequest>(null);

  const rows = useMemo(
    () =>
      buildMapRows(
        vessels.map((vessel) => {
          const open = incidents.filter((i) => i.vesselId === vessel.id && i.status !== "closed");
          return {
            id: vessel.id,
            name: vessel.name,
            imo: vessel.imo,
            securityState: vessel.securityState,
            incidentSeverity: highestSeverity(open.map((i) => i.severity)),
            openIncidents: open.length,
          };
        }),
        feed.snapshot,
      ),
    [vessels, incidents, feed.snapshot],
  );
  const visible = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const counts = fleetCounts(rows);
  const selected = rows.find((row) => row.id === selectedVesselId) ?? null;
  const notLive = feed.status === "unavailable" || backend !== "online";

  const select = (row: MapRow) => {
    vesselService.select(row.id);
    if (row.position)
      setCenterRequest((current) => ({ vesselId: row.id, seq: (current?.seq ?? 0) + 1 }));
  };
  const centreOnSearch = () => {
    const match = rows.find((row) => row.position && matchesQuery(row, filters.query));
    if (filters.query.trim() && match) select(match);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Tactical Map"
        subtitle="Fleet overview of simulated positions · operational overview, not a navigational chart"
      />
      <div
        role="status"
        className="flex shrink-0 items-center gap-2 border-b border-caution/40 bg-caution/10 px-4 py-1.5 font-mono text-xs font-semibold tracking-[0.12em] text-caution uppercase"
      >
        <RadioTower className="size-3.5" />
        Simulated positions — not real AIS or vessel data
      </div>
      <FeedStatus feed={feed} backendOnline={backend === "online"} counts={counts} />
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            centreOnSearch();
          }}
        >
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            placeholder="Vessel name or IMO"
            aria-label="Search vessels by name or IMO"
            className="h-7 w-48 rounded-sm border border-input bg-background px-2 text-xs"
          />
          <button
            type="submit"
            className="h-7 rounded-sm border border-border px-2 text-xs hover:bg-accent"
          >
            Centre
          </button>
        </form>
        <FilterGroup
          label="Security"
          options={SECURITY_FILTERS}
          active={filters.securityStates}
          onChange={(securityStates) => setFilters({ ...filters, securityStates })}
        />
        <FilterGroup
          label="Position"
          options={FRESHNESS_FILTERS}
          active={filters.freshness}
          onChange={(freshness) => setFilters({ ...filters, freshness })}
        />
        <FilterGroup
          label="Open incidents"
          options={SEVERITY_FILTERS}
          active={filters.incidentSeverities}
          onChange={(incidentSeverities) => setFilters({ ...filters, incidentSeverities })}
        />
        {filters.query ||
        filters.securityStates.length ||
        filters.freshness.length ||
        filters.incidentSeverities.length ? (
          <button
            type="button"
            className="label-mono hover:text-foreground"
            onClick={() => setFilters(NO_FILTERS)}
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <FleetMap
            rows={visible}
            selectedId={selected?.id ?? null}
            onSelect={(id) => {
              const row = rows.find((candidate) => candidate.id === id);
              if (row) vesselService.select(row.id);
            }}
            centerRequest={centerRequest}
            notLive={notLive}
          />
          <MapOverlay feed={feed} rows={rows} />
        </div>
        <aside className="flex w-[22rem] shrink-0 flex-col gap-2 overflow-auto border-l border-border p-2">
          <Panel
            title="Vessels"
            meta={`${visible.length} of ${rows.length} shown`}
            className="shrink-0"
          >
            <ul className="divide-y divide-border">
              {visible.map((row) => (
                <VesselRow
                  key={row.id}
                  row={row}
                  selected={row.id === selected?.id}
                  onSelect={() => select(row)}
                />
              ))}
              {visible.length === 0 ? (
                <li className="label-mono px-3 py-3 normal-case">
                  {rows.length === 0
                    ? "No vessels in the fleet."
                    : "No vessel matches the filters."}
                </li>
              ) : null}
            </ul>
          </Panel>
          {selected ? (
            <VesselDetail
              key={selected.id}
              row={selected}
              feed={feed}
              backendOnline={backend === "online"}
            />
          ) : (
            <Panel title="Vessel detail" className="shrink-0">
              <p className="label-mono px-3 py-3 normal-case">
                Select a vessel on the map or in the list.
              </p>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

function FeedStatus({
  feed,
  backendOnline,
  counts,
}: {
  feed: PositionFeed;
  backendOnline: boolean;
  counts: ReturnType<typeof fleetCounts>;
}) {
  const asOf = feed.snapshot ? utcStamp(feed.snapshot.evaluatedAt) : null;
  let state: ReactNode;
  if (feed.status === "loading")
    state = <span className="text-muted-foreground">Loading positions…</span>;
  else if (feed.status === "unavailable")
    state = (
      <span className="text-warning">
        Positions unavailable ·{" "}
        {asOf ? `showing the last data received, as of ${asOf}` : "no position data received"}
      </span>
    );
  else if (!backendOnline)
    state = (
      <span className="text-warning">Backend unreachable · positions not live, as of {asOf}</span>
    );
  else state = <span className="text-secure">Positions as of {asOf} · refreshed every 60 s</span>;
  return (
    <div className="label-mono flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-1.5 normal-case">
      {state}
      <span className="ml-auto flex gap-3 tabular">
        <span>{counts.total} vessels</span>
        {/* Neutral: the status colours belong to security status, not to position contact. */}
        <span>{counts.current} current</span>
        <span>{counts.stale} stale</span>
        <span>{counts.lost} lost</span>
        <span>{counts.unavailable} unavailable</span>
      </span>
    </div>
  );
}

function MapOverlay({ feed, rows }: { feed: PositionFeed; rows: MapRow[] }) {
  let message: string | null = null;
  if (!feed.snapshot)
    message =
      feed.status === "loading"
        ? "Loading positions…"
        : "No position data — the positions service is unavailable.";
  else if (rows.length === 0) message = "No vessels in the fleet.";
  else if (feed.snapshot.positions.length === 0) message = "No vessel has a position report.";
  if (!message) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/2 flex justify-center">
      <div className="rounded-sm border border-border bg-panel/95 px-3 py-2 text-sm text-muted-foreground">
        {message}
      </div>
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  active,
  onChange,
}: {
  label: string;
  options: T[];
  active: T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label={`Filter by ${label.toLowerCase()}`}
    >
      <span className="label-mono mr-1">{label}</span>
      {options.map((option) => {
        const on = active.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(on ? active.filter((value) => value !== option) : [...active, option])
            }
            className={cn(
              "rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] uppercase",
              on
                ? "border-signal bg-signal/15 text-signal"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function VesselRow({
  row,
  selected,
  onSelect,
}: {
  row: MapRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent/50",
          selected && "bg-sidebar-accent",
        )}
      >
        <StatusDot state={row.securityState} pulse={false} />
        <span className="min-w-0 flex-1 truncate">{row.name}</span>
        <span className={cn("label-mono", stateColor[row.securityState])}>{row.securityState}</span>
        <PositionBadge row={row} />
      </button>
    </li>
  );
}

/**
 * Contact as text and border style, in neutral colours: the status colours stay reserved for the security status
 * shown beside it, so a lost but secure vessel never looks critical.
 */
function PositionBadge({ row }: { row: MapRow }) {
  if (!row.position) return <span className="label-mono text-muted-foreground">NO POSITION</span>;
  const style = markerStyle(row.securityState, row.position.freshness);
  return (
    <span
      className={cn(
        "label-mono rounded-sm border px-1",
        style.outline === "solid" && "border-border text-foreground",
        style.outline === "dashed" && "border-dashed border-foreground text-foreground",
        style.outline === "hollow" && "border-foreground bg-foreground text-background",
      )}
    >
      {freshnessLabel[row.position.freshness]}
    </span>
  );
}

const coordinate = (value: number, positive: string, negative: string) =>
  `${Math.abs(value).toFixed(5)}° ${value >= 0 ? positive : negative}`;

function VesselDetail({
  row,
  feed,
  backendOnline,
}: {
  row: MapRow;
  feed: PositionFeed;
  backendOnline: boolean;
}) {
  const vessel = useSeaShield((s) => s.vessels.find((v) => v.id === row.id));
  const dataSource = useSeaShield((s) => s.dataSource);
  const incidents = useSeaShield((s) => s.incidents);
  const events = useSeaShield((s) => s.events);
  const simLog = useSeaShield((s) => s.simLog);
  const openIncidents = incidents.filter((i) => i.vesselId === row.id && i.status !== "closed");
  const latestEvents = events.filter((e) => e.vesselId === row.id).slice(0, 3);
  const logEntries = simLog.filter((entry) => entry.vesselId === row.id).slice(0, 3);
  const context = vesselContext({ row, vessel, dataSource, feed, backendOnline });
  const position = context.position;

  return (
    <Panel
      title={context.name}
      meta={context.imo || context.vesselId}
      className="shrink-0"
      actions={
        <button
          type="button"
          aria-label={`Close vessel context for ${context.name}`}
          title="Close"
          onClick={() => vesselService.select("all")}
          className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      }
    >
      <dl className="space-y-2 px-3 py-2.5 text-xs">
        <Term label="Security status">
          <span className={cn("font-semibold uppercase", stateColor[row.securityState])}>
            {row.securityState}
          </span>
          {vessel ? (
            <span className="ml-2 tabular text-muted-foreground">score {vessel.securityScore}</span>
          ) : null}
          {vessel ? (
            <div className="mt-1">
              <ScoreBar score={vessel.securityScore} state={vessel.securityState} />
            </div>
          ) : null}
        </Term>
        <Term label="Route">
          <span className={cn(context.route === null && "text-muted-foreground")}>
            {context.route ?? "—"}
          </span>
        </Term>
        {position.kind === "reported" ? (
          <>
            {position.live ? null : (
              <p className="text-warning">
                Positions not live · last data received, as of {utcStamp(position.evaluatedAt)}
              </p>
            )}
            <Term label="Position">
              <span className="tabular">
                {coordinate(position.position.lat, "N", "S")},{" "}
                {coordinate(position.position.lon, "E", "W")}
              </span>
            </Term>
            <Term label="Course / speed">
              <span className="tabular">
                {position.position.courseDeg === null
                  ? "—"
                  : `${position.position.courseDeg.toFixed(1)}°`}{" "}
                ·{" "}
                {position.position.speedKn === null
                  ? "—"
                  : `${position.position.speedKn.toFixed(1)} kn`}
              </span>
            </Term>
            <Term label="Position contact">
              <PositionBadge row={row} />
            </Term>
            <Term label="Last position report">
              <span className="tabular">
                {utcStamp(position.position.positionAt)} · {elapsed(0, position.ageMs)} old as of{" "}
                {utcStamp(position.evaluatedAt)}
              </span>
            </Term>
            <Term label="Source">
              <span className="font-mono text-caution">SIMULATED</span>
            </Term>
          </>
        ) : (
          <Term label="Position">
            <span className="text-muted-foreground">{positionStatusText(position)}</span>
          </Term>
        )}
        <Term label="Last security event recorded">
          <span className="tabular">{vessel?.lastComms ? utcStamp(vessel.lastComms) : "—"}</span>
        </Term>
      </dl>
      <Section title={`Open incidents (${openIncidents.length})`}>
        {openIncidents.slice(0, 4).map((incident) => (
          <li key={incident.id} className="flex items-center gap-2">
            <SeverityTag severity={incident.severity} />
            <Link to="/incidents" className="min-w-0 flex-1 truncate hover:text-signal">
              {incident.ref} · {incident.title}
            </Link>
          </li>
        ))}
      </Section>
      <Section title="Latest events">
        {latestEvents.map((event) => (
          <li key={event.id} className="truncate">
            <span className="tabular text-muted-foreground">{utcStamp(event.ts)}</span>{" "}
            {event.title}
          </li>
        ))}
      </Section>
      <Section title="Simulation log">
        {logEntries.map((entry) => (
          <li key={entry.id} className="truncate">
            <span className="tabular text-muted-foreground">{utcStamp(entry.ts)}</span>{" "}
            {entry.outcome}
          </li>
        ))}
      </Section>
      <div className="border-t border-border px-3 py-2">
        <Link
          to={context.detailLink.to}
          params={context.detailLink.params}
          aria-label={`Open vessel page for ${context.name}`}
          className="label-mono hover:text-signal"
        >
          Open vessel page →
        </Link>
      </div>
    </Panel>
  );
}

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="label-mono">{label}</dt>
      <dd className="mt-0.5 min-w-0">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode[] }) {
  return (
    <div className="border-t border-border px-3 py-2">
      <h3 className="label-mono mb-1.5">{title}</h3>
      {children.length ? (
        <ul className="space-y-1 text-xs">{children}</ul>
      ) : (
        <p className="label-mono normal-case">None.</p>
      )}
    </div>
  );
}
