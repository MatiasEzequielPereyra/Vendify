import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "dist-staging-v2312");
const runtimeBuildDir = resolve(root, ".vendify-build/v2312");
const coreBuildDir = resolve(root, ".vendify-build/modular-core");
const pendingUiBuildDir = resolve(root, ".vendify-build/v2312-pending-ui");
const runtimeFile = resolve(runtimeBuildDir, "vendify-offline-v2312.js");
const coreFile = resolve(coreBuildDir, "vendify-core-v232.js");
const pendingUiFile = resolve(pendingUiBuildDir, "vendify-offline-v2312-pending-ui.js");

function fingerprint(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function stripSourceMapReference(content) {
  return content.replace(/\n?\/\/# sourceMappingURL=.*(?:\r?\n)?$/u, "\n");
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  configFile: resolve(root, "vite.offline-v2312.config.ts")
});
await build({
  configFile: resolve(root, "vite.modular-core.config.ts")
});
await build({
  configFile: resolve(root, "vite.offline-v2312-pending-ui.config.ts")
});

for (const file of [runtimeFile, coreFile, pendingUiFile]) {
  if (!existsSync(file)) {
    throw new Error(`v2.31.2 bundle was not generated: ${file}`);
  }
}

const files = [
  "index.html",
  "html-loader.js",
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
cpSync(resolve(root, "styles"), resolve(out, "styles"), { recursive: true });
cpSync(resolve(root, "html"), resolve(out, "html"), { recursive: true });

const stagedApp = readFileSync(resolve(root, "app.js"), "utf8");

const runtimeContent = stripSourceMapReference(readFileSync(runtimeFile, "utf8"));
const coreContent = stripSourceMapReference(readFileSync(coreFile, "utf8"));
const pendingUiContent = stripSourceMapReference(readFileSync(pendingUiFile, "utf8"));
const appHash = fingerprint(stagedApp);
const runtimeHash = fingerprint(runtimeContent);
const coreHash = fingerprint(coreContent);
const pendingUiHash = fingerprint(pendingUiContent);

const stagedAppName = `app-staging-v2312-${appHash}.js`;
const runtimeName = `vendify-offline-v2312-${runtimeHash}.js`;
const coreName = `vendify-core-v232-${coreHash}.js`;
const pendingUiName = `vendify-offline-v2312-pending-ui-${pendingUiHash}.js`;

writeFileSync(resolve(out, stagedAppName), stagedApp, "utf8");
writeFileSync(resolve(out, runtimeName), runtimeContent, "utf8");
writeFileSync(resolve(out, coreName), coreContent, "utf8");
writeFileSync(resolve(out, pendingUiName), pendingUiContent, "utf8");

const indexPath = resolve(out, "index.html");
const index = readFileSync(indexPath, "utf8");
const appEntry = 'Object.freeze({ src: "app.js?v=2311" })';
const stagedEntries = [runtimeName, coreName, stagedAppName, pendingUiName]
  .map((name) => `Object.freeze({ src: "${name}" })`)
  .join(",\n        ");

if (!index.includes(appEntry)) {
  throw new Error("Cannot inject v2.31.2 runtime: expected app.js marker was not found");
}

const stagedIndex = index.replace(appEntry, stagedEntries);
writeFileSync(indexPath, stagedIndex, "utf8");

console.log("Vendify v2.31.2 staging release created in dist-staging-v2312/");
console.log("IndexedDB checkout, snapshot capture, sync routing and pending-sales UI are staging-only.");
console.log("Staging JS uses content-fingerprinted filenames to bypass stale PWA caches.");
console.log("Source-map references are stripped from staging bundles to avoid stale-map warnings.");
console.log("Enable only with ?offlineEngine=v2312 or the runtime helper.");
