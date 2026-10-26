// Run with: npm run test:unit
// Failed writes were swallowed: an optimistic incident change or acknowledgement stayed on screen until the
// next refresh silently removed it, a failed incident creation closed the form and lost the input, and a write
// that succeeded but whose follow-up refresh failed was treated as failed.
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

const INCIDENT = {
  id: "INC-0241",
  ref: "INC-0241",
  title: "Potential Physical Security Breach",
  vesselId: "calypso",
  system: "Potential Physical Security Breach",
  severity: "high",
  status: "investigating",
  assignee: "J. Dawson",
  openedAt: 0,
  updatedAt: 0,
  eventIds: [],
  notes: [],
  timeline: [],
};
const EVENT = {
  id: "evt-1",
  ts: 0,
  vesselId: "calypso",
  category: "access",
  severity: "high",
  title: "Unauthorized access",
  detail: "Simulated",
  source: "Access Control",
  acknowledged: false,
};

/** Routes each request: writes get `write`, the follow-up refresh GETs get `read`. */
function backend({ write, read }) {
  globalThis.fetch = async (url, options = {}) => {
    const respond = (options.method ?? "GET") === "GET" ? read : write;
    return respond(String(url));
  };
}
const unreachable = () => {
  throw new TypeError("fetch failed");
};
const rejected = (status, detail) => () =>
  new Response(JSON.stringify({ detail }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const accepted = (body) => () =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const incident = () => store.getState().incidents.find((item) => item.id === INCIDENT.id);
const lastToast = () => toast.getHistory().at(-1);

beforeEach(() => {
  store.resetSimulation();
  store.hydrateFromBackend({
    health: "ok",
    incidents: [structuredClone(INCIDENT)],
    events: [{ ...EVENT }],
  });
  toast.dismiss();
});

test("a rejected status change is rolled back and shown with the backend's reason", async () => {
  backend({ write: rejected(409, "Invalid incident status transition"), read: unreachable });
  const historyBefore = toast.getHistory().length;

  const saved = await services.incidentService.setStatus(INCIDENT.id, "closed");

  assert.equal(saved, false);
  assert.equal(incident().status, "investigating");
  assert.equal(toast.getHistory().length, historyBefore + 1);
  assert.equal(lastToast().title, "Update incident status failed");
  assert.equal(
    lastToast().description,
    "Invalid incident status transition. The change was not saved.",
  );
  assert.equal(lastToast().type, "error");
});

test("an acknowledgement that cannot reach the backend is rolled back and shown", async () => {
  backend({ write: unreachable, read: unreachable });

  assert.equal(await services.eventService.acknowledge(EVENT.id), false);

  assert.equal(store.getState().events.find((event) => event.id === EVENT.id).acknowledged, false);
  assert.equal(lastToast().title, "Acknowledge event failed");
  assert.equal(
    lastToast().description,
    "The backend could not be reached. The change was not saved.",
  );
});

test("a rejected note and a rejected severity change are rolled back", async () => {
  backend({ write: rejected(404, "Incident not found"), read: unreachable });

  assert.equal(
    await services.incidentService.addNote(INCIDENT.id, "Checked CCTV.", "Officer"),
    false,
  );
  assert.equal(await services.incidentService.update(INCIDENT.id, { severity: "critical" }), false);

  assert.deepEqual(incident(), INCIDENT);
  assert.equal(lastToast().title, "Update incident failed");
});

test("a failed incident creation adds nothing and is shown", async () => {
  backend({ write: rejected(404, "Vessel not found"), read: unreachable });
  const before = store.getState().incidents.length;

  const saved = await services.incidentService.create({
    title: "Door forced",
    vesselId: "calypso",
    system: "Access Control",
    severity: "high",
    assignee: "Officer",
  });

  assert.equal(saved, false);
  assert.equal(store.getState().incidents.length, before);
  assert.equal(lastToast().description, "Vessel not found. The change was not saved.");
});

test("a write that succeeded is kept even when the follow-up refresh fails", async () => {
  backend({ write: accepted({ incident_id: INCIDENT.id }), read: unreachable });
  const historyBefore = toast.getHistory().length;

  const saved = await services.incidentService.setStatus(INCIDENT.id, "contained");

  assert.equal(saved, true);
  assert.equal(incident().status, "contained");
  assert.equal(toast.getHistory().length, historyBefore);
  assert.equal(store.getState().connection.backend, "degraded");
});

test("failed simulation actions are shown instead of being lost", async () => {
  backend({ write: rejected(404, "Vessel not found"), read: unreachable });

  assert.equal(await services.simulationService.trigger("fire-alarm", "calypso"), null);
  assert.equal(lastToast().title, "Run scenario failed");
  assert.equal(await services.simulationService.reset(), false);
  assert.equal(lastToast().title, "Reset simulation failed");
});
