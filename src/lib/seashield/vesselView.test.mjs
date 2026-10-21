// Run with: npm run test:unit
// A direct load or reload of /vessels/<id> rendered against seed data (ids
// vsl-01…) before backend vessels arrived, so real vessels showed the 404 view.
import assert from "node:assert/strict";
import { test } from "node:test";

import { vesselView } from "./vesselView.ts";

test("waits for backend data before deciding a vessel does not exist", () => {
  assert.equal(vesselView({ found: false, dataSource: "seed", backend: "online" }), "loading");
});

test("shows the vessel once it is in the store", () => {
  assert.equal(vesselView({ found: true, dataSource: "backend", backend: "online" }), "ready");
});

test("reports not found only after backend vessels have loaded", () => {
  assert.equal(vesselView({ found: false, dataSource: "backend", backend: "online" }), "not-found");
});

test("does not wait forever when the backend is unreachable", () => {
  assert.equal(vesselView({ found: false, dataSource: "seed", backend: "degraded" }), "not-found");
});
