// Run with: npm run test:unit
// Backend vessels showed a seed-fixture vessel's type and flag ("Bulk Carrier · Liberia"), assigned by alphabetical
// sort order, as if they were facts about the backend vessel. The backend has no type or flag, so backend vessels now
// show a neutral placeholder; seed data keeps each fixture vessel's own type and flag.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import { NO_TYPE_FLAG, typeFlagText } from "./typeFlag.ts";

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

const FIXTURES = buildSeedState().vessels.map(({ type, flag }) => ({ type, flag }));
const vessel = (id) => ({
  id,
  name: `MV ${id}`,
  imo: "IMO 1",
  score: 95,
  status: "SECURE",
  last_communication: "2026-10-27T12:00:00Z",
  route_label: null,
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

test("seed data keeps each fixture vessel's own type and flag", () => {
  const state = store.getState();
  assert.equal(state.dataSource, "seed");
  assert.deepEqual(
    Object.fromEntries(state.vessels.map((v) => [v.name, typeFlagText(v, state.dataSource)])),
    {
      "MV Northern Meridian": "Container 8,400 TEU · Panama",
      "MV Arctic Vanguard": "Bulk Carrier · Liberia",
      "MV Coral Dominion": "Container 4,200 TEU · Marshall Islands",
      "MV Baltic Sentinel": "Ro-Ro Cargo · Malta",
      "MV Pacific Ledger": "Container 11,000 TEU · Singapore",
      "MV Atlantic Custodian": "General Cargo · Cyprus",
      "MV Iron Kestrel": "Bulk Carrier · Bahamas",
      "MV Southern Ledger": "Chemical Tanker · Norway",
    },
  );
});

test("a backend vessel shows the placeholder, even if its fields still held fixture values", () => {
  for (const fixture of FIXTURES) {
    assert.equal(typeFlagText(fixture, "backend"), NO_TYPE_FLAG);
  }
  assert.equal(typeFlagText({ type: "", flag: "" }, "backend"), NO_TYPE_FLAG);
});

test("loaded backend vessels carry no fixture type or flag, whatever their sort position", async () => {
  // More vessels than fixtures, so every fixture slot is used and slots wrap around.
  const ids = [
    "atlantic-trader",
    "baltic-guardian",
    "calypso",
    "iron-horizon",
    "northern-star",
    "ocean-sentinel",
    "pacific-dawn",
    "queen-of-tides",
    "red-harbour",
  ];
  mockBackend(ids.map(vessel));
  await backend.refreshSeaShieldBackend();
  const state = store.getState();
  assert.equal(state.dataSource, "backend");
  assert.deepEqual(state.vessels.map((v) => v.id).sort(), ids);
  for (const loaded of state.vessels) {
    assert.equal(loaded.type, "", `${loaded.id} must not keep a fixture type`);
    assert.equal(loaded.flag, "", `${loaded.id} must not keep a fixture flag`);
    const shown = typeFlagText(loaded, state.dataSource);
    assert.equal(shown, NO_TYPE_FLAG);
    for (const fixture of FIXTURES) {
      assert.ok(!shown.includes(fixture.type) && !shown.includes(fixture.flag));
    }
  }
});
