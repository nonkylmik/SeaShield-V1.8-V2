// Run with: npm run test:unit
// Rules for the operator actions on /map: a simulated event goes only to the vessel the operator selected (never a
// substitute), a repeated action while one is in flight sends nothing, and "Start investigation" is NEW → INVESTIGATING
// only, where the backend allows it.
import assert from "node:assert/strict";
import { test } from "node:test";

import { canStartInvestigation, inFlightGuard, injectionTarget } from "./operatorActions.ts";

const vessels = [
  { id: "baltic-guardian", name: "MV Baltic Guardian", imo: "IMO 9384751" },
  { id: "calypso", name: "MV Calypso", imo: "IMO 9751028" },
];
const target = (overrides = {}) =>
  injectionTarget({
    selectedVesselId: "calypso",
    vessels,
    dataSource: "backend",
    backend: "online",
    ...overrides,
  });

test("the injection targets exactly the selected backend vessel", () => {
  assert.deepEqual(target(), {
    kind: "ready",
    vesselId: "calypso",
    vesselName: "MV Calypso",
    imo: "IMO 9751028",
  });
});

test("without a selected vessel there is no target, never the first vessel", () => {
  const result = target({ selectedVesselId: "all" });
  assert.equal(result.kind, "unavailable");
  assert.match(result.reason, /Select a vessel/);
});

test("a vessel missing from the backend vessel list cannot be targeted", () => {
  const result = target({ selectedVesselId: "positions-only-vessel" });
  assert.equal(result.kind, "unavailable");
  assert.match(result.reason, /not in the backend vessel list/);
});

test("demo vessels and an unreachable backend cannot receive simulated events", () => {
  const demo = target({ dataSource: "seed" });
  assert.equal(demo.kind, "unavailable");
  assert.match(demo.reason, /demo data/);
  for (const backend of ["degraded", "offline"]) {
    const result = target({ backend });
    assert.equal(result.kind, "unavailable", backend);
    assert.match(result.reason, /Backend unreachable/);
  }
});

test("a second call while one is in flight is refused, not queued; the key frees once it settles", async () => {
  const guard = inFlightGuard();
  let calls = 0;
  let release;
  const task = () => {
    calls += 1;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const first = guard.run("inject", task);
  assert.equal(guard.isPending("inject"), true);
  assert.deepEqual(await guard.run("inject", task), { ran: false });
  assert.equal(calls, 1);
  release("sent");
  assert.deepEqual(await first, { ran: true, value: "sent" });
  assert.equal(guard.isPending("inject"), false);
  // Other keys are independent.
  assert.deepEqual(await guard.run("investigate:INC-1", async () => 1), { ran: true, value: 1 });
});

test("a task that fails also frees its key", async () => {
  const guard = inFlightGuard();
  await assert.rejects(
    guard.run("inject", async () => {
      throw new Error("boom");
    }),
  );
  assert.equal(guard.isPending("inject"), false);
});

test("Start investigation is offered only for NEW incidents the backend lets move to INVESTIGATING", () => {
  assert.equal(
    canStartInvestigation({ status: "open", allowedStatuses: ["investigating", "closed"] }),
    true,
  );
  // NEW without the backend listing INVESTIGATING (e.g. demo fixtures with no transitions).
  assert.equal(canStartInvestigation({ status: "open", allowedStatuses: [] }), false);
  // CONTAINED → INVESTIGATING is a lifecycle change, not "Start investigation".
  assert.equal(
    canStartInvestigation({ status: "contained", allowedStatuses: ["investigating", "closed"] }),
    false,
  );
  assert.equal(
    canStartInvestigation({ status: "investigating", allowedStatuses: ["contained"] }),
    false,
  );
  assert.equal(canStartInvestigation({ status: "closed", allowedStatuses: [] }), false);
});
