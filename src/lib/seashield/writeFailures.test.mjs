// Run with: npm run test:unit
// Failed frontend writes were swallowed (`.catch(() => undefined)`): the optimistic change stayed on screen
// until the next refresh silently removed it, and the operator was never told.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ApiRequestError,
  describeWriteFailure,
  errorDetail,
  optimisticWrite,
} from "./writeFailures.ts";

function recorder() {
  const calls = [];
  return {
    calls,
    steps: (send) => ({
      apply: () => {
        calls.push("apply");
        return () => calls.push("undo");
      },
      send: async () => {
        calls.push("send");
        await send();
      },
      report: (cause) => calls.push(`report:${cause.message}`),
      reconcile: async () => calls.push("reconcile"),
    }),
  };
}

test("a successful write keeps the local change and reports nothing", async () => {
  const { calls, steps } = recorder();
  assert.equal(await optimisticWrite(steps(async () => {})), true);
  assert.deepEqual(calls, ["apply", "send"]);
});

test("a failed write undoes the local change, reports it and re-fetches server state", async () => {
  const { calls, steps } = recorder();
  const failure = new ApiRequestError(409, "Invalid incident status transition");
  const ok = await optimisticWrite(
    steps(async () => {
      throw failure;
    }),
  );
  assert.equal(ok, false);
  assert.deepEqual(calls, [
    "apply",
    "send",
    "undo",
    "report:Invalid incident status transition",
    "reconcile",
  ]);
});

test("failure descriptions name the action and the backend's reason", () => {
  assert.deepEqual(
    describeWriteFailure("Update incident", new ApiRequestError(404, "Incident not found")),
    {
      title: "Update incident failed",
      description: "Incident not found. The change was not saved.",
    },
  );
  assert.deepEqual(describeWriteFailure("Add note", new ApiRequestError(500, null)), {
    title: "Add note failed",
    description: "SeaShield API request failed (500). The change was not saved.",
  });
  assert.equal(
    describeWriteFailure("Acknowledge event", new TypeError("Failed to fetch")).description,
    "The backend could not be reached. The change was not saved.",
  );
  assert.equal(
    describeWriteFailure("Run scenario", new Error("No backend event is mapped to x")).description,
    "No backend event is mapped to x. The change was not saved.",
  );
  assert.equal(
    describeWriteFailure("Reset", "unexpected").description,
    "The change was not saved.",
  );
});

test("reads FastAPI error details", () => {
  assert.equal(errorDetail({ detail: "Vessel not found" }), "Vessel not found");
  assert.equal(errorDetail({ detail: [{ msg: "field required" }] }), null);
  assert.equal(errorDetail({ detail: "  " }), null);
  assert.equal(errorDetail(null), null);
  assert.equal(errorDetail("Internal Server Error"), null);
});
