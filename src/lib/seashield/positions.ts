/**
 * Simulated vessel positions from GET /api/v1/vessels/positions, for the tactical map.
 *
 * The backend owns every position, report time and freshness classification. This module only validates and
 * displays what the API sends: it never computes a position, never re-ages a report with the browser clock and
 * never reuses the communication-age thresholds of freshness.ts.
 */

/** Position freshness as classified by the backend (CURRENT / STALE / LOST). */
export type PositionFreshness = "current" | "stale" | "lost";
/** Why a vessel has no marker: as the API reported it, or "invalid" when an entry failed the browser's checks. */
export type PositionUnavailableReason = "no-route" | "no-report" | "invalid";

export interface VesselPosition {
  vesselId: string;
  lat: number;
  lon: number;
  courseDeg: number | null;
  speedKn: number | null;
  /** Epoch ms when the represented position was reported. */
  positionAt: number;
  /** Epoch ms when the simulated report was recorded as received. */
  receivedAt: number;
  source: "simulated";
  freshness: PositionFreshness;
}

export interface UnavailablePosition {
  vesselId: string;
  reason: PositionUnavailableReason;
}

export interface PositionsSnapshot {
  /** Epoch ms of the server time the response was computed for; ages are measured against it. */
  evaluatedAt: number;
  positions: VesselPosition[];
  unavailable: UnavailablePosition[];
}

const FRESHNESS = new Map<unknown, PositionFreshness>([
  ["CURRENT", "current"],
  ["STALE", "stale"],
  ["LOST", "lost"],
]);
const UNAVAILABLE = new Map<unknown, PositionUnavailableReason>([
  ["NO_ROUTE", "no-route"],
  ["NO_REPORT", "no-report"],
]);
const ZONED_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** A UTC timestamp with an explicit zone, as the contract requires; null for anything else. */
function zonedTime(value: unknown): number | null {
  if (typeof value !== "string" || !ZONED_TIMESTAMP.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function optionalNumber(value: unknown, valid: (n: number) => boolean): number | null | undefined {
  if (value === null || value === undefined) return null;
  return finite(value) && valid(value) ? value : undefined;
}

function parsePosition(entry: unknown, evaluatedAt: number): VesselPosition | null {
  if (!isRecord(entry)) return null;
  const { lat, lon } = entry;
  const vesselId = entry["vessel_id"];
  const freshness = FRESHNESS.get(entry["freshness"]);
  const positionAt = zonedTime(entry["position_at"]);
  const receivedAt = zonedTime(entry["received_at"]);
  const courseDeg = optionalNumber(entry["course_deg"], (n) => n >= 0 && n < 360);
  const speedKn = optionalNumber(entry["speed_kn"], (n) => n >= 0);
  if (
    typeof vesselId !== "string" ||
    !finite(lat) ||
    !finite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180 ||
    entry["source"] !== "SIMULATED" ||
    freshness === undefined ||
    positionAt === null ||
    receivedAt === null ||
    receivedAt < positionAt ||
    positionAt > evaluatedAt ||
    courseDeg === undefined ||
    speedKn === undefined
  )
    return null;
  return {
    vesselId,
    lat,
    lon,
    courseDeg,
    speedKn,
    positionAt,
    receivedAt,
    source: "simulated",
    freshness,
  };
}

/**
 * Validates a positions response. A malformed envelope throws, so the caller keeps its last good data; a single
 * malformed entry never gets a default location and is listed as unavailable ("invalid") instead.
 */
export function parsePositionsResponse(body: unknown): PositionsSnapshot {
  if (!isRecord(body) || !Array.isArray(body["positions"]) || !Array.isArray(body["unavailable"]))
    throw new Error("Malformed positions response");
  const evaluatedAt = zonedTime(body["evaluated_at"]);
  if (evaluatedAt === null) throw new Error("Malformed positions response: evaluated_at");
  const positions: VesselPosition[] = [];
  const unavailable: UnavailablePosition[] = [];
  const listed = new Set<string>();
  const addUnavailable = (vesselId: string, reason: PositionUnavailableReason) => {
    if (listed.has(vesselId)) return;
    listed.add(vesselId);
    unavailable.push({ vesselId, reason });
  };
  for (const entry of body["positions"]) {
    const position = parsePosition(entry, evaluatedAt);
    const vesselId = isRecord(entry) ? entry["vessel_id"] : undefined;
    if (position && !listed.has(position.vesselId)) {
      listed.add(position.vesselId);
      positions.push(position);
    } else if (!position && typeof vesselId === "string") addUnavailable(vesselId, "invalid");
  }
  for (const entry of body["unavailable"]) {
    if (!isRecord(entry) || typeof entry["vessel_id"] !== "string") continue;
    addUnavailable(entry["vessel_id"], UNAVAILABLE.get(entry["reason"]) ?? "invalid");
  }
  return { evaluatedAt, positions, unavailable };
}

/** Age of a report against the server's evaluation time, never against the browser clock. */
export function reportAgeMs(snapshot: PositionsSnapshot, position: VesselPosition): number {
  return Math.max(0, snapshot.evaluatedAt - position.positionAt);
}
