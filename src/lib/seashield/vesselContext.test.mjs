// Run with: npm run test:unit
// Vessel operational context on /map: the selected-vessel panel shows identity, route and position from existing
// data only. Before this, a vessel showed "Unavailable · Not in the positions data" while positions were still
// loading or had never been received, the panel had no route and no way to close, and a kept snapshot after a failed
// refresh was not marked as not live.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

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
const { vesselService } = await vite.ssrLoadModule("/src/lib/seashield/services.ts");
const { buildSeedState } = await vite.ssrLoadModule("/src/lib/seashield/data.ts");
const { parsePositionsResponse } = await vite.ssrLoadModule("/src/lib/seashield/positions.ts");
const map = await vite.ssrLoadModule("/src/lib/seashield/mapModel.ts");
const { positionStatusText, vesselContext } = await vite.ssrLoadModule(
  "/src/lib/seashield/vesselContext.ts",
);

const EVALUATED_AT = "2026-10-28T12:00:00Z";
const BALTIC = "Baltic loop · Gulf of Gdańsk ↔ Gulf of Finland";
const ADEN = "Gulf of Aden loop · Bab el-Mandeb ↔ Socotra approaches";

const vessel = (id, name, imo, route_label) => ({
  id,
  name,
  imo,
  score: 95,
  status: "SECURE",
  last_communication: "2026-10-28T11:59:00Z",
  route_label,
});

const report = (vessel_id, lat, lon, freshness, position_at) => ({
  vessel_id,
  lat,
  lon,
  course_deg: 90,
  speed_kn: 12.5,
  position_at,
  received_at: position_at,
  source: "SIMULATED",
  freshness,
});

/** A positions response in the API's own field names, parsed by the app's real parser. */
const SNAPSHOT = parsePositionsResponse({
  evaluated_at: EVALUATED_AT,
  positions: [
    report("baltic-guardian", 56.25, 18.5, "CURRENT", "2026-10-28T11:59:00Z"),
    report("calypso", 12.4, 47.1, "STALE", "2026-10-28T11:40:00Z"),
    report("atlantic-trader", 48.0, -20.0, "LOST", "2026-10-28T10:00:00Z"),
  ],
  unavailable: [
    { vessel_id: "iron-horizon", reason: "NO_ROUTE" },
    { vessel_id: "northern-star", reason: "NO_REPORT" },
  ],
});

const LIVE = { snapshot: SNAPSHOT, status: "live", error: null };

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

mockBackend([
  vessel("baltic-guardian", "MV Baltic Guardian", "IMO 9384751", BALTIC),
  vessel("calypso", "MV Calypso", "IMO 9751028", ADEN),
  vessel("atlantic-trader", "MV Atlantic Trader", "IMO 9673052", null),
  vessel("iron-horizon", "MV Iron Horizon", "IMO 9714457", null),
  vessel("northern-star", "MV Northern Star", "IMO 9410283", "North Sea loop"),
  vessel("ocean-sentinel", "MV Ocean Sentinel", "IMO 9521846", "Channel–Biscay loop"),
]);
await backend.refreshSeaShieldBackend();

/** The panel's context for the selected vessel, built the way /map builds it. */
function selectedContext(feed = LIVE, backendOnline = true) {
  const state = store.getState();
  const rows = map.buildMapRows(
    state.vessels.map((v) => ({
      id: v.id,
      name: v.name,
      imo: v.imo,
      securityState: v.securityState,
      incidentSeverity: null,
      openIncidents: 0,
    })),
    feed.snapshot,
  );
  const row = rows.find((candidate) => candidate.id === state.selectedVesselId);
  if (!row) return null;
  return vesselContext({
    row,
    vessel: state.vessels.find((v) => v.id === row.id),
    dataSource: state.dataSource,
    feed,
    backendOnline,
  });
}

/** Every string the panel shows from the context, for checking that nothing else leaks in. */
function shownText(context) {
  const position =
    context.position.kind === "reported"
      ? [
          map.freshnessLabel[context.position.position.freshness],
          String(context.position.position.lat),
          String(context.position.position.lon),
        ]
      : [positionStatusText(context.position)];
  return [context.name, context.imo, context.route ?? "—", ...position].join(" | ");
}

test("selecting a vessel shows its own identity, route and reported position", () => {
  assert.equal(store.getState().dataSource, "backend");
  vesselService.select("baltic-guardian");
  const context = selectedContext();
  assert.equal(context.vesselId, "baltic-guardian");
  assert.equal(context.name, "MV Baltic Guardian");
  assert.equal(context.imo, "IMO 9384751");
  assert.equal(context.route, `Simulated route · ${BALTIC}`);
  assert.equal(context.position.kind, "reported");
  assert.equal(context.position.position.lat, 56.25);
  assert.equal(context.position.position.lon, 18.5);
  assert.equal(context.position.position.freshness, "current");
  assert.equal(context.position.ageMs, 60_000, "aged against the server's evaluated_at");
  assert.equal(context.position.evaluatedAt, Date.parse(EVALUATED_AT));
  assert.equal(context.position.live, true);
});

