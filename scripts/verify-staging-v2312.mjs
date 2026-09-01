import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "dist-staging-v2312");
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};
const pass = (message) => console.log(`PASS: ${message}`);

const required = [
  "index.html",
  "app.js",
  "styles.css",
  "sw.js",
  "supabase-config.js",
  "manifest.json",
  "vercel.json",
  "vendify-offline-v2312.js",
  "vendify-offline-v2312-bridge.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png"
];

for (const file of required) {
  if (!existsSync(resolve(target, file))) fail(`staging release missing ${file}`);
}
pass("staging release files exist");

const html = readFileSync(resolve(target, "index.html"), "utf8");
const runtimeMarker = 'src="vendify-offline-v2312.js?v=2312"';
const appMarker = 'src="app.js?v=2311"';
const bridgeMarker = 'src="vendify-offline-v2312-bridge.js?v=2312"';
const runtimePosition = html.indexOf(runtimeMarker);
const appPosition = html.indexOf(appMarker);
const bridgePosition = html.indexOf(bridgeMarker);

if (runtimePosition < 0) fail("v2.31.2 runtime script is not referenced");
if (appPosition < 0) fail("legacy app.js script is not referenced");
if (bridgePosition < 0) fail("v2.31.2 POS bridge script is not referenced");
if (!(runtimePosition < appPosition && appPosition < bridgePosition)) {
  fail("staging scripts must load runtime -> app.js -> POS bridge");
}
pass("staging scripts load runtime -> legacy app -> POS bridge");

for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  const ref = match[1];
  if (/^(?:https?:|data:|blob:|#)/.test(ref)) continue;
  const cleaned = ref.split(/[?#]/, 1)[0].replace(/^\.\//, "");
  if (!cleaned || cleaned === "/") continue;
  if (!existsSync(resolve(target, cleaned))) fail(`unresolved staging reference ${cleaned}`);
}
pass("staging local references resolve");

const stagedApp = readFileSync(resolve(target, "app.js"), "utf8");
const appMarkers = [
  "registrarVentaOfflineIndexedDbV2312",
  "captureStockSnapshot",
  "sincronizarVentasOfflineIndexedDbV2312"
];
for (const marker of appMarkers) {
  if (!stagedApp.includes(marker)) fail(`staging app.js missing integration marker ${marker}`);
}
pass("staging app routes checkout, stock snapshot and sync to v2.31.2");

const runtime = readFileSync(resolve(target, "vendify-offline-v2312.js"), "utf8");
const bridge = readFileSync(resolve(target, "vendify-offline-v2312-bridge.js"), "utf8");
if (!runtime.includes("vendify-offline-v2312")) {
  fail("staging runtime does not contain IndexedDB database identifier");
}
if (!runtime.includes("vendify_offline_engine_v2312")) {
  fail("staging runtime does not contain v2.31.2 feature flag");
}
if (!runtime.includes("enqueueLegacySale") || !runtime.includes("syncNow")) {
  fail("staging runtime does not expose the POS queue/sync API");
}
if (!bridge.includes("registrarVentaOfflineIndexedDbV2312")) {
  fail("staging bridge does not contain IndexedDB checkout integration");
}
pass("staging bundles contain IndexedDB runtime and POS bridge");

const config = readFileSync(resolve(target, "supabase-config.js"), "utf8");
if (!config.includes("puhkmblnptntorwptvld.supabase.co")) {
  fail("staging release points to unexpected Supabase project");
}
if (/vebqlbcfjxnpryjdgfvq/.test(config)) fail("obsolete Supabase project detected");
if (/SUPABASE_SERVICE_ROLE_KEY\s*=|serviceRoleKey\s*=/.test(runtime + bridge + config)) {
  fail("service role assignment detected in staging browser files");
}
pass("staging browser security markers pass");

try {
  execFileSync(
    "git",
    [
      "diff",
      "--quiet",
      "v2.31.1-production-baseline",
      "--",
      "index.html",
      "app.js",
      "styles.css",
      "sw.js",
      "supabase-config.js",
      "manifest.json",
      "vercel.json",
      "icons"
    ],
    { cwd: root, stdio: "pipe" }
  );
  pass("root production runtime still matches frozen v2.31.1 baseline");
} catch {
  fail("root production runtime changed during staging-only integration");
}

console.log("PASS: Vendify v2.31.2 staging release verified");
