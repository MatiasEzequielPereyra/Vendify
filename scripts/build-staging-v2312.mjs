import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "dist-staging-v2312");
const runtimeBuildDir = resolve(root, ".vendify-build/v2312");
const bridgeBuildDir = resolve(root, ".vendify-build/v2312-bridge");
const pendingUiBuildDir = resolve(root, ".vendify-build/v2312-pending-ui");
const runtimeFile = resolve(runtimeBuildDir, "vendify-offline-v2312.js");
const bridgeFile = resolve(bridgeBuildDir, "vendify-offline-v2312-bridge.js");
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
  configFile: resolve(root, "vite.offline-v2312-bridge.config.ts")
});
await build({
  configFile: resolve(root, "vite.offline-v2312-pending-ui.config.ts")
});

for (const file of [runtimeFile, bridgeFile, pendingUiFile]) {
  if (!existsSync(file)) {
    throw new Error(`v2.31.2 bundle was not generated: ${file}`);
  }
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

function replaceExactlyOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Staging patch ${label} expected 1 match, found ${matches.length}`);
  }
  return source.replace(pattern, replacement);
}

let stagedApp = readFileSync(resolve(root, "app.js"), "utf8");

stagedApp = replaceExactlyOnce(
  stagedApp,
  /const localTicket =\s+registrarVentaOfflineV2311\(\s+carrito,\s+pagos,\s+totales,\s+\$\("#venta-observacion-v228"\)\s+\.value\.trim\(\)\s+\);/g,
  `const localTicket =\n        window.VendifyOfflineV2312?.enabled &&\n        typeof window.registrarVentaOfflineIndexedDbV2312 === "function"\n          ? await window.registrarVentaOfflineIndexedDbV2312(\n              carrito,\n              pagos,\n              totales,\n              $("#venta-observacion-v228").value.trim()\n            )\n          : registrarVentaOfflineV2311(\n              carrito,\n              pagos,\n              totales,\n              $("#venta-observacion-v228").value.trim()\n            );`,
  "offline checkout"
);

stagedApp = replaceExactlyOnce(
  stagedApp,
  /async function sincronizarVentasOfflineV2311\(\{\s+mostrarResumen = false,\s+incluirRevision = false,\s+\} = \{\}\) \{\s+if \(!navigator\.onLine\) \{/g,
  `async function sincronizarVentasOfflineV2311({\n  mostrarResumen = false,\n  incluirRevision = false,\n} = {}) {\n  if (\n    window.VendifyOfflineV2312?.enabled &&\n    typeof window.sincronizarVentasOfflineIndexedDbV2312 === "function"\n  ) {\n    return window.sincronizarVentasOfflineIndexedDbV2312({\n      mostrarResumen,\n      incluirRevision,\n    });\n  }\n\n  if (!navigator.onLine) {`,
  "offline sync routing"
);

const runtimeContent = stripSourceMapReference(readFileSync(runtimeFile, "utf8"));
const bridgeContent = stripSourceMapReference(readFileSync(bridgeFile, "utf8"));
const pendingUiContent = stripSourceMapReference(readFileSync(pendingUiFile, "utf8"));
const appHash = fingerprint(stagedApp);
const runtimeHash = fingerprint(runtimeContent);
const bridgeHash = fingerprint(bridgeContent);
const pendingUiHash = fingerprint(pendingUiContent);

const stagedAppName = `app-staging-v2312-${appHash}.js`;
const runtimeName = `vendify-offline-v2312-${runtimeHash}.js`;
const bridgeName = `vendify-offline-v2312-bridge-${bridgeHash}.js`;
const pendingUiName = `vendify-offline-v2312-pending-ui-${pendingUiHash}.js`;

writeFileSync(resolve(out, stagedAppName), stagedApp, "utf8");
writeFileSync(resolve(out, runtimeName), runtimeContent, "utf8");
writeFileSync(resolve(out, bridgeName), bridgeContent, "utf8");
writeFileSync(resolve(out, pendingUiName), pendingUiContent, "utf8");

const indexPath = resolve(out, "index.html");
const index = readFileSync(indexPath, "utf8");
const appScript = '<script src="app.js?v=2311"></script>';
const runtimeScript = `<script src="${runtimeName}"></script>`;
const stagedAppScript = `<script src="${stagedAppName}"></script>`;
const bridgeScript = `<script src="${bridgeName}"></script>`;
const pendingUiScript = `<script src="${pendingUiName}"></script>`;

if (!index.includes(appScript)) {
  throw new Error("Cannot inject v2.31.2 runtime: expected app.js marker was not found");
}

const stagedIndex = index.replace(
  appScript,
  `${runtimeScript}\n  ${stagedAppScript}\n  ${bridgeScript}\n  ${pendingUiScript}`
);
writeFileSync(indexPath, stagedIndex, "utf8");

console.log("Vendify v2.31.2 staging release created in dist-staging-v2312/");
console.log("IndexedDB checkout, snapshot capture, sync routing and pending-sales UI are staging-only.");
console.log("Staging JS uses content-fingerprinted filenames to bypass stale PWA caches.");
console.log("Source-map references are stripped from staging bundles to avoid stale-map warnings.");
console.log("Enable only with ?offlineEngine=v2312 or the runtime helper.");
