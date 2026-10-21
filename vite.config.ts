// Explicit Vite config for TanStack Start. Replaces @lovable.dev/vite-tanstack-config with the
// plugins and options it applied outside the Lovable sandbox; Lovable-only editor/preview
// tooling is intentionally left out.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

const startOptions: Parameters<typeof tanstackStart>[0] = {
  importProtection: {
    behavior: "error",
    client: { files: ["**/server/**"], specifiers: ["server-only"] },
  },
  // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
  server: { entry: "server" },
};

const prerenders =
  Boolean(startOptions.spa && (startOptions.spa.enabled ?? true)) ||
  startOptions.prerender?.enabled === true;

// TanStack Start prerenders (SPA shell, prerendered pages) through a preview server that loads
// dist/server/server.js, but Nitro emits the server bundle as .output/server/index.mjs. While
// prerendering, a temporary dist/server/server.js forwards to Nitro's handler and is removed
// once the build has finished.
const prerenderShimFile = fileURLToPath(new URL("./dist/server/server.js", import.meta.url));
const nitroServerEntry = fileURLToPath(new URL("./.output/server/index.mjs", import.meta.url));

function nitroPrerenderShim(): Plugin[] {
  let written = false;
  return [
    {
      name: "seashield:nitro-prerender-shim",
      apply: "build",
      buildApp: {
        order: "post",
        async handler() {
          const entry = relative(dirname(prerenderShimFile), nitroServerEntry).split(sep).join("/");
          await mkdir(dirname(prerenderShimFile), { recursive: true });
          await writeFile(
            prerenderShimFile,
            [
              `import server from "${entry}";`,
              "const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };",
              "export default {",
              "  fetch(request) {",
              "    // Nitro's Cloudflare handler assigns request.ip, a getter-only property in Node.",
              '    Object.defineProperty(request, "ip", { value: undefined, writable: true, configurable: true });',
              "    return server.fetch(request, {}, ctx);",
              "  },",
              "};",
              "",
            ].join("\n"),
          );
          written = true;
        },
      },
    },
    {
      name: "seashield:nitro-prerender-shim-cleanup",
      apply: "build",
      enforce: "post",
      buildApp: {
        order: "post",
        async handler() {
          if (!written) return;
          await rm(prerenderShimFile, { force: true });
          written = false;
        },
      },
    },
  ];
}

export default defineConfig(({ command, mode }) => ({
  plugins: [
    // Development mode only (`npm run dev`, `npm run build:dev`); never in `npm run build`.
    ...(mode === "development"
      ? [
          devtools({
            logging: false,
            eventBusConfig: { enabled: false },
            enhancedLogs: { enabled: false },
            consolePiping: { enabled: false },
            removeDevtoolsOnBuild: false,
            injectSource: { enabled: true },
          }),
        ]
      : []),
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart(startOptions),
    // Server bundle for builds only. Cloudflare Workers stays the fallback target until a
    // deployment target is chosen; NITRO_PRESET overrides it.
    ...(command === "build"
      ? [nitro({ defaultPreset: "cloudflare-module" }), ...(prerenders ? nitroPrerenderShim() : [])]
      : []),
    viteReact(),
  ],
  ...(command === "build" && mode === "development"
    ? {
        environments: {
          client: { define: { "process.env.NODE_ENV": JSON.stringify("development") } },
        },
      }
    : {}),
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
    ignoreOutdatedRequests: true,
  },
  // Dev server is pinned to 127.0.0.1:8080; `predev` (scripts/assert-dev-port.mjs) fails
  // first if anything else holds the port, and strictPort stops Vite from switching ports.
  server: { host: "127.0.0.1", port: 8080, strictPort: true },
}));
