// Run with: npm run test:unit
// /cameras hydration mismatch: the server renders seed data (64 cameras), backend data
// (1 camera) can reach the store before a lazily loaded route hydrates, and the client's
// first render must still match the server HTML or React discards it.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { hydrateRoot } = await import("react-dom/client");

// Load the TypeScript store/hook exactly as the app resolves them.
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
const { useSeaShield } = await vite.ssrLoadModule("/src/lib/seashield/useSeaShield.ts");

function FeedCount() {
  return createElement("span", null, String(useSeaShield((s) => s.cameras.length)));
}

test("hydration matches the server HTML even if backend data arrived first", async () => {
  const html = renderToString(createElement(FeedCount));
  assert.equal(html, "<span>64</span>", "server renders the seed data");

  store.hydrateFromBackend({
    health: "ok",
    cameras: [
      {
        id: "cam-17",
        vesselId: "calypso",
        location: "Cargo Area",
        online: true,
        recording: true,
        lastFrame: 0,
      },
    ],
  });

  const container = document.getElementById("root");
  container.innerHTML = html;
  const recoverable = [];
  await act(async () => {
    hydrateRoot(container, createElement(FeedCount), {
      onRecoverableError: (error) => recoverable.push(String(error)),
    });
  });

  assert.deepEqual(recoverable, [], "React reported a hydration mismatch");
  assert.equal(container.textContent, "1", "live backend data is shown after hydration");
});
