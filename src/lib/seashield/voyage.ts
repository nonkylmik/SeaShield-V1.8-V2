import type { Vessel } from "./types";

/**
 * The voyage text a vessel card or page shows. A backend vessel shows only the label of its simulated route from the
 * backend route configuration (the same route the tactical map draws), or that it has none; never the seed fixture's
 * voyage text, which belongs to a different, sort-order-assigned fixture vessel. Seed data keeps its own fixture text.
 */
export function voyageText(
  vessel: Pick<Vessel, "route" | "simulatedRoute">,
  dataSource: "seed" | "backend",
): string {
  if (dataSource === "seed") return vessel.route;
  return vessel.simulatedRoute
    ? `Simulated route · ${vessel.simulatedRoute}`
    : "No simulated route";
}
