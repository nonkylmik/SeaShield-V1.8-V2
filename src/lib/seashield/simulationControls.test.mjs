// Run with: npm run test:unit
// The dashboard's scenario controls show the backend's scenarios and progress as received: invalid data is shown as
// unavailable (never guessed), controls are offered only for the states that allow them, replacing an active
// scenario is detected for confirmation, a null step response is not reported as a step, and the injection target
// is never a fallback vessel.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  consoleInjectionTarget,
  parseScenarios,
  parseSimulationStatus,
  scenarioControls,
  scenarioPanelView,
  startPlan,
  stepOutcome,
} from "./simulationControls.ts";

const SCENARIOS_API = [
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
    vessel_name: null,
    step_count: 3,
  },
];
const scenarios = parseScenarios(SCENARIOS_API);
const view = (status, overrides = {}) =>
  scenarioPanelView({ lastRefreshAt: 1, backend: "online", status, scenarios, ...overrides });

test("the status response is read as sent, and anything else is unavailable", () => {
  assert.deepEqual(
    parseSimulationStatus({ scenario: "cyber-intrusion", status: "RUNNING", index: 2 }),
    {
      scenario: "cyber-intrusion",
      state: "running",
      index: 2,
    },
  );
  assert.deepEqual(parseSimulationStatus({ scenario: null, status: "IDLE", index: 0 }), {
    scenario: null,
    state: "idle",
    index: 0,
  });
  for (const bad of [
    null,
    [],
    { scenario: null, status: "LIVE", index: 0 },
    { scenario: 1, status: "IDLE", index: 0 },
    { scenario: null, status: "IDLE", index: -1 },
    { scenario: null, status: "IDLE", index: 1.5 },
  ])
    assert.equal(parseSimulationStatus(bad), null, JSON.stringify(bad));
});

test("the scenario list is read as sent; a broken entry makes the whole list unavailable", () => {
  assert.deepEqual(scenarios[1], {
    key: "fire-emergency",
    label: "Fire Emergency Simulation",
    vesselId: "northern-star",
    vesselName: null,
    stepCount: 3,
  });
  assert.equal(parseScenarios({}), null);
  assert.equal(parseScenarios([...SCENARIOS_API, { ...SCENARIOS_API[0], step_count: 0 }]), null);
  assert.equal(parseScenarios([{ ...SCENARIOS_API[0], key: "" }]), null);
  assert.deepEqual(parseScenarios([]), []);
});

test("loading, unavailable, idle and scenario states", () => {
  assert.deepEqual(view(null, { lastRefreshAt: null }), { kind: "loading" });
  assert.equal(view(null, { lastRefreshAt: null, backend: "degraded" }).kind, "unavailable");
  assert.equal(view(null).kind, "unavailable");
  assert.deepEqual(view({ scenario: null, state: "idle", index: 0 }), { kind: "idle" });
  assert.deepEqual(view({ scenario: "cyber-intrusion", state: "running", index: 2 }), {
    kind: "scenario",
    state: "running",
    key: "cyber-intrusion",
    label: "Cyber Intrusion Simulation",
    vesselName: "MV Calypso",
    step: 2,
    stepCount: 5,
  });
  // A scenario the list does not hold keeps its key, with no invented step count.
  const unknown = view({ scenario: "retired", state: "complete", index: 4 });
  assert.equal(unknown.label, "retired");
  assert.equal(unknown.stepCount, null);
});

test("controls are offered only where the state allows them", () => {
  const offered = (status, backend = "online") =>
    scenarioControls(view(status, { backend }), backend, scenarios);
  assert.deepEqual(offered({ scenario: null, state: "idle", index: 0 }), {
    canStart: true,
    canNext: false,
    canStop: false,
  });
  assert.deepEqual(offered({ scenario: "cyber-intrusion", state: "running", index: 1 }), {
    canStart: true,
    canNext: true,
    canStop: true,
  });
  assert.deepEqual(offered({ scenario: "cyber-intrusion", state: "paused", index: 1 }), {
    canStart: true,
    canNext: false,
    canStop: true,
  });
  for (const state of ["stopped", "complete"])
    assert.deepEqual(offered({ scenario: "cyber-intrusion", state, index: 5 }), {
      canStart: true,
      canNext: false,
      canStop: false,
    });
  // Unknown status or an unreachable backend: nothing is offered.
  assert.deepEqual(scenarioControls(view(null), "online", scenarios), {
    canStart: false,
    canNext: false,
    canStop: false,
  });
  assert.deepEqual(
    offered({ scenario: "cyber-intrusion", state: "running", index: 1 }, "degraded"),
    { canStart: false, canNext: false, canStop: false },
  );
  assert.equal(
    scenarioControls(view({ scenario: null, state: "idle", index: 0 }), "online", null).canStart,
    false,
  );
});

test("starting while a scenario is running or paused is flagged as a replacement", () => {
  const running = view({ scenario: "cyber-intrusion", state: "running", index: 2 });
  assert.deepEqual(startPlan("fire-emergency", scenarios, running).replaces, {
    label: "Cyber Intrusion Simulation",
    step: 2,
    stepCount: 5,
    state: "running",
  });
  assert.equal(
    startPlan(
      "fire-emergency",
      scenarios,
      view({ scenario: "cyber-intrusion", state: "paused", index: 2 }),
    ).replaces.state,
    "paused",
  );
  for (const state of ["stopped", "complete"])
    assert.equal(
      startPlan("fire-emergency", scenarios, view({ scenario: "cyber-intrusion", state, index: 5 }))
        .replaces,
      null,
    );
  assert.equal(
    startPlan("fire-emergency", scenarios, view({ scenario: null, state: "idle", index: 0 }))
      .replaces,
    null,
  );
  assert.equal(startPlan("not-listed", scenarios, running), null);
});

test("a null step response is not reported as a step", () => {
  const names = (id) => ({ calypso: "MV Calypso" })[id] ?? id;
  assert.equal(stepOutcome(null, names), "No step ran: no scenario is running.");
  assert.equal(
    stepOutcome(
      { event: { event_type: "FAILED_AUTHENTICATION", vessel_id: "calypso" }, correlation: null },
      names,
    ),
    "Simulated step: FAILED AUTHENTICATION on MV Calypso",
  );
  assert.equal(
    stepOutcome(
      {
        event: { event_type: "SUSPICIOUS_TRAFFIC", vessel_id: "calypso" },
        correlation: { title: "Potential Network Intrusion" },
      },
      names,
    ),
    "Simulated step: SUSPICIOUS TRAFFIC on MV Calypso · correlated: Potential Network Intrusion",
  );
});

test("the injection target is the operator's choice or the top-bar selection, never a fallback vessel", () => {
  assert.equal(consoleInjectionTarget(null, "all"), "all");
  assert.equal(consoleInjectionTarget(null, "calypso"), "calypso");
  assert.equal(consoleInjectionTarget("northern-star", "calypso"), "northern-star");
  // Choosing the placeholder clears the target even when a vessel is selected in the top bar.
  assert.equal(consoleInjectionTarget("", "calypso"), "all");
});
