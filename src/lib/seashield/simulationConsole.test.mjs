// Run with: npm run test:unit
// The dashboard simulation console, rendered with its real dialogs against a stubbed backend. Before this:
// - the start dialog kept the plan it opened with, so a scenario another operator started while it was open was
//   replaced without the replacement warning;
// - a second click in the same tick, though refused, cleared the in-progress state of the request still running, so
//   the controls were enabled again mid-request;
// - Reset was enabled while the simulation status was still loading or unknown.
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createServer } from "vite";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  pretendToBeVisual: true,
});
for (const key of [
  "window",
  "document",
  "Node",
  "Element",
  "HTMLElement",
  "DocumentFragment",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
])
  globalThis[key] = key === "window" ? dom.window : dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

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
const { SimulationConsole } = await vite.ssrLoadModule(
  "/src/components/seashield/SimulationConsole.tsx",
);

const SCENARIOS = [
  {
    key: "cyber-intrusion",
    label: "Cyber Intrusion Simulation",
    vessel_id: "calypso",
    vessel_name: "MV Calypso",
    step_count: 5,
  },
  {
    key: "fire-emergency",
    label: "Fire Emergency Simulation",
    vessel_id: "northern-star",
    vessel_name: "MV Northern Star",
    step_count: 3,
  },
];
let simulationStatus;
let write;
let writes;

/** A healthy backend; GET /simulation/status answers `simulationStatus`, writes are answered by `write`. */
function serve() {
  writes = [];
  const reads = {
    "/health": { status: "ok" },
    "/api/v1/vessels": [
      { id: "calypso", name: "MV Calypso", imo: "IMO 9751028", score: 92, status: "SECURE" },
      {
        id: "northern-star",
        name: "MV Northern Star",
        imo: "IMO 9410283",
        score: 94,
        status: "SECURE",
      },
    ],
    "/api/v1/fleet/security-summary": {
      vessel_count: 2,
      average_score: 93,
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
    if (method !== "GET") {
      writes.push({ path, body: options.body ? JSON.parse(options.body) : null });
      return write(path);
    }
    const body = path === "/api/v1/simulation/status" ? simulationStatus : reads[path];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const container = document.getElementById("root");
let reactRoot;
async function mount() {
  await act(async () => {
    reactRoot = createRoot(container);
    reactRoot.render(createElement(SimulationConsole));
  });
}
async function refresh() {
  await act(async () => {
    await backend.refreshSeaShieldBackend();
  });
}
const scenarioSection = () => container.querySelector('section[aria-label="Scripted scenario"]');
const buttonIn = (scope, text) =>
  [...scope.querySelectorAll("button")].find((button) => button.textContent.includes(text));
const resetButton = () =>
  [...container.querySelectorAll("button")].find((button) =>
    /Reset…|Resetting…/.test(button.textContent),
  );
const dialog = () => document.querySelector("[role=alertdialog]");
const dialogButton = (text) =>
  [...(dialog()?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent.trim() === text,
  );
async function click(element) {
  await act(async () => {
    element.click();
  });
}
async function chooseScenario(key) {
  await act(async () => {
    const select = scenarioSection().querySelector("select");
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(
      select,
      key,
    );
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

beforeEach(async () => {
  store.resetSimulation();
  simulationStatus = { scenario: null, status: "IDLE", index: 0 };
  write = () => json(200, {});
  serve();
  await backend.refreshSeaShieldBackend();
  writes = [];
});
afterEach(async () => {
  await act(async () => reactRoot?.unmount());
  reactRoot = undefined;
});

test("the start dialog warns about a scenario another operator starts while it is open", async () => {
  await mount();
  await chooseScenario("fire-emergency");
  await click(buttonIn(scenarioSection(), "Start…"));
  assert.match(dialog().textContent, /Start a simulated scenario\?/);
  assert.doesNotMatch(dialog().textContent, /This replaces/);

  // Another operator starts a scenario; this page learns of it through its ordinary refresh.
  simulationStatus = { scenario: "cyber-intrusion", status: "RUNNING", index: 2 };
  await refresh();

  assert.match(dialog().textContent, /Replace the active scenario\?/);
  assert.match(
    dialog().textContent,
    /This replaces Cyber Intrusion Simulation, which is running at step 2 of 5\./,
  );
  assert.ok(dialogButton("Replace and start"), "the confirm button names the replacement");

  write = () => json(200, { status: "RUNNING", result: null });
  await click(dialogButton("Replace and start"));
  assert.deepEqual(writes, [
    { path: "/api/v1/simulation/start", body: { scenario: "fire-emergency" } },
  ]);
});

test("the start dialog cannot be confirmed while the simulation status is unknown", async () => {
  await mount();
  await chooseScenario("fire-emergency");
  await click(buttonIn(scenarioSection(), "Start…"));
  simulationStatus = { scenario: null, status: "NOT_A_STATUS", index: 0 };
  await refresh();

  const confirm = dialogButton("Start scenario");
  assert.equal(confirm.disabled, true);
  assert.match(dialog().textContent, /status is not known/);
  await click(confirm);
  assert.deepEqual(writes, []);
});

test("controls stay disabled until the original request settles; a repeated click sends nothing", async () => {
  simulationStatus = { scenario: "cyber-intrusion", status: "RUNNING", index: 1 };
  await refresh();
  await mount();
  let release;
  write = () =>
    new Promise((resolve) => {
      release = () => resolve(json(200, null));
    });

  const next = buttonIn(scenarioSection(), "Next step");
  await act(async () => {
    next.click();
    next.click(); // same tick: before React has re-rendered the button as disabled
  });

  const inFlight = buttonIn(scenarioSection(), "Running step…");
  assert.ok(inFlight, "the in-progress label stays while the first request runs");
  assert.equal(inFlight.disabled, true);
  assert.equal(buttonIn(scenarioSection(), "Start…").disabled, true);
  assert.equal(buttonIn(scenarioSection(), "Stop").disabled, true);
  assert.equal(resetButton().disabled, true);
  assert.equal(writes.length, 1);

  await act(async () => {
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.equal(buttonIn(scenarioSection(), "Next step").disabled, false);
  assert.equal(writes.length, 1);
  assert.match(scenarioSection().textContent, /No step ran: no scenario is running\./);
});

test("Reset is disabled while the simulation status is loading or unknown", async () => {
  store.resetSimulation(); // no backend data yet; the seed state reports the backend as online
  await mount();
  assert.match(scenarioSection().textContent, /Loading simulation status…/);
  assert.equal(resetButton().disabled, true);

  simulationStatus = { scenario: null, status: "NOT_A_STATUS", index: 0 };
  await refresh();
  assert.match(scenarioSection().textContent, /could not be read/);
  assert.equal(resetButton().disabled, true);

  simulationStatus = { scenario: null, status: "IDLE", index: 0 };
  await refresh();
  assert.match(scenarioSection().textContent, /No active scenario\./);
  assert.equal(resetButton().disabled, false);
});
