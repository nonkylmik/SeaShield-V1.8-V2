// Run with: npm run test:unit
// Operator actions through the service layer against a stubbed backend: a simulated injection is sent once, only for
// a valid backend vessel, with the API's reason on failure; "Start investigation" sends NEW → INVESTIGATING once, is
// refused for other statuses without a request, and is rolled back with the reason when the backend rejects it.
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
const services = await vite.ssrLoadModule("/src/lib/seashield/services.ts");

const VESSEL = {
  id: "calypso",
  name: "MV Calypso",
  imo: "IMO 9751028",
  score: 92,
  state: "secure",
  lastComms: null,
  simulatedRoute: null,
};
const incidentWith = (id, status, allowedStatuses) => ({
  id,
  ref: id,
  title: "Potential Network Intrusion",
  vesselId: "calypso",
  system: "Potential Network Intrusion",
  severity: "critical",
  status,
  assignee: "J. Dawson",
  openedAt: 0,
  updatedAt: 0,
  eventIds: [],
  notes: [],
  timeline: [],
  allowedStatuses,
  canReopen: false,
});
const NEW_INCIDENT = incidentWith("INC-0241", "open", ["investigating", "contained", "closed"]);
const CONTAINED = incidentWith("INC-0242", "contained", ["investigating", "closed"]);

/** Records every write; `write` answers it. Follow-up refresh reads fail (the write's outcome must not depend on them). */
let writes = [];
function backend(write) {
  writes = [];
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method ?? "GET";
    if (method === "GET") throw new TypeError("fetch failed");
    writes.push({
      method,
      path: new URL(String(url)).pathname,
      body: JSON.parse(options.body ?? "null"),
    });
    return write();
  };
}
const json = (status, body) => () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
/** A write that answers only when `release` is called, to observe the in-flight state. */
function held() {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return {
    respond: () => gate.then(() => json(200, { correlation: null })()),
    release: () => release(),
  };
}
const incident = (id) => store.getState().incidents.find((item) => item.id === id);

beforeEach(() => {
  store.resetSimulation();
  store.hydrateFromBackend({
    health: "ok",
    vessels: [VESSEL],
    incidents: [structuredClone(NEW_INCIDENT), structuredClone(CONTAINED)],
  });
  toast.dismiss();
});

test("an injection is sent once, for the confirmed vessel and its mapped backend event type", async () => {
  backend(json(200, { event: {}, correlation: null }));
  const result = await services.simulationService.inject("camera-failure", "calypso");
  assert.equal(result.status, "done");
  assert.match(result.message, /CAMERA OFFLINE injected/);
  assert.deepEqual(writes, [
    {
      method: "POST",
      path: "/api/v1/simulation/inject",
      body: { vessel_id: "calypso", event_type: "CAMERA_OFFLINE" },
    },
  ]);
  assert.equal(services.simulationService.eventType("camera-failure"), "CAMERA_OFFLINE");
});

test("a repeated injection while one is in flight sends nothing", async () => {
  const gate = held();
  backend(gate.respond);
  const first = services.simulationService.inject("fire-alarm", "calypso");
  assert.equal(services.simulationService.isInjecting(), true);
  assert.deepEqual(await services.simulationService.inject("fire-alarm", "calypso"), {
    status: "busy",
  });
  gate.release();
  assert.equal((await first).status, "done");
  assert.equal(writes.length, 1);
  assert.equal(services.simulationService.isInjecting(), false);
});

test("an injection for an invalid vessel or without backend data is refused without a request", async () => {
  backend(json(200, {}));
  for (const vesselId of ["all", "not-a-vessel"]) {
    const result = await services.simulationService.inject("camera-failure", vesselId);
    assert.equal(result.status, "not-allowed", vesselId);
  }
  store.resetSimulation(); // demo fixtures only
  const demo = await services.simulationService.inject("camera-failure", "vsl-08");
  assert.equal(demo.status, "not-allowed");
  assert.match(demo.message, /demo data/);
  assert.equal(writes.length, 0);
});

test("a rejected injection reports the API's reason", async () => {
  backend(json(404, { detail: "Vessel not found" }));
  const result = await services.simulationService.inject("camera-failure", "calypso");
  assert.deepEqual(result, {
    status: "failed",
    message: "Vessel not found. The change was not saved.",
  });
  assert.equal(toast.getHistory().at(-1).title, "Inject simulated event failed");
});

test("an injection that cannot reach the backend says so", async () => {
  backend(() => {
    throw new TypeError("fetch failed");
  });
  const result = await services.simulationService.inject("camera-failure", "calypso");
  assert.equal(result.status, "failed");
  assert.match(result.message, /could not be reached/);
});

test("Start investigation sends NEW → INVESTIGATING once, even when repeated while in flight", async () => {
  const gate = held();
  backend(gate.respond);
  const first = services.incidentService.startInvestigation("INC-0241");
  assert.equal(services.incidentService.isStartingInvestigation("INC-0241"), true);
  assert.equal((await services.incidentService.startInvestigation("INC-0241")).status, "busy");
  gate.release();
  const result = await first;
  assert.equal(result.status, "done");
  assert.equal(incident("INC-0241").status, "investigating");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "PATCH");
  assert.equal(writes[0].path, "/api/v1/incidents/INC-0241");
  assert.equal(writes[0].body.status, "INVESTIGATING");
});

test("Start investigation is refused for an incident that is not NEW, without a request", async () => {
  backend(json(200, {}));
  const result = await services.incidentService.startInvestigation("INC-0242");
  assert.equal(result.status, "not-allowed");
  assert.equal(incident("INC-0242").status, "contained");
  assert.equal(writes.length, 0);
});

test("a rejected Start investigation is rolled back and reports the backend's reason", async () => {
  backend(json(409, { detail: "Cannot change incident status from RESOLVED to INVESTIGATING" }));
  const result = await services.incidentService.startInvestigation("INC-0241");
  assert.deepEqual(result, {
    status: "failed",
    message:
      "Cannot change incident status from RESOLVED to INVESTIGATING. The change was not saved.",
  });
  assert.equal(incident("INC-0241").status, "open");
  assert.equal(toast.getHistory().at(-1).title, "Start investigation failed");
});
