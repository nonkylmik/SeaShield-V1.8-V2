// Run with: node --test src/lib/seashield/cachedSelector.test.mjs
// useSyncExternalStore requires getSnapshot to return the same value while the
// store is unchanged. The vessel page's .filter() selectors returned a new array
// on every read, so React re-rendered until "Maximum update depth exceeded".
import assert from "node:assert/strict";
import { test } from "node:test";

import { cachedSelector } from "./cachedSelector.ts";

const state = {
  cameras: [
    { id: "c1", vesselId: "a" },
    { id: "c2", vesselId: "b" },
  ],
};
const camerasOf = (vesselId) => (s) => s.cameras.filter((c) => c.vesselId === vesselId);

test("returns the same value for repeated reads of an unchanged state", () => {
  const select = cachedSelector();
  const selector = camerasOf("a");
  const first = select(state, selector);
  assert.equal(select(state, selector), first);
  assert.deepEqual(first, [{ id: "c1", vesselId: "a" }]);
});

test("recomputes after the store publishes a new state", () => {
  const select = cachedSelector();
  const selector = camerasOf("a");
  const first = select(state, selector);
  const next = { ...state, cameras: [...state.cameras, { id: "c3", vesselId: "a" }] };
  const second = select(next, selector);
  assert.notEqual(second, first);
  assert.deepEqual(
    second.map((c) => c.id),
    ["c1", "c3"],
  );
});

test("recomputes when the selector changes, so route params are never stale", () => {
  const select = cachedSelector();
  select(state, camerasOf("a"));
  assert.deepEqual(
    select(state, camerasOf("b")).map((c) => c.id),
    ["c2"],
  );
});