test("selecting a second vessel replaces every field, with nothing kept from the first", () => {
  vesselService.select("baltic-guardian");
  const first = selectedContext();
  vesselService.select("calypso");
  const second = selectedContext();
  assert.deepEqual(
    {
      vesselId: second.vesselId,
      name: second.name,
      imo: second.imo,
      route: second.route,
      lat: second.position.position.lat,
      lon: second.position.position.lon,
      freshness: second.position.position.freshness,
      ageMs: second.position.ageMs,
      link: second.detailLink.params.vesselId,
    },
    {
      vesselId: "calypso",
      name: "MV Calypso",
      imo: "IMO 9751028",
      route: `Simulated route · ${ADEN}`,
      lat: 12.4,
      lon: 47.1,
      freshness: "stale",
      ageMs: 20 * 60_000,
      link: "calypso",
    },
  );
  for (const field of ["vesselId", "name", "imo", "route"]) {
    assert.notEqual(second[field], first[field], field);
  }
});

test("a vessel without a position states the backend's reason and gets no location", () => {
  for (const [id, expected] of [
    ["iron-horizon", "Unavailable · No simulated route"],
    ["northern-star", "Unavailable · No position report yet"],
    ["ocean-sentinel", "Unavailable · Not in the positions data"],
  ]) {
    vesselService.select(id);
    const context = selectedContext();
    assert.equal(context.position.kind, "unavailable", id);
    assert.equal(positionStatusText(context.position), expected, id);
    assert.ok(!("position" in context.position), `${id} must not get a position`);
  }
});

test("before any positions response, no vessel is given a reason the data has not sent", () => {
  vesselService.select("baltic-guardian");
  const loading = selectedContext(map.INITIAL_FEED);
  assert.equal(loading.position.kind, "loading");
  assert.equal(positionStatusText(loading.position), "Loading positions…");

  const failed = map.feedAfterFailure(map.INITIAL_FEED, new Error("HTTP 503"));
  const noData = selectedContext(failed);
  assert.equal(noData.position.kind, "no-data");
  assert.equal(positionStatusText(noData.position), "Unavailable · no position data received");
  for (const context of [loading, noData]) {
    assert.ok(!positionStatusText(context.position).includes("Not in the positions data"));
  }
});

test("stale and lost contact are shown as the API classified them, separate from security status", () => {
  vesselService.select("calypso");
  const stale = selectedContext();
  assert.equal(stale.position.position.freshness, "stale");
  assert.equal(map.freshnessLabel[stale.position.position.freshness], "STALE");

  vesselService.select("atlantic-trader");
  const lost = selectedContext();
  assert.equal(lost.position.position.freshness, "lost");
  assert.equal(map.freshnessLabel[lost.position.position.freshness], "LOST");
  assert.equal(
    store.getState().vessels.find((v) => v.id === "atlantic-trader").securityState,
    "secure",
  );
});

test("after a failed refresh or with the backend unreachable, the kept position is marked not live", () => {
  vesselService.select("baltic-guardian");
  const failed = map.feedAfterFailure(LIVE, new Error("HTTP 503"));
  const kept = selectedContext(failed);
  assert.equal(kept.position.kind, "reported");
  assert.equal(kept.position.live, false);
  assert.equal(kept.position.position.lat, 56.25, "the last data received is kept, not replaced");
  assert.equal(selectedContext(LIVE, false).position.live, false);
});

test("a vessel without a route label shows no route name", () => {
  vesselService.select("atlantic-trader");
  assert.equal(selectedContext().route, "No simulated route");
  // A vessel only the positions data lists has no store record, so no route at all.
  const unknown = vesselContext({
    row: map.buildMapRows([], SNAPSHOT).find((row) => row.id === "calypso"),
    vessel: undefined,
    dataSource: "backend",
    feed: LIVE,
    backendOnline: true,
  });
  assert.equal(unknown.route, null);
  assert.equal(unknown.imo, "");
});

test("backend vessels never show demo-fixture route, type or flag", () => {
  const fixtures = buildSeedState().vessels.flatMap((v) => [
    v.route,
    v.type,
    v.flag,
    v.name,
    v.imo,
  ]);
  for (const v of store.getState().vessels) {
    vesselService.select(v.id);
    const shown = shownText(selectedContext());
    for (const fixture of fixtures) assert.ok(!shown.includes(fixture), `${v.id}: ${fixture}`);
  }
});

test("the vessel-page action targets the existing vessel detail route for the selected vessel", () => {
  vesselService.select("calypso");
  assert.deepEqual(selectedContext().detailLink, {
    to: "/vessels/$vesselId",
    params: { vesselId: "calypso" },
  });
  const routeTree = readFileSync(`${root}src/routeTree.gen.ts`, "utf8");
  assert.ok(routeTree.includes("'/vessels/$vesselId'"), "route exists in the generated route tree");
});

test("closing the panel clears the shared selection, as the fleet selector's 'all' does", () => {
  vesselService.select("calypso");
  assert.notEqual(selectedContext(), null);
  vesselService.select("all");
  assert.equal(store.getState().selectedVesselId, "all");
  assert.equal(selectedContext(), null);
});
