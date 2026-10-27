import type {
  PositionFreshness,
  PositionsSnapshot,
  PositionUnavailableReason,
  VesselPosition,
} from "./positions";
import type { SecurityState, Severity } from "./types";

/**
 * Display model of the tactical map: marker styling, rows, filters, zoom and polling. Map-only, so it loads with
 * the /map route chunk; positions.ts holds the API contract the rest of the app shares.
 */

export const freshnessLabel: Record<PositionFreshness, string> = {
  current: "CURRENT",
  stale: "STALE",
  lost: "LOST",
};

export const unavailableLabel: Record<PositionUnavailableReason | "not-listed", string> = {
  "no-route": "No simulated route",
  "no-report": "No position report yet",
  invalid: "Position data failed validation",
  "not-listed": "Not in the positions data",
};

export interface MarkerStyle {
  /** Colour of the marker: the backend security status only. */
  securityState: SecurityState;
  /** Contact shown by shape, never by colour: solid outline, dashed outline, or a hollow marker. */
  outline: "solid" | "dashed" | "hollow";
  /** Text label for contact, so freshness never relies on colour alone. */
  label: string | null;
}

/** Security status and position freshness are separate facts: one sets the colour, the other the shape and label. */
export function markerStyle(
  securityState: SecurityState,
  freshness: PositionFreshness,
): MarkerStyle {
  if (freshness === "lost") return { securityState, outline: "hollow", label: freshnessLabel.lost };
  if (freshness === "stale")
    return { securityState, outline: "dashed", label: freshnessLabel.stale };
  return { securityState, outline: "solid", label: null };
}

export interface MapVessel {
  id: string;
  name: string;
  imo: string;
  securityState: SecurityState;
  /** Highest severity among the vessel's open incidents, or null with none open. */
  incidentSeverity: Severity | null;
  openIncidents: number;
}

export interface MapRow extends MapVessel {
  position: VesselPosition | null;
  unavailable: PositionUnavailableReason | "not-listed" | null;
}

const SEVERITY_RANK: Severity[] = ["info", "low", "medium", "high", "critical"];

export function highestSeverity(severities: Severity[]): Severity | null {
  return severities.reduce<Severity | null>(
    (worst, severity) =>
      worst === null || SEVERITY_RANK.indexOf(severity) > SEVERITY_RANK.indexOf(worst)
        ? severity
        : worst,
    null,
  );
}

/**
 * One row per vessel: store vessels in their order, then any vessel only the positions data lists (shown with an
 * unknown status). A vessel without a usable position keeps its reason and gets no marker.
 */
export function buildMapRows(vessels: MapVessel[], snapshot: PositionsSnapshot | null): MapRow[] {
  const positions = new Map(snapshot?.positions.map((p) => [p.vesselId, p]) ?? []);
  const unavailable = new Map(snapshot?.unavailable.map((u) => [u.vesselId, u.reason]) ?? []);
  const known = new Set(vessels.map((v) => v.id));
  const extra: MapVessel[] = [...positions.keys(), ...unavailable.keys()]
    .filter((id, index, ids) => !known.has(id) && ids.indexOf(id) === index)
    .map((id) => ({
      id,
      name: id,
      imo: "",
      securityState: "unknown",
      incidentSeverity: null,
      openIncidents: 0,
    }));
  return [...vessels, ...extra].map((vessel) => {
    const position = positions.get(vessel.id) ?? null;
    return {
      ...vessel,
      position,
      unavailable: position ? null : (unavailable.get(vessel.id) ?? "not-listed"),
    };
  });
}

export interface MapFilters {
  query: string;
  securityStates: SecurityState[];
  freshness: PositionFreshness[];
  incidentSeverities: Severity[];
}

export const NO_FILTERS: MapFilters = {
  query: "",
  securityStates: [],
  freshness: [],
  incidentSeverities: [],
};

export function matchesQuery(row: MapRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    needle === "" ||
    row.name.toLowerCase().includes(needle) ||
    row.imo.toLowerCase().includes(needle) ||
    row.id.toLowerCase().includes(needle)
  );
}

/** Rows the filters keep. An empty group means "any"; a freshness filter keeps only vessels with a position. */
export function filterRows(rows: MapRow[], filters: MapFilters): MapRow[] {
  return rows.filter(
    (row) =>
      matchesQuery(row, filters.query) &&
      (filters.securityStates.length === 0 || filters.securityStates.includes(row.securityState)) &&
      (filters.freshness.length === 0 ||
        (row.position !== null && filters.freshness.includes(row.position.freshness))) &&
      (filters.incidentSeverities.length === 0 ||
        (row.incidentSeverity !== null &&
          filters.incidentSeverities.includes(row.incidentSeverity))),
  );
}

