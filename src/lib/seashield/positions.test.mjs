// Run with: node --test src/lib/seashield/positions.test.mjs
// The tactical map shows simulated positions exactly as GET /api/v1/vessels/positions reports them: the backend owns
// positions, report times and freshness; the browser validates, joins and draws, and never re-ages a report.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildMapRows,
  centerOn,
  clampView,
  feedAfterFailure,
  feedAfterSuccess,
  filterRows,
  fitPoints,
  fleetCounts,
  INITIAL_FEED,
  markerStyle,
  MAX_ZOOM,
  NO_FILTERS,
  startPositionPolling,
  WORLD_VIEW,
  zoomAt,
} from "./mapModel.ts";
import { parsePositionsResponse, reportAgeMs } from "./positions.ts";

const EVALUATED_AT = "2026-10-27T12:04:10Z";

function entry(overrides = {}) {
  return {
    vessel_id: "calypso",
    lat: 12.5,
    lon: 45.25,
    course_deg: 84.2,
    speed_kn: 12,
    position_at: "2026-10-27T12:03:00Z",
    received_at: "2026-10-27T12:03:00Z",
    source: "SIMULATED",
    freshness: "CURRENT",
    ...overrides,
  };
}

const body = (positions = [entry()], unavailable = []) => ({
  evaluated_at: EVALUATED_AT,
  positions,
  unavailable,
});

const vessel = (id, overrides = {}) => ({
  id,
  name: `MV ${id}`,
  imo: `IMO ${id.length}000000`,
  securityState: "secure",
  incidentSeverity: null,
  openIncidents: 0,
  ...overrides,
});

// --- API-driven positions and freshness ---------------------------------------------------------------------------

test("a valid response is parsed with UTC timestamps and the backend's freshness", () => {
  const snapshot = parsePositionsResponse(body());
  assert.equal(snapshot.evaluatedAt, Date.parse(EVALUATED_AT));
  assert.deepEqual(snapshot.positions, [
    {
      vesselId: "calypso",
      lat: 12.5,
      lon: 45.25,
      courseDeg: 84.2,
      speedKn: 12,
      positionAt: Date.parse("2026-10-27T12:03:00Z"),
      receivedAt: Date.parse("2026-10-27T12:03:00Z"),
      source: "simulated",
      freshness: "current",
    },
  ]);
  assert.deepEqual(snapshot.unavailable, []);
});

test("freshness is taken from the API, never recomputed from the report's age", () => {
  // Three hours old, yet the backend says CURRENT: the map shows CURRENT. Only the backend classifies.
  const old = parsePositionsResponse(
    body([entry({ position_at: "2026-10-27T09:00:00Z", received_at: "2026-10-27T09:00:00Z" })]),
  );
  assert.equal(old.positions[0].freshness, "current");
  // A brand-new report the backend calls LOST stays LOST.
  const lost = parsePositionsResponse(body([entry({ freshness: "LOST" })]));
  assert.equal(lost.positions[0].freshness, "lost");
  assert.equal(
    parsePositionsResponse(body([entry({ freshness: "STALE" })])).positions[0].freshness,
    "stale",
  );
});

test("a report's age is measured against the server's evaluation time, not the browser clock", () => {
  const snapshot = parsePositionsResponse(body());
  const realNow = Date.now;
  Date.now = () => Date.parse("2030-01-01T00:00:00Z");
  try {
    assert.equal(reportAgeMs(snapshot, snapshot.positions[0]), 70_000);
  } finally {
    Date.now = realNow;
  }
});

test("course and speed may be null", () => {
  const [position] = parsePositionsResponse(
    body([entry({ course_deg: null, speed_kn: null })]),
  ).positions;
  assert.equal(position.courseDeg, null);
  assert.equal(position.speedKn, null);
});

test("an entry failing validation gets no marker and no default location", () => {
  const invalid = [
    entry({ vessel_id: "lat-high", lat: 91 }),
    entry({ vessel_id: "lon-text", lon: "45" }),
    entry({ vessel_id: "lat-null", lat: null }),
    entry({
      vessel_id: "naive-time",
      position_at: "2026-10-27T12:03:00",
      received_at: "2026-10-27T12:03:00",
    }),
    entry({ vessel_id: "freshness", freshness: "FRESH" }),
    entry({ vessel_id: "source", source: "AIS" }),
    entry({ vessel_id: "received-early", received_at: "2026-10-27T12:00:00Z" }),
    entry({
      vessel_id: "future",
      position_at: "2026-10-27T13:00:00Z",
      received_at: "2026-10-27T13:00:00Z",
    }),
    entry({ vessel_id: "course", course_deg: 360 }),
    entry({ vessel_id: "speed", speed_kn: -1 }),
  ];
  const snapshot = parsePositionsResponse(body([entry(), ...invalid]));
  assert.deepEqual(
    snapshot.positions.map((p) => p.vesselId),
    ["calypso"],
  );
  assert.deepEqual(
    snapshot.unavailable,
    invalid.map((item) => ({ vesselId: item.vessel_id, reason: "invalid" })),
  );
});

