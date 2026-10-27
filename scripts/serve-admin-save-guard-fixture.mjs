import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const out = resolve(root, "outputs/VEN_ADMIN_001B1_ACCIDENTAL_SAVE_GUARD");
await mkdir(out, { recursive: true });
const served = new Map([
  ["/", "tests/browser/admin-save-guard-fixture.html"],
  ["/fixture.mjs", "tests/browser/admin-save-guard-fixture.mjs"],
  ["/read-guard.mjs", "scripts/admin-read-smoke-guard.mjs"]
]);
const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end(); return;
    }
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
    const relative = served.get(pathname) ?? (pathname.startsWith("/dist-ts/") && pathname.endsWith(".js") ? pathname.slice(1) : null);
    if (!relative || relative.includes("..")) { response.writeHead(404).end(); return; }
    const file = resolve(root, relative);
    if (!file.startsWith(root + "/") && !file.startsWith(root + "\\")) { response.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    response.writeHead(200, {
      "Content-Type": extname(file) === ".html" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; connect-src 'none'; worker-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'",
      "Cache-Control": "no-store"
    }).end(request.method === "HEAD" ? undefined : bytes);
  } catch { response.writeHead(404).end(); }
});
server.listen(0, "127.0.0.1", async () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  await writeFile(resolve(out, "browser-fixture-location.json"), JSON.stringify({ url, pid: process.pid, scope: "Loopback only; real DOM, compiled controller, exclusively in-memory RPC mocks; connect-src none" }, null, 2));
  console.log(url);
});
setTimeout(() => server.close(() => process.exit(0)), 3600000);
