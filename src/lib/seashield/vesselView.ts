/**
 * Decides what the vessel detail route renders. The store starts with seed data
 * (vessel ids vsl-01…) and only receives backend vessels after the first client
 * fetch, so a direct load must not treat "missing from seed data" as not found.
 */
export function vesselView(input: {
  found: boolean;
  dataSource: "seed" | "backend";
  backend: string;
}): "ready" | "loading" | "not-found" {
  if (input.found) return "ready";
  if (input.dataSource === "backend" || input.backend === "degraded") return "not-found";
  return "loading";
}
