import { unavailableLabel, type MapRow, type PositionFeed } from "./mapModel";
import { reportAgeMs, type PositionUnavailableReason, type VesselPosition } from "./positions";
import type { Vessel } from "./types";
import { voyageText } from "./voyage";

/**
 * What the selected-vessel panel on /map shows about identity, route and position, from existing data only. Kept
 * apart from mapModel.ts, which tests load without a bundler and so may only import types.
 */

/**
 * What the panel can say about a position. "loading" and "no-data" mean no positions response has been received
 * yet, so nothing is known about any vessel; only "unavailable" carries a reason about this vessel.
 */
export type PositionContext =
  | { kind: "loading" }
  | { kind: "no-data" }
  | { kind: "unavailable"; reason: PositionUnavailableReason | "not-listed" }
  | {
      kind: "reported";
      position: VesselPosition;
      /** Age of the report against the snapshot's server evaluation time. */
      ageMs: number;
      evaluatedAt: number;
      /** False when the snapshot is the last one kept after a failed refresh, or the backend is unreachable. */
      live: boolean;
    };

export interface VesselContext {
  vesselId: string;
  name: string;
  /** Empty for a vessel only the positions data lists. */
  imo: string;
  /** Voyage text as every vessel page shows it (see voyageText); null for a vessel the store does not hold. */
  route: string | null;
  position: PositionContext;
  detailLink: { to: "/vessels/$vesselId"; params: { vesselId: string } };
}

export function vesselContext(input: {
  row: MapRow;
  vessel: Pick<Vessel, "route" | "simulatedRoute"> | undefined;
  dataSource: "seed" | "backend";
  feed: PositionFeed;
  backendOnline: boolean;
}): VesselContext {
  const { row, vessel, dataSource, feed, backendOnline } = input;
  const snapshot = feed.snapshot;
  let position: PositionContext;
  if (!snapshot) position = { kind: feed.status === "loading" ? "loading" : "no-data" };
  else if (row.position)
    position = {
      kind: "reported",
      position: row.position,
      ageMs: reportAgeMs(snapshot, row.position),
      evaluatedAt: snapshot.evaluatedAt,
      live: feed.status === "live" && backendOnline,
    };
  else position = { kind: "unavailable", reason: row.unavailable ?? "not-listed" };
  return {
    vesselId: row.id,
    name: row.name,
    imo: row.imo,
    route: vessel ? voyageText(vessel, dataSource) : null,
    position,
    detailLink: { to: "/vessels/$vesselId", params: { vesselId: row.id } },
  };
}

/** Text for a vessel without a reported position; never a location or a reason the data does not give. */
export function positionStatusText(
  position: Exclude<PositionContext, { kind: "reported" }>,
): string {
  if (position.kind === "loading") return "Loading positions…";
  if (position.kind === "no-data") return "Unavailable · no position data received";
  return `Unavailable · ${unavailableLabel[position.reason]}`;
}
