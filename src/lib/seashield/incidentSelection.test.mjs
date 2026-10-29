// Run with: npm run test:unit
// A link to /incidents?incident=<id> opens that incident or says it is not in the list. Before this, an unknown id
// silently opened the first incident in the queue, so the page showed a different incident than the one requested.
import assert from "node:assert/strict";
import { test } from "node:test";

import { selectIncident } from "./incidentSelection.ts";

const rows = [
  { id: "INC-0243", ref: "INC-0243" },
  { id: "INC-0242", ref: "INC-0242" },
  { id: "inc-2451", ref: "INC-2451" },
];
const select = (selectedId, linkedId, { loading = false, list = rows } = {}) =>
  selectIncident({ rows: list, selectedId, linkedId, loading });

test("an unknown linked incident is reported, never replaced by the first incident", () => {
  assert.deepEqual(select("INC-9999", "INC-9999"), {
    kind: "not-found",
    incidentId: "INC-9999",
    loading: false,
  });
});

test("while no backend data has arrived, a linked incident not yet listed is being looked for", () => {
  assert.deepEqual(select("INC-0241", "INC-0241", { loading: true }), {
    kind: "not-found",
    incidentId: "INC-0241",
    loading: true,
  });
});

test("a linked incident in the list is the one shown", () => {
  assert.deepEqual(select("INC-0242", "INC-0242"), { kind: "selected", incident: rows[1] });
  // By reference as well as by id.
  assert.deepEqual(select("INC-2451", "INC-2451"), { kind: "selected", incident: rows[2] });
});

test("without a link the page behaves as before: the clicked incident, else the first", () => {
  assert.deepEqual(select(null, undefined), { kind: "selected", incident: rows[0] });
  assert.deepEqual(select("INC-0242", undefined), { kind: "selected", incident: rows[1] });
  // A clicked incident that left the list (e.g. another vessel scope) falls back to the first, as before.
  assert.deepEqual(select("INC-0100", undefined), { kind: "selected", incident: rows[0] });
  assert.deepEqual(select(null, undefined, { list: [] }), { kind: "none" });
});

test("once the operator clicks another incident, the link no longer decides what is shown", () => {
  assert.deepEqual(select("INC-0243", "INC-9999"), { kind: "selected", incident: rows[0] });
});
