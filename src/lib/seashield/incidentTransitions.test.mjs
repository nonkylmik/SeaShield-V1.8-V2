// Run with: npm run test:unit
// The status selector offered every status, including changes the backend now refuses (e.g. back to "open"
// or out of "closed"); it now offers only the transitions the backend lists for the incident.
import assert from "node:assert/strict";
import { test } from "node:test";

import { statusOptions, uiAllowedStatuses } from "./incidentTransitions.ts";

test("maps the backend's allowed transitions to UI statuses", () => {
  assert.deepEqual(
    uiAllowedStatuses(["INVESTIGATING", "CONTAINED", "RESOLVED", "FALSE POSITIVE"]),
    ["investigating", "contained", "closed"],
  );
  assert.deepEqual(uiAllowedStatuses(["CONTAINED", "RESOLVED", "FALSE POSITIVE"]), [
    "contained",
    "closed",
  ]);
});

test("a closed incident or missing data offers no change", () => {
  assert.deepEqual(uiAllowedStatuses([]), []);
  assert.deepEqual(uiAllowedStatuses(undefined), []);
  assert.deepEqual(statusOptions("closed", []), ["closed"]);
});

test("the current status comes first, without duplicates", () => {
  assert.deepEqual(statusOptions("contained", ["investigating", "closed"]), [
    "contained",
    "investigating",
    "closed",
  ]);
  assert.deepEqual(statusOptions("investigating", ["investigating", "closed"]), [
    "investigating",
    "closed",
  ]);
});
