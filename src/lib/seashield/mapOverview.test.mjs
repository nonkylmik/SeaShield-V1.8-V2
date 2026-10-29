// Run with: npm run test:unit
// The tactical map's fleet summary strip, incident evidence and incident badges show backend data as received: the
// summary counts backend states and open incidents (it never scores), evidence the loaded window does not hold is
// named rather than dropped, and the badge and the incident filter both use the vessel's worst open incident.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildMapRows,
  filterRows,
  highestSeverity,
  incidentBadge,
  NO_FILTERS,
} from "./mapModel.ts";
import {
  fleetSummaryView,
  incidentEvidence,
  isOpenIncident,
  SECURITY_STATE_ORDER,
} from "./mapOverview.ts";

const AS_OF = Date.UTC(2026, 9, 29, 10, 0, 0);

const summaryInput = (overrides = {}) => ({
  lastRefreshAt: AS_OF,
  backend: "online",
  vesselCount: 3,
  average: { score: 80, state: "elevated" },
  vessels: [
    { securityState: "critical" },
    { securityState: "secure" },
    { securityState: "unknown" },
  ],
  incidents: [
    { status: "open", severity: "critical" },
    { status: "investigating", severity: "high" },
    { status: "contained", severity: "high" },
    { status: "closed", severity: "critical" },
  ],
  ...overrides,
});

test("the summary shows the backend's vessel count, average and status, and counts open incidents", () => {
  const view = fleetSummaryView(summaryInput());
  assert.equal(view.kind, "summary");
  assert.equal(view.vesselCount, 3);
  // The backend's classification of the average, passed through; not recomputed from the vessels.
  assert.deepEqual(view.average, { score: 80, state: "elevated" });
  assert.deepEqual(view.vesselsByState, {
    critical: 1,
    warning: 0,
    elevated: 0,
    secure: 1,
    unknown: 1,
  });
  // A closed (RESOLVED or FALSE POSITIVE) incident is not open; contained still is.
  assert.equal(view.openIncidents, 3);
  assert.deepEqual(view.openBySeverity, { critical: 1, high: 2, medium: 0, low: 0, info: 0 });
  assert.equal(view.asOf, AS_OF);
  assert.equal(view.live, true);
});

test("all four backend states and unknown are kept apart, never collapsed", () => {
  assert.deepEqual(SECURITY_STATE_ORDER, ["critical", "warning", "elevated", "secure", "unknown"]);
  const vessels = SECURITY_STATE_ORDER.map((securityState) => ({ securityState }));
  const view = fleetSummaryView(summaryInput({ vesselCount: 5, vessels }));
  for (const state of SECURITY_STATE_ORDER) assert.equal(view.vesselsByState[state], 1, state);
});

test("before any backend data the summary is loading, or unavailable once the backend failed", () => {
  // The store holds demo fixtures at this point; they must not be summarised as the fleet.
  assert.deepEqual(fleetSummaryView(summaryInput({ lastRefreshAt: null })), { kind: "loading" });
  assert.deepEqual(fleetSummaryView(summaryInput({ lastRefreshAt: null, backend: "degraded" })), {
    kind: "unavailable",
  });
});

test("an empty fleet is shown as empty, not as an all-zero summary", () => {
  const view = fleetSummaryView(
    summaryInput({ vesselCount: 0, average: null, vessels: [], incidents: [] }),
  );
  assert.deepEqual(view, { kind: "empty", asOf: AS_OF, live: true });
});

test("figures kept after the backend became unreachable are marked not live, with their time", () => {
  const view = fleetSummaryView(summaryInput({ backend: "degraded" }));
  assert.equal(view.kind, "summary");
  assert.equal(view.live, false);
  assert.equal(view.asOf, AS_OF);
});

test("a missing average or vessel count stays missing, never a made-up number", () => {
  const view = fleetSummaryView(summaryInput({ vesselCount: null, average: null }));
  assert.equal(view.vesselCount, null);
  assert.equal(view.average, null);
});

const event = (id, ts) => ({
  id,
  ts,
  vesselId: "calypso",
  category: "cyber",
  severity: "high",
  title: id,
  detail: "",
  source: "Network Monitor",
  acknowledged: false,
});

test("evidence lists loaded events oldest first, then names the ones outside the loaded window", () => {
  const events = [event("evt-c", 3000), event("evt-a", 1000)];
  const evidence = incidentEvidence({ eventIds: ["evt-c", "evt-gone", "evt-a"] }, events);
  assert.deepEqual(
    evidence.items.map((item) =>
      item.kind === "loaded" ? item.event.id : `missing:${item.eventId}`,
    ),
    ["evt-a", "evt-c", "missing:evt-gone"],
  );
  assert.equal(evidence.notLoaded, 1);
});

test("evidence with no linked events is empty, and a repeated link is listed once", () => {
  assert.deepEqual(incidentEvidence({ eventIds: [] }, [event("evt-a", 1)]), {
    items: [],
    notLoaded: 0,
  });
  const evidence = incidentEvidence({ eventIds: ["evt-a", "evt-a", "evt-x", "evt-x"] }, [
    event("evt-a", 1),
  ]);
  assert.equal(evidence.items.length, 2);
  assert.equal(evidence.notLoaded, 1);
});

test("an incident is open until it is closed", () => {
  for (const status of ["open", "investigating", "contained"])
    assert.equal(isOpenIncident({ status }), true, status);
  assert.equal(isOpenIncident({ status: "closed" }), false);
});

const mapVessel = (id, severities) => ({
  id,
  name: id,
  imo: "",
  securityState: "secure",
  incidentSeverity: highestSeverity(severities),
  openIncidents: severities.length,
});

test("the marker badge shows the open-incident count in the worst open severity, and nothing without one", () => {
  assert.deepEqual(incidentBadge(mapVessel("a", ["medium", "critical", "low"])), {
    count: 3,
    severity: "critical",
  });
  assert.equal(incidentBadge(mapVessel("b", [])), null);
});

test("the incident filter matches a vessel's worst open incident only, like its badge", () => {
  const rows = buildMapRows(
    [mapVessel("mixed", ["critical", "medium"]), mapVessel("medium-only", ["medium"])],
    null,
  );
  const medium = filterRows(rows, { ...NO_FILTERS, incidentSeverities: ["medium"] });
  assert.deepEqual(
    medium.map((row) => row.id),
    ["medium-only"],
  );
  const critical = filterRows(rows, { ...NO_FILTERS, incidentSeverities: ["critical"] });
  assert.deepEqual(
    critical.map((row) => row.id),
    ["mixed"],
  );
});
