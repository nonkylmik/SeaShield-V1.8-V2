// Fails fast when the frontend dev port is unavailable, before Vite starts.
// Vite's strictPort only checks its own bind address: with host 127.0.0.1 it
// still starts (with a warning) when another process holds 0.0.0.0:8080, and a
// listener on [::1]:8080 would capture browsers that resolve localhost to IPv6.
// Windows lets a specific-address bind coexist with wildcard listeners, so a
// bind probe alone misses those; connecting to both loopbacks catches any
// listener a browser could reach, and one bind probe catches reserved ports.
import net from "node:net";
import { pathToFileURL } from "node:url";

export const DEV_HOST = "127.0.0.1";
export const DEV_PORT = 8080;

const LOOPBACKS = ["127.0.0.1", "::1"];
const CONNECT_TIMEOUT_MS = 1000;

// Connect errors meaning nothing is listening, or the address family is
// unavailable on this machine (e.g. IPv6 disabled).
const NOT_LISTENING = new Set([
  "ECONNREFUSED",
  "EADDRNOTAVAIL",
  "EAFNOSUPPORT",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

function isListening(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (listening) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", (error) => finish(!NOT_LISTENING.has(error.code)));
  });
}

function bindError(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error) => resolve(error.code));
    server.listen({ host, port }, () => server.close(() => resolve(null)));
  });
}

function describe(code) {
  if (code === "EACCES")
    return "reserved or access denied (check `netsh int ipv4 show excludedportrange protocol=tcp`)";
  if (code === "EADDRINUSE") return "already in use by another process";
  return `unavailable (${code})`;
}

/** Resolves when nothing is reachable on `port` and DEV_HOST can bind it; rejects otherwise. */
export async function assertPortFree(port = DEV_PORT) {
  for (const host of LOOPBACKS) {
    if (await isListening(host, port)) {
      throw new Error(
        `Port ${port} is already in use: a process is accepting connections on ${host.includes(":") ? `[${host}]` : host}:${port}. Stop it and retry; the dev server will not switch ports.`,
      );
    }
  }
  const code = await bindError(DEV_HOST, port);
  if (code !== null) {
    throw new Error(
      `Port ${port} on ${DEV_HOST} is ${describe(code)}. The dev server will not switch ports.`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await assertPortFree(DEV_PORT);
  } catch (error) {
    console.error(`[predev] ${error.message}`);
    process.exit(1);
  }
}
