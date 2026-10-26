// Run with: npm run test:unit
// Communication ages were measured against the simulated clock (fixed at 2026-02-25) while backend
// timestamps are real, so every vessel showed "0s"; a missing timestamp was also shown as "just now".
import assert from "node:assert/strict";
import { test } from "node:test";

import { commsAge } from "./format.ts";
import { freshnessNow, parseApiTimestamp } from "./freshness.ts";

const JUNE_1 = Date.UTC(2026, 5, 1, 12, 0, 0);

test("parses API timestamps, treating a missing zone as UTC", () => {
  assert.equal(parseApiTimestamp("2026-06-01T12:00:00Z"), JUNE_1);
  assert.equal(parseApiTimestamp("2026-06-01T12:00:00+00:00"), JUNE_1);
  assert.equal(parseApiTimestamp("2026-06-01T14:00:00+02:00"), JUNE_1);
  assert.equal(parseApiTimestamp("2026-06-01T12:00:00"), JUNE_1);
  assert.equal(parseApiTimestamp("2026-06-01 12:00:00.000000"), JUNE_1);
});

test("a missing or invalid timestamp is unknown, not now", () => {
  for (const value of [undefined, null, "", "not a date"]) {
    assert.equal(parseApiTimestamp(value), null, String(value));
  }
});

test("backend data is aged against the real clock, offline fixtures against the simulated clock", () => {
  const simulated = Date.UTC(2026, 1, 25);
  const real = Date.UTC(2026, 9, 26);
  assert.equal(freshnessNow("backend", simulated, real), real);
  assert.equal(freshnessNow("seed", simulated, real), simulated);
});

test("shows the real age of the last communication", () => {
  assert.equal(commsAge(JUNE_1, JUNE_1 + 252_000, " ago"), "4m 12s ago");
  assert.equal(commsAge(JUNE_1, JUNE_1 + 3 * 86_400_000), "3d 0h");
  assert.equal(commsAge(null, JUNE_1, " ago"), "—");
});
