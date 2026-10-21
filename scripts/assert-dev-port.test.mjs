// Run with: node --test scripts/
// Uses an ephemeral port and a separate occupier process, so it never touches
// 8080 and exercises cross-process bind conflicts like a real stray server.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { test } from "node:test";

import { DEV_HOST, DEV_PORT, assertPortFree } from "./assert-dev-port.mjs";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Starts a child process listening on host:port; resolves once it is bound.
function occupy(host, port) {
  const code = `require("node:net").createServer().listen({ host: ${JSON.stringify(host)}, port: ${port} }, () => console.log("ready"));`;
  const child = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (status) => reject(new Error(`occupier exited early (${status})`)));
    child.stdout.once("data", () => resolve(() => child.kill()));
  });
}

test("enforces the agreed dev address", () => {
  assert.equal(DEV_HOST, "127.0.0.1");
  assert.equal(DEV_PORT, 8080);
});

test("passes when the port is free", async () => {
  await assertPortFree(await freePort());
});

// "::" is a dual-stack wildcard; "::1" alone would capture browsers that
// resolve localhost to IPv6 first.
for (const host of ["127.0.0.1", "0.0.0.0", "::", "::1"]) {
  test(`fails when another process listens on ${host}`, async () => {
    const port = await freePort();
    const release = await occupy(host, port);
    try {
      await assert.rejects(assertPortFree(port), /already in use|reserved|unavailable/);
    } finally {
      release();
    }
  });
}

test("error message names the port and refuses to switch", async () => {
  const port = await freePort();
  const release = await occupy("0.0.0.0", port);
  try {
    await assert.rejects(assertPortFree(port), (error) => {
      assert.match(error.message, new RegExp(`Port ${port} `));
      assert.match(error.message, /will not switch ports/);
      return true;
    });
  } finally {
    release();
  }
});
