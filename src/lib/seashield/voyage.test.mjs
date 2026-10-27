// Run with: npm run test:unit
// Vessel cards and pages showed seed-fixture voyage text ("Narvik → Bremerhaven") for backend vessels, assigned by
// sort order, which contradicted the simulated routes on the tactical map. Backend vessels now show the label of
// their simulated route from the backend route configuration, and never the fixture text.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import { voyageText } from "./voyage.ts";

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
const { buildSeedState } = await vite.ssrLoadModule("/src/lib/seashield/data.ts");

const FIXTURE_ROUTES = buildSeedState().vessels.map((vessel) => vessel.route);
const vessel = (id, route_label) => ({
  id,
  name: `MV ${id}`,
  imo: "IMO 1",
  score: 95,
  status: "SECURE",
  last_communication: "2026-10-27T12:00:00Z",
  route_label,
});

/** Answers the full backend refresh with fixed data and the given vessels. */
function mockBackend(vessels) {
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    const bodies = {
      "/health": { status: "ok" },
      "/api/v1/vessels": vessels,
      "/api/v1/fleet/security-summary": {
        vessel_count: vessels.length,
        average_score: 95,
        average_status: "SECURE",
      },
    };
    return new Response(JSON.stringify(bodies[path] ?? []), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

test("seed data keeps its own fixture voyage text", () => {
  for (const seeded of buildSeedState().vessels) {
    assert.equal(seeded.simulatedRoute, null);
    assert.ok(seeded.route.length > 0);
    assert.equal(voyageText(seeded, "seed"), seeded.route);
  }
});

test("a backend vessel shows its simulated route label, marked as simulated", () => {
  assert.equal(
    voyageText({ route: "", simulatedRoute: "North Sea loop · Rotterdam ↔ Stavanger" }, "backend"),
    "Simulated route · North Sea loop · Rotterdam ↔ Stavanger",
  );
  assert.equal(voyageText({ route: "", simulatedRoute: null }, "backend"), "No simulated route");
});

test("a backend vessel never shows fixture voyage text, even if the field still held it", () => {
  for (const fixture of FIXTURE_ROUTES) {
    assert.notEqual(voyageText({ route: fixture, simulatedRoute: null }, "backend"), fixture);
    assert.ok(
      !voyageText({ route: fixture, simulatedRoute: "Baltic loop" }, "backend").includes(fixture),
    );
  }
});

test("loaded backend vessels carry the API's route labels and no fixture voyage text", async () => {
  mockBackend([
    vessel("baltic-guardian", "Baltic loop · Gulf of Gdańsk ↔ Gulf of Finland"),
    vessel("northern-star", "  North Sea loop · Rotterdam ↔ Stavanger  "),
    vessel("calypso", null),
    vessel("iron-horizon", "   "),
    { ...vessel("ocean-sentinel"), route_label: undefined },
  ]);
  await backend.refreshSeaShieldBackend();
  const state = store.getState();
  assert.equal(state.dataSource, "backend");
  const shown = Object.fromEntries(
    state.vessels.map((v) => [v.id, voyageText(v, state.dataSource)]),
  );
  assert.deepEqual(shown, {
    "baltic-guardian": "Simulated route · Baltic loop · Gulf of Gdańsk ↔ Gulf of Finland",
    "northern-star": "Simulated route · North Sea loop · Rotterdam ↔ Stavanger",
    calypso: "No simulated route",
    "iron-horizon": "No simulated route",
    "ocean-sentinel": "No simulated route",
  });
  for (const loaded of state.vessels) {
    assert.equal(loaded.route, "", `${loaded.id} must not keep the fixture voyage text`);
    for (const fixture of FIXTURE_ROUTES) assert.ok(!shown[loaded.id].includes(fixture));
  }
});
