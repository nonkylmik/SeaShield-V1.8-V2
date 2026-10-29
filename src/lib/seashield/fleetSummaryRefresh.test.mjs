// Run with: npm run test:unit
// The /map fleet summary reads the backend's vessel count (GET /api/v1/fleet/security-summary), previously dropped,
// and the time of the last full refresh. A refresh that fails keeps that time, so the strip shows the figures as not
// live instead of as current.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const vite = await createServer({
  root,
  configFile: false,
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, watch: null },
  resolve: { alias: { "@": `${root}src` } },
});
after(() => vite.close());
const store = await vite.ssrLoadModule("/src/lib/seashield/store.ts");
const backend = await vite.ssrLoadModule("/src/lib/seashield/backend.ts");
const { fleetSummaryView, LOADED_EVENT_LIMIT } = await vite.ssrLoadModule(
  "/src/lib/seashield/mapOverview.ts",
);

const requested = [];

function serve({ summary, healthy = true }) {
  const responses = {
    "/health": { status: "ok" },
    "/api/v1/vessels": [
      { id: "calypso", name: "MV Calypso", imo: "IMO 9751028", score: 50, status: "CRITICAL" },
      {
        id: "northern-star",
        name: "MV Northern Star",
        imo: "IMO 9410283",
        score: 94,
        status: "SECURE",
      },
    ],
    "/api/v1/fleet/security-summary": summary,
    "/api/v1/cameras": [],
    "/api/security-events": [],
    "/api/v1/incidents": [
      {
        incident_id: "INC-0241",
        vessel_id: "calypso",
        type: "Potential Network Intrusion",
        title: "Potential Network Intrusion",
        severity: "CRITICAL",
        status: "NEW",
        created_at: "2026-10-29T10:00:00Z",
        updated_at: "2026-10-29T10:00:00Z",
        related_event_ids: ["evt-1", "evt-2", "evt-3"],
      },
    ],
    "/api/v1/safety-rounds": [],
    "/api/v1/safety-findings": [],
    "/api/v1/simulation/log": [],
  };
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    requested.push(parsed.pathname + parsed.search);
    if (!healthy) throw new TypeError("fetch failed");
    return new Response(JSON.stringify(responses[parsed.pathname]), { status: 200 });
  };
}

const viewOf = (state) =>
  fleetSummaryView({
    lastRefreshAt: state.lastRefreshAt,
    backend: state.connection.backend,
    vesselCount: state.fleetVesselCount,
    average: state.fleetAverage,
    vessels: state.vessels,
    incidents: state.incidents,
  });

test("before any refresh there is no vessel count and no refresh time", () => {
  store.resetSimulation();
  const state = store.getState();
  assert.equal(state.fleetVesselCount, null);
  assert.equal(state.lastRefreshAt, null);
  assert.deepEqual(viewOf(state), { kind: "loading" });
});

test("a refresh keeps the summary's vessel count and records when the data arrived", async () => {
  store.resetSimulation();
  serve({ summary: { vessel_count: 2, average_score: 72, average_status: "ELEVATED" } });
  const before = Date.now();
  await backend.refreshSeaShieldBackend();
  const state = store.getState();
  assert.equal(state.fleetVesselCount, 2);
  assert.ok(state.lastRefreshAt >= before && state.lastRefreshAt <= Date.now());

  const view = viewOf(state);
  assert.equal(view.kind, "summary");
  assert.equal(view.vesselCount, 2);
  assert.deepEqual(view.average, { score: 72, state: "elevated" });
  assert.equal(view.vesselsByState.critical, 1);
  assert.equal(view.vesselsByState.secure, 1);
  assert.deepEqual(view.openBySeverity, { critical: 1, high: 0, medium: 0, low: 0, info: 0 });
  assert.equal(view.live, true);
  // The evidence text names the same window the refresh loads.
  assert.ok(requested.includes(`/api/security-events?limit=${LOADED_EVENT_LIMIT}`));
});

test("a failed refresh keeps the last figures and their time, marked not live", async () => {
  store.resetSimulation();
  serve({ summary: { vessel_count: 2, average_score: 72, average_status: "ELEVATED" } });
  await backend.refreshSeaShieldBackend();
  const receivedAt = store.getState().lastRefreshAt;

  serve({ summary: null, healthy: false });
  await assert.rejects(backend.refreshSeaShieldBackend());
  // What the WebSocket and write paths do when a refresh fails.
  store.hydrateFromBackend({ health: "degraded" });

  const state = store.getState();
  assert.equal(state.lastRefreshAt, receivedAt);
  assert.equal(state.fleetVesselCount, 2);
  const view = viewOf(state);
  assert.equal(view.kind, "summary");
  assert.equal(view.live, false);
  assert.equal(view.asOf, receivedAt);
});

test("a fleet the backend reports as empty is shown as empty", async () => {
  store.resetSimulation();
  serve({ summary: { vessel_count: 0, average_score: null, average_status: null } });
  await backend.refreshSeaShieldBackend();
  assert.equal(viewOf(store.getState()).kind, "empty");
});

test("an unusable vessel count is stored as unknown, not as a number", async () => {
  store.resetSimulation();
  serve({ summary: { vessel_count: -1, average_score: 72, average_status: "ELEVATED" } });
  await backend.refreshSeaShieldBackend();
  assert.equal(store.getState().fleetVesselCount, null);
});

test("without any backend data the summary is unavailable, not the demo fixtures", async () => {
  store.resetSimulation();
  serve({ summary: null, healthy: false });
  await assert.rejects(backend.refreshSeaShieldBackend());
  store.hydrateFromBackend({ health: "degraded" });
  assert.deepEqual(viewOf(store.getState()), { kind: "unavailable" });
});
