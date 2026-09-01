import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "dist-staging-v2312");
const runtimeBuildDir = resolve(root, ".vendify-build/v2312");
const runtimeFile = resolve(runtimeBuildDir, "vendify-offline-v2312.js");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  configFile: resolve(root, "vite.offline-v2312.config.ts")
});

if (!existsSync(runtimeFile)) {
  throw new Error("v2.31.2 offline runtime bundle was not generated");
}

const files = [
  "index.html",
  "app.js",
  "styles.css",
  "sw.js",
  "supabase-config.js",
  "manifest.json",
  "vercel.json"
];

for (const file of files) {
  cpSync(resolve(root, file), resolve(out, file));
}
cpSync(resolve(root, "icons"), resolve(out, "icons"), { recursive: true });
cpSync(runtimeFile, resolve(out, "vendify-offline-v2312.js"));

const sourceMap = `${runtimeFile}.map`;
if (existsSync(sourceMap)) {
  cpSync(sourceMap, resolve(out, "vendify-offline-v2312.js.map"));
}

const indexPath = resolve(out, "index.html");
const index = readFileSync(indexPath, "utf8");
const appScript = '<script src="app.js?v=2311"></script>';
const runtimeScript = '<script src="vendify-offline-v2312.js?v=2312"></script>';

if (!index.includes(appScript)) {
  throw new Error("Cannot inject v2.31.2 runtime: expected app.js marker was not found");
}

const stagedIndex = index.replace(appScript, `${runtimeScript}\n  ${appScript}`);
writeFileSync(indexPath, stagedIndex, "utf8");

console.log("Vendify v2.31.2 staging release created in dist-staging-v2312/");
console.log("Offline IndexedDB runtime is bundled but remains disabled by default.");
console.log("Enable only for staging with ?offlineEngine=v2312 or the runtime helper.");
