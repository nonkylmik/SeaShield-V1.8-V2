// Run with: npm run test:unit
// In backend mode the simulation console log stayed empty: it was only written by the old in-browser
// simulation. It now shows what the backend recorded (GET /api/v1/simulation/log).
import assert from "node:assert/strict";
import { test } from "node:test";

import { simulationLogOutcome } from "./simulationLog.ts";

const entry = (overrides = {}) => ({
  event_id: "evt-1",
  timestamp: "2026-10-26T10:00:00Z",
  vessel_id: "calypso",
  event_type: "CAMERA_OFFLINE",
  severity: "MEDIUM",
  status: "OPEN",
  scenario: "manual-injection",
  scenario_label: "Manual injection",
  incident_ids: [],
  ...overrides,
});

test("describes the recorded event", () => {
  assert.equal(simulationLogOutcome(entry(), "MV Calypso"), "MV Calypso · CAMERA OFFLINE (medium)");
});

test("names the incident the event was correlated into", () => {
  assert.equal(
    simulationLogOutcome(entry({ incident_ids: ["INC-0241"] }), "MV Calypso"),
    "MV Calypso · CAMERA OFFLINE (medium) → INC-0241",
  );
});

test("marks events resolved since, for example by a reset", () => {
  assert.equal(
    simulationLogOutcome(
      entry({ status: "RESOLVED", severity: "CRITICAL", event_type: "FIRE_ALARM" }),
      "MV Calypso",
    ),
    "MV Calypso · FIRE ALARM (critical) · resolved",
  );
});