test("a malformed response is rejected as a whole, so the last good data is kept", () => {
  for (const malformed of [
    null,
    [],
    {},
    { evaluated_at: EVALUATED_AT, positions: [] },
    { evaluated_at: "2026-10-27T12:04:10", positions: [], unavailable: [] },
    { positions: [], unavailable: [] },
  ])
    assert.throws(() => parsePositionsResponse(malformed), /Malformed positions response/);
});

test("unavailable vessels keep the backend's reason; each vessel is listed once", () => {
  const snapshot = parsePositionsResponse(
    body(
      [entry()],
      [
        { vessel_id: "iron-horizon", reason: "NO_ROUTE" },
        { vessel_id: "northern-star", reason: "NO_REPORT" },
        { vessel_id: "mystery", reason: "SOMETHING_NEW" },
        { vessel_id: "calypso", reason: "NO_ROUTE" },
        { reason: "NO_ROUTE" },
      ],
    ),
  );
  assert.deepEqual(
    snapshot.positions.map((p) => p.vesselId),
    ["calypso"],
  );
  assert.deepEqual(snapshot.unavailable, [
    { vesselId: "iron-horizon", reason: "no-route" },
    { vesselId: "northern-star", reason: "no-report" },
    { vesselId: "mystery", reason: "invalid" },
  ]);
});

// --- Security status and contact stay separate --------------------------------------------------------------------

test("marker colour is the security status; contact is shown by shape and label", () => {
  assert.deepEqual(markerStyle("critical", "current"), {
    securityState: "critical",
    outline: "solid",
    label: null,
  });
  assert.deepEqual(markerStyle("secure", "lost"), {
    securityState: "secure",
    outline: "hollow",
    label: "LOST",
  });
  assert.deepEqual(markerStyle("warning", "stale"), {
    securityState: "warning",
    outline: "dashed",
    label: "STALE",
  });
  // A critical vessel that is reporting and a secure vessel that is lost keep their own colours.
  assert.equal(markerStyle("critical", "current").securityState, "critical");
  assert.equal(markerStyle("secure", "lost").securityState, "secure");
});

// --- Rows, empty and unavailable states ---------------------------------------------------------------------------

test("rows join store vessels with positions; vessels without one keep their reason", () => {
  const snapshot = parsePositionsResponse(
    body(
      [entry(), entry({ vessel_id: "only-in-api" })],
      [{ vessel_id: "iron-horizon", reason: "NO_ROUTE" }],
    ),
  );
  const rows = buildMapRows(
    [
      vessel("calypso", { securityState: "critical" }),
      vessel("iron-horizon"),
      vessel("not-in-api"),
    ],
    snapshot,
  );
  assert.deepEqual(
    rows.map((row) => [row.id, row.securityState, row.position?.vesselId ?? null, row.unavailable]),
    [
      ["calypso", "critical", "calypso", null],
      ["iron-horizon", "secure", null, "no-route"],
      ["not-in-api", "secure", null, "not-listed"],
      ["only-in-api", "unknown", "only-in-api", null],
    ],
  );
});

test("an empty fleet gives no rows, and no data yet gives no markers", () => {
  assert.deepEqual(buildMapRows([], parsePositionsResponse(body([], []))), []);
  const rows = buildMapRows([vessel("calypso")], null);
  assert.deepEqual(
    rows.map((row) => [row.position, row.unavailable]),
    [[null, "not-listed"]],
  );
  assert.deepEqual(fleetCounts(rows), { total: 1, current: 0, stale: 0, lost: 0, unavailable: 1 });
});

test("filters hide rows but fleet counts cover the whole fleet", () => {
  const snapshot = parsePositionsResponse(
    body(
      [
        entry(),
        entry({ vessel_id: "b", freshness: "STALE" }),
        entry({ vessel_id: "c", freshness: "LOST" }),
      ],
      [{ vessel_id: "d", reason: "NO_REPORT" }],
    ),
  );
  const rows = buildMapRows(
    [
      vessel("calypso", { securityState: "critical", incidentSeverity: "high", openIncidents: 2 }),
      vessel("b"),
      vessel("c"),
      vessel("d"),
    ],
    snapshot,
  );
  assert.deepEqual(fleetCounts(rows), { total: 4, current: 1, stale: 1, lost: 1, unavailable: 1 });
  const ids = (filters) => filterRows(rows, { ...NO_FILTERS, ...filters }).map((row) => row.id);
  assert.deepEqual(ids({}), ["calypso", "b", "c", "d"]);
  assert.deepEqual(ids({ freshness: ["lost", "stale"] }), ["b", "c"]);
  assert.deepEqual(ids({ securityStates: ["critical"] }), ["calypso"]);
  assert.deepEqual(ids({ incidentSeverities: ["high"] }), ["calypso"]);
  assert.deepEqual(ids({ query: "mv c" }), ["calypso", "c"]);
  assert.deepEqual(ids({ query: "IMO 1000000" }), ["b", "c", "d"]);
});