/** Fleet counts over all rows, unaffected by filters. */
export function fleetCounts(rows: MapRow[]) {
  const count = (freshness: PositionFreshness) =>
    rows.filter((row) => row.position?.freshness === freshness).length;
  return {
    total: rows.length,
    current: count("current"),
    stale: count("stale"),
    lost: count("lost"),
    unavailable: rows.filter((row) => row.position === null).length,
  };
}

// --- View: zoom and pan over the projected map --------------------------------------------------------------------

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

/** Screen point = map point × k + (x, y), in the SVG's viewBox units. */
export interface MapView {
  k: number;
  x: number;
  y: number;
}

export const WORLD_VIEW: MapView = { k: 1, x: 0, y: 0 };

/** Keeps zoom within 1×–8× and panning within the world outline (the map always covers the viewport). */
export function clampView(view: MapView, width: number, height: number): MapView {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k));
  return {
    k,
    x: Math.min(0, Math.max(width - width * k, view.x)),
    y: Math.min(0, Math.max(height - height * k, view.y)),
  };
}

/** Zooms by `factor` keeping the map point under (cx, cy) fixed on screen. */
export function zoomAt(
  view: MapView,
  factor: number,
  cx: number,
  cy: number,
  width: number,
  height: number,
): MapView {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * factor));
  const ratio = k / view.k;
  return clampView(
    { k, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio },
    width,
    height,
  );
}

/** Centres a map point at zoom k. */
export function centerOn(
  point: [number, number],
  k: number,
  width: number,
  height: number,
): MapView {
  return clampView({ k, x: width / 2 - point[0] * k, y: height / 2 - point[1] * k }, width, height);
}

/** Fits the bounding box of the points with 10% padding, capped at 8×; the world view when there are none. */
export function fitPoints(points: [number, number][], width: number, height: number): MapView {
  if (points.length === 0) return WORLD_VIEW;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const spanX = (maxX - minX) * 1.2;
  const spanY = (maxY - minY) * 1.2;
  const k = Math.min(
    MAX_ZOOM,
    spanX > 0 ? width / spanX : MAX_ZOOM,
    spanY > 0 ? height / spanY : MAX_ZOOM,
  );
  return centerOn([(minX + maxX) / 2, (minY + maxY) / 2], k, width, height);
}

// --- Polling ------------------------------------------------------------------------------------------------------

export const POSITION_POLL_MS = 60_000;

export interface PositionFeed {
  /** The last successfully received snapshot; kept when a later refresh fails. */
  snapshot: PositionsSnapshot | null;
  status: "loading" | "live" | "unavailable";
  error: string | null;
}

export const INITIAL_FEED: PositionFeed = { snapshot: null, status: "loading", error: null };

/** A successful response replaces the cached positions. */
export function feedAfterSuccess(_feed: PositionFeed, snapshot: PositionsSnapshot): PositionFeed {
  return { snapshot, status: "live", error: null };
}

/** A failed refresh keeps the last positions received and marks them unavailable (not live). */
export function feedAfterFailure(feed: PositionFeed, cause: unknown): PositionFeed {
  return {
    snapshot: feed.snapshot,
    status: "unavailable",
    error: cause instanceof Error ? cause.message : String(cause),
  };
}

export interface PollTimers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

/**
 * Loads positions now and again `intervalMs` after each load settles, so requests never overlap. The returned
 * function stops polling; a load still in flight when it is called is ignored.
 */
export function startPositionPolling(options: {
  load: () => Promise<PositionsSnapshot>;
  onSuccess: (snapshot: PositionsSnapshot) => void;
  onFailure: (cause: unknown) => void;
  intervalMs?: number;
  timers?: PollTimers;
}): () => void {
  const { load, onSuccess, onFailure, intervalMs = POSITION_POLL_MS } = options;
  const timers: PollTimers = options.timers ?? {
    set: (callback, ms) => setTimeout(callback, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let stopped = false;
  let handle: unknown;
  const run = () => {
    load()
      .then(
        (snapshot) => {
          if (!stopped) onSuccess(snapshot);
        },
        (cause: unknown) => {
          if (!stopped) onFailure(cause);
        },
      )
      .finally(() => {
        if (!stopped) handle = timers.set(run, intervalMs);
      });
  };
  run();
  return () => {
    stopped = true;
    timers.clear(handle);
  };
}
