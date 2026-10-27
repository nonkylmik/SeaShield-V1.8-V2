// Run with: npm run test:unit
// The simulation console log must come from the backend's record of what the simulation did
// (GET /api/v1/simulation/log), refreshed with the rest of the backend state.
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

/** Serves a healthy backend; `simulationLog === null` makes only the log endpoint fail. */
function serve(simulationLog, { incidents = [] } = {}) {
  const responses = {
    "/health": { status: "ok" },
    "/api/v1/vessels": [
      { id: "calypso", name: "MV Calypso", imo: "IMO 9751028", score: 72, status: "ELEVATED" },
    ],
    "/api/v1/fleet/security-summary": {
      vessel_count: 1,
      average_score: 72,
      average_status: "ELEVATED",
    },
    "/api/v1/cameras": [],
    "/api/security-events": [],
    "/api/v1/incidents": incidents,
    "/api/v1/safety-rounds": [],
    "/api/v1/safety-findings": [],
    "/api/v1/simulation/log": simulationLog,
  };
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/v1/simulation/log" && simulationLog === null) {
      return new Response(JSON.stringify({ detail: "Internal Server Error" }), { status: 500 });
    }
    return new Response(JSON.stringify(responses[path]), { status: 200 });
  };
}

test("the console log is what the backend recorded", async () => {
  store.resetSimulation();
  serve([
    {
      event_id: "evt-2",
      timestamp: "2026-10-26T10:00:05Z",
      vessel_id: "calypso",
      event_type: "CAMERA_OFFLINE",
      severity: "MEDIUM",
      status: "OPEN",
      scenario: "manual-injection",
      scenario_label: "Manual injection",
      incident_ids: ["INC-0241"],
    },
  ]);

  await backend.refreshSeaShieldBackend();

  assert.deepEqual(store.getState().simLog, [
    {
      id: "evt-2",
      ts: Date.UTC(2026, 9, 26, 10, 0, 5),
      scenario: "Manual injection",
      vesselId: "calypso",
      outcome: "MV Calypso · CAMERA OFFLINE (medium) → INC-0241",
    },
  ]);
});

test("an empty backend log shows no entries rather than local ones", async () => {
  store.resetSimulation();
  serve([]);

  await backend.refreshSeaShieldBackend();

  assert.deepEqual(store.getState().simLog, []);
});

const LOGGED = {
  event_id: "evt-2",
  timestamp: "2026-10-26T10:00:05Z",
  vessel_id: "calypso",
  event_type: "CAMERA_OFFLINE",
  severity: "MEDIUM",
  status: "OPEN",
  scenario: "manual-injection",
  scenario_label: "Manual injection",
  incident_ids: ["INC-0241"],
};
const INCIDENT = {
  incident_id: "INC-0241",
  vessel_id: "calypso",
  title: "Potential Physical Security Breach",
  type: "Potential Physical Security Breach",
  severity: "HIGH",
  status: "INVESTIGATING",
  created_at: "2026-10-26T10:00:05Z",
  updated_at: "2026-10-26T10:00:05Z",
};

test("a failing log endpoint does not stop the rest of the backend data refreshing", async () => {
  store.resetSimulation();
  serve(null, { incidents: [INCIDENT] });

  await backend.refreshSeaShieldBackend();

  const state = store.getState();
  assert.equal(state.dataSource, "backend");
  assert.deepEqual(
    state.vessels.map((vessel) => [vessel.id, vessel.securityState]),
    [["calypso", "elevated"]],
  );
  assert.deepEqual(
    state.incidents.map((incident) => [incident.id, incident.status]),
    [["INC-0241", "investigating"]],
  );
  assert.equal(state.connection.backend, "online");
  assert.equal(state.simLogAvailable, false);
  assert.deepEqual(state.simLog, []);
});

test("the last log received is kept while the log is unavailable, and replaced once it recovers", async () => {
  store.resetSimulation();
  serve([LOGGED]);
  await backend.refreshSeaShieldBackend();
  const received = store.getState().simLog;
  assert.equal(received.length, 1);

  serve(null);
  await backend.refreshSeaShieldBackend();
  assert.equal(store.getState().simLogAvailable, false);
  assert.deepEqual(store.getState().simLog, received);

  serve([]);
  await backend.refreshSeaShieldBackend();
  assert.equal(store.getState().simLogAvailable, true);
  assert.deepEqual(store.getState().simLog, []);
});
