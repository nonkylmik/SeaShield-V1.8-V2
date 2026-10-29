// Run with: npm run test:unit
// Scenario controls through the service layer against a stubbed backend: the refresh reads the backend's simulation
// status and scenario list; start, next step, stop and reset each send exactly one request, refuse repeats while one
// is in flight, show the backend's reason on failure without claiming nothing was saved, and re-read the backend
// afterwards.
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { toast } from "sonner";
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
const { simulationService } = await vite.ssrLoadModule("/src/lib/seashield/services.ts");

const SCENARIOS = [
  {
    key: "cyber-intrusion",
    label: "Cyber Intrusion Simulation",
    vessel_id: "calypso",
    vessel_name: "MV Calypso",
    step_count: 5,
  },
];
let simulationStatus;
let requests;
let write;

/** A healthy backend for reads; writes are answered by `write`. Every request is recorded in order. */
function serve() {
  requests = [];
  const reads = {
    "/health": { status: "ok" },
    "/api/v1/vessels": [
      { id: "calypso", name: "MV Calypso", imo: "IMO 9751028", score: 92, status: "SECURE" },
    ],
    "/api/v1/fleet/security-summary": {
      vessel_count: 1,
      average_score: 92,
      average_status: "SECURE",
    },
    "/api/v1/cameras": [],
    "/api/security-events": [],
    "/api/v1/incidents": [],
    "/api/v1/safety-rounds": [],
    "/api/v1/safety-findings": [],
    "/api/v1/simulation/log": [],
    "/api/v1/simulation/scenarios": SCENARIOS,
  };
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method ?? "GET";
    const path = new URL(String(url)).pathname;
    requests.push({ method, path, body: options.body ? JSON.parse(options.body) : null });
    if (method !== "GET") return write(path);
    const body = path === "/api/v1/simulation/status" ? simulationStatus : reads[path];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const writes = () => requests.filter((request) => request.method !== "GET");
const readsAfterLastWrite = () => {
  const last = requests.findLastIndex((request) => request.method !== "GET");
  return requests.slice(last + 1).map((request) => request.path);
};

beforeEach(async () => {
  store.resetSimulation();
  simulationStatus = { scenario: null, status: "IDLE", index: 0 };
  write = () => json(200, {});
  serve();
  await backend.refreshSeaShieldBackend();
  requests = [];
  toast.dismiss();
});

test("a refresh reads the backend's simulation status and scenario list", async () => {
  simulationStatus = { scenario: "cyber-intrusion", status: "RUNNING", index: 2 };
  await backend.refreshSeaShieldBackend();
  const state = store.getState();
  assert.deepEqual(state.simulationStatus, {
    scenario: "cyber-intrusion",
    state: "running",
    index: 2,
  });
  assert.equal(state.simulationScenarios[0].stepCount, 5);
});

test("an unreadable status is stored as unknown, not kept from before", async () => {
  simulationStatus = { scenario: null, status: "SOMETHING_ELSE", index: 0 };
  await backend.refreshSeaShieldBackend();
  assert.equal(store.getState().simulationStatus, null);
});

test("start sends the listed scenario once and re-reads the backend", async () => {
  write = () =>
    json(200, {
      status: "RUNNING",
      result: { event: { event_type: "UNKNOWN_DEVICE", vessel_id: "calypso" }, correlation: null },
    });
  const result = await simulationService.startScenario("cyber-intrusion");
  assert.deepEqual(result, {
    status: "done",
    message: "Started Cyber Intrusion Simulation. Simulated step: UNKNOWN DEVICE on MV Calypso",
  });
  assert.deepEqual(writes(), [
    { method: "POST", path: "/api/v1/simulation/start", body: { scenario: "cyber-intrusion" } },
  ]);
  assert.ok(readsAfterLastWrite().includes("/api/v1/simulation/status"));
});

test("a scenario the backend did not list is refused without a request", async () => {
  const result = await simulationService.startScenario("made-up");
  assert.equal(result.status, "not-allowed");
  assert.equal(writes().length, 0);
});

test("a control repeated while one is in flight sends nothing", async () => {
  let release;
  write = () =>
    new Promise((resolve) => {
      release = () => resolve(json(200, null));
    });
  const first = simulationService.nextStep();
  assert.equal(simulationService.isControlling(), true);
  assert.deepEqual(await simulationService.nextStep(), { status: "busy" });
  assert.deepEqual(await simulationService.stopScenario(), { status: "busy" });
  assert.deepEqual(await simulationService.resetConfirmed(), { status: "busy" });
  release();
  await first;
  assert.equal(writes().length, 1);
  assert.equal(simulationService.isControlling(), false);
});

test("a step with no running scenario is reported as no step", async () => {
  write = () => json(200, null);
  assert.deepEqual(await simulationService.nextStep(), {
    status: "done",
    message: "No step ran: no scenario is running.",
  });
  assert.deepEqual(writes(), [{ method: "POST", path: "/api/v1/simulation/next", body: null }]);
});

test("a failed step shows the backend's reason, does not claim nothing changed, and re-reads the backend", async () => {
  write = () => json(500, { detail: "Internal Server Error" });
  const result = await simulationService.nextStep();
  assert.deepEqual(result, {
    status: "failed",
    message: "Internal Server Error. The status shown is re-read from the backend.",
  });
  assert.doesNotMatch(result.message, /not saved/);
  assert.ok(readsAfterLastWrite().includes("/api/v1/simulation/status"));
  const shown = toast.getHistory().at(-1);
  assert.equal(shown.title, "Run next step failed");
  assert.equal(shown.type, "error");
});

test("a control that cannot reach the backend says so", async () => {
  write = () => {
    throw new TypeError("fetch failed");
  };
  const result = await simulationService.stopScenario();
  assert.equal(result.status, "failed");
  assert.match(result.message, /^The backend could not be reached\./);
});

test("stop and reset each send one request to their endpoint", async () => {
  assert.equal((await simulationService.stopScenario()).status, "done");
  const reset = await simulationService.resetConfirmed();
  assert.equal(reset.status, "done");
  assert.match(reset.message, /open incidents closed across the fleet/);
  assert.deepEqual(
    writes().map((request) => request.path),
    ["/api/v1/simulation/stop", "/api/v1/simulation/reset"],
  );
});
