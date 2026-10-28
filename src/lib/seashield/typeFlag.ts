import type { Vessel } from "./types";

/** Shown instead of a vessel's type and flag when the backend has none to give. */
export const NO_TYPE_FLAG = "—";

/**
 * The type and flag text a vessel card or page shows. The backend has no vessel type or flag, so a backend vessel
 * shows a neutral placeholder; never the seed fixture's values, which belong to a different, sort-order-assigned
 * fixture vessel. Decided by data source, not by whether the fields are empty. Seed data keeps its own fixture values.
 */
export function typeFlagText(
  vessel: Pick<Vessel, "type" | "flag">,
  dataSource: "seed" | "backend",
): string {
  if (dataSource === "seed") return `${vessel.type} · ${vessel.flag}`;
  return NO_TYPE_FLAG;
}
