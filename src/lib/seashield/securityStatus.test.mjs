// Run with: npm run test:unit
// The backend owns vessel security status; the UI used to recompute it from the score with its own
// thresholds, so the API and the screen could disagree (score 85: API SECURE, UI "elevated").
import assert from "node:assert/strict";
import { test } from "node:test";

import { fleetSecurityState, securityStateFromApi, summaryAverage } from "./securityStatus.ts";

test("shows the status the backend sent", () => {
  assert.equal(securityStateFromApi("SECURE"), "secure");
  assert.equal(securityStateFromApi("ELEVATED"), "elevated");
  assert.equal(securityStateFromApi("WARNING"), "warning");
  assert.equal(securityStateFromApi("CRITICAL"), "critical");
});

test("never shows a missing or unrecognised status as secure", () => {
  for (const status of [undefined, null, "", "   ", "BOGUS", "OK"]) {
    assert.equal(securityStateFromApi(status), "unknown", String(status));
  }
});

test("fleet status is the most severe vessel status", () => {
  assert.equal(fleetSecurityState(["secure", "elevated", "secure"]), "elevated");
  assert.equal(fleetSecurityState(["secure", "warning", "elevated"]), "warning");
  assert.equal(fleetSecurityState(["warning", "critical", "unknown"]), "critical");
  assert.equal(fleetSecurityState(["secure", "unknown", "warning"]), "unknown");
  assert.equal(fleetSecurityState(["secure", "secure"]), "secure");
});

const vessel = (securityScore, securityState) => ({ securityScore, securityState });

test("the fleet average is coloured by the backend's classification of the average, not the worst vessel", () => {
  const fleet = [vessel(95, "secure"), vessel(95, "secure"), vessel(40, "critical")];
  const fromBackend = { score: 77, state: "elevated" };
  assert.deepEqual(summaryAverage(fleet, false, fromBackend), fromBackend);
  assert.equal(fleetSecurityState(fleet.map((v) => v.securityState)), "critical");
});

test("a selected vessel's average is its own score and backend status", () => {
  assert.deepEqual(summaryAverage([vessel(58, "warning")], true, { score: 90, state: "secure" }), {
    score: 58,
    state: "warning",
  });
});

test("without backend data the average is shown but not classified", () => {
  assert.deepEqual(summaryAverage([vessel(90, "secure"), vessel(81, "elevated")], false, null), {
    score: 86,
    state: "unknown",
  });
  assert.deepEqual(summaryAverage([], false, null), { score: 0, state: "unknown" });
});
