import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";
import { inspectRenderedStagingSupabaseConfig } from "./staging-supabase-config.mjs";

const root = resolve(import.meta.dirname, "..", "dist-refactor-modular");
const host = "127.0.0.1";
const port = Number(process.env.VENDIFY_PORT || 4174);

if (!existsSync(resolve(root, "index.html"))) {
  console.error("Modular refactor build not found. Run: npm run qa:refactor:modular");
  process.exit(1);
}

try {
  const stagingConfig = inspectRenderedStagingSupabaseConfig(
    readFileSync(resolve(root, "supabase-config.js"), "utf8")
  );
  if (stagingConfig.mode !== "real") {
    console.error(
      "Real staging backend is not configured. Set VENDIFY_STAGING_SUPABASE_URL and " +
        "VENDIFY_STAGING_SUPABASE_ANON_KEY, rebuild the modular refactor preview, then retry."
    );
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"]
]);

const server = createServer((request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);
    const pathname = decodeURIComponent(requestUrl.pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = resolve(root, normalize(relative));

    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    console.error(error);
    response.writeHead(500).end("Internal server error");
  }
});

server.listen(port, host, () => {
  console.log(`Vendify modular refactor preview: http://${host}:${port}/`);
  console.log(`Full offline test: http://${host}:${port}/?offlineEngine=v2312`);
  console.log("Press Ctrl+C to stop.");
});
