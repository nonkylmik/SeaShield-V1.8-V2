// Serves the marketing site locally for preview. No dependencies; binds to 127.0.0.1 only.
// Usage: npm run serve   (port: MARKETING_PORT, default 5180)
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.env.MARKETING_PORT ?? 5180);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
// Only the site's own files are served; tooling and docs are not.
const SERVED =
  /^(index\.html|privacy\.html|styles\.css|main\.js|form\.js|config\.js|favicon\.svg|assets\/.+)$/;

/** Resolves a request path to a file inside the site, or null for anything outside it or not served. */
export function resolveRequest(urlPath) {
  let path;
  try {
    path = decodeURIComponent(new URL(urlPath, "http://localhost").pathname);
  } catch {
    return null;
  }
  if (path.endsWith("/")) path += "index.html";
  const relative = normalize(path)
    .replace(/^[\\/]+/, "")
    .split(sep)
    .join("/");
  if (!SERVED.test(relative)) return null;
  const file = join(ROOT, relative);
  return file.startsWith(ROOT + sep) ? file : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer(async (req, res) => {
    const file =
      req.method === "GET" || req.method === "HEAD" ? resolveRequest(req.url ?? "/") : null;
    const info = file ? await stat(file).catch(() => null) : null;
    if (!file || !info?.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Content-Length": info.size,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
  }).listen(PORT, "127.0.0.1", () => {
    console.log(`SeaShield marketing site: http://127.0.0.1:${PORT}/`);
  });
}