// --- Failed refreshes and polling ---------------------------------------------------------------------------------

test("a failed refresh keeps the last positions and marks them unavailable", () => {
  const snapshot = parsePositionsResponse(body());
  const live = feedAfterSuccess(INITIAL_FEED, snapshot);
  assert.deepEqual(live, { snapshot, status: "live", error: null });
  const failed = feedAfterFailure(live, new Error("API request failed (503)"));
  assert.equal(failed.snapshot, snapshot);
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.error, "API request failed (503)");
  // Without earlier data nothing is invented.
  assert.deepEqual(feedAfterFailure(INITIAL_FEED, "offline"), {
    snapshot: null,
    status: "unavailable",
    error: "offline",
  });
  // Recovery replaces the cached positions only with a successful response.
  const newer = parsePositionsResponse({ ...body(), evaluated_at: "2026-10-27T12:05:10Z" });
  assert.equal(feedAfterSuccess(failed, newer).snapshot, newer);
});

function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    pending,
    set: (callback, ms) => {
      const handle = next++;
      pending.set(handle, { callback, ms });
      return handle;
    },
    clear: (handle) => pending.delete(handle),
    fire() {
      const [handle, { callback }] = [...pending][0];
      pending.delete(handle);
      callback();
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("polling loads at once, then 60 s after each load settles, so requests never overlap", async () => {
  const timers = fakeTimers();
  const releases = [];
  let loads = 0;
  const outcomes = [];
  const stop = startPositionPolling({
    load: () => {
      loads += 1;
      return new Promise((resolve, reject) => releases.push({ resolve, reject }));
    },
    onSuccess: (snapshot) => outcomes.push(["ok", snapshot]),
    onFailure: (cause) => outcomes.push(["failed", cause]),
    timers,
  });
  assert.equal(loads, 1);
  await settle();
  assert.equal(timers.pending.size, 0, "no next poll is scheduled while a request is in flight");

  releases[0].resolve("first");
  await settle();
  assert.deepEqual(outcomes, [["ok", "first"]]);
  assert.deepEqual(
    [...timers.pending.values()].map((t) => t.ms),
    [60_000],
  );

  timers.fire();
  assert.equal(loads, 2);
  releases[1].reject(new Error("down"));
  await settle();
  assert.equal(outcomes[1][0], "failed");
  assert.equal(timers.pending.size, 1, "polling continues after a failure");
  stop();
});

test("stopping polling clears the timer and ignores a request still in flight", async () => {
  const timers = fakeTimers();
  let release;
  const outcomes = [];
  const stop = startPositionPolling({
    load: () => new Promise((resolve) => (release = resolve)),
    onSuccess: (snapshot) => outcomes.push(snapshot),
    onFailure: (cause) => outcomes.push(cause),
    timers,
  });
  stop();
  release("late");
  await settle();
  assert.deepEqual(outcomes, []);
  assert.equal(timers.pending.size, 0);
});

// --- Zoom and pan -------------------------------------------------------------------------------------------------

test("zoom stays within 1x to 8x and panning within the world outline", () => {
  assert.deepEqual(clampView({ k: 20, x: 50, y: 50 }, 960, 500), { k: MAX_ZOOM, x: 0, y: 0 });
  assert.deepEqual(clampView({ k: 0.5, x: -10, y: -10 }, 960, 500), WORLD_VIEW);
  assert.deepEqual(clampView({ k: 2, x: -5000, y: -5000 }, 960, 500), { k: 2, x: -960, y: -500 });
});

test("zooming keeps the point under the cursor fixed", () => {
  const view = zoomAt(WORLD_VIEW, 2, 300, 200, 960, 500);
  assert.equal(view.k, 2);
  assert.equal(300 * view.k + view.x, 300);
  assert.equal(200 * view.k + view.y, 200);
});

test("fit-to-fleet frames the vessels with padding, capped at 8x", () => {
  assert.deepEqual(fitPoints([], 960, 500), WORLD_VIEW);
  assert.equal(fitPoints([[480, 250]], 960, 500).k, MAX_ZOOM);
  const view = fitPoints(
    [
      [100, 100],
      [340, 220],
    ],
    960,
    500,
  );
  assert.equal(view.k, 960 / (240 * 1.2));
  const centre = [(100 + 340) / 2, (100 + 220) / 2];
  assert.deepEqual([centre[0] * view.k + view.x, centre[1] * view.k + view.y], [480, 250]);
  assert.deepEqual(centerOn([480, 250], 1, 960, 500), WORLD_VIEW);
});
