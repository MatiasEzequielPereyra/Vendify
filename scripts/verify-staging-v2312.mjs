import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
  "html-loader.js",
  "html/01-auth-shell.html",
  "html/07-cash-sales-modals.html",
  "app.js",
  "styles.css",
  "sw.js",
  "supabase-config.js",
  "manifest.json",
  "vercel.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png"
];

for (const file of required) {
  if (!existsSync(resolve(target, file))) fail(`staging release missing ${file}`);
}
pass("staging release base files exist");

const filenames = readdirSync(target);
function oneFingerprintMatch(pattern, label) {
  const matches = filenames.filter((file) => pattern.test(file));
  if (matches.length !== 1) {
    fail(`${label} expected exactly one fingerprinted file, found ${matches.length}`);
  }
  return matches[0];
}

const runtimeName = oneFingerprintMatch(
  /^vendify-offline-v2312-[0-9a-f]{12}\.js$/,
  "runtime"
);
const coreName = oneFingerprintMatch(
  /^vendify-core-v232-[0-9a-f]{12}\.js$/,
  "modular core"
);
const pendingUiName = oneFingerprintMatch(
  /^vendify-offline-v2312-pending-ui-[0-9a-f]{12}\.js$/,
  "pending sales UI"
);
const stagedAppName = oneFingerprintMatch(
  /^app-staging-v2312-[0-9a-f]{12}\.js$/,
  "staging app"
);
pass("staging browser bundles use content-fingerprinted filenames");

const html = readFileSync(resolve(target, "index.html"), "utf8");
const runtimeMarker = `src: "${runtimeName}"`;
const coreMarker = `src: "${coreName}"`;
const appMarker = `src: "${stagedAppName}"`;
const pendingUiMarker = `src: "${pendingUiName}"`;
const runtimePosition = html.indexOf(runtimeMarker);
const corePosition = html.indexOf(coreMarker);
const appPosition = html.indexOf(appMarker);
const pendingUiPosition = html.indexOf(pendingUiMarker);

if (runtimePosition < 0) fail("v2.31.2 runtime script is not referenced");
if (corePosition < 0) fail("modular core script is not referenced");
if (appPosition < 0) fail("fingerprinted staging app script is not referenced");
if (pendingUiPosition < 0) fail("v2.31.2 pending sales UI script is not referenced");
if (!(runtimePosition < corePosition && corePosition < appPosition && appPosition < pendingUiPosition)) {
  fail("staging scripts must load runtime -> modular core -> staging app -> pending UI");
}
if (html.includes('src: "app.js?v=2311"')) {
  fail("staging index still references cache-prone legacy app.js path");
}
pass("staging scripts load runtime -> modular core -> fingerprinted app -> pending UI");

for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  const ref = match[1];
  if (/^(?:https?:|data:|blob:|#)/.test(ref)) continue;
  const cleaned = ref.split(/[?#]/, 1)[0].replace(/^\.\//, "");
  if (!cleaned || cleaned === "/") continue;
  if (!existsSync(resolve(target, cleaned))) fail(`unresolved staging reference ${cleaned}`);
}
pass("staging local references resolve");

const stagedApp = readFileSync(resolve(target, stagedAppName), "utf8");
const core = readFileSync(resolve(target, coreName), "utf8");
const appMarkers = ["captureStockSnapshot"];
for (const marker of appMarkers) {
  if (!stagedApp.includes(marker)) fail(`staging app missing integration marker ${marker}`);
}
pass("staging app captures the v2.31.2 stock snapshot");

const runtime = readFileSync(resolve(target, runtimeName), "utf8");
const pendingUi = readFileSync(resolve(target, pendingUiName), "utf8");
if (!runtime.includes("vendify-offline-v2312")) {
  fail("staging runtime does not contain IndexedDB database identifier");
}
if (!runtime.includes("vendify_offline_engine_v2312")) {
  fail("staging runtime does not contain v2.31.2 feature flag");
}
if (!runtime.includes("emitir_lease_venta_offline_v1") || !runtime.includes("registrar_venta_offline_v1")) {
  fail("staging runtime does not contain the authoritative offline lease contract");
}
if (!runtime.includes("enqueueLegacySale") || !runtime.includes("syncNow") || !runtime.includes("listSales")) {
  fail("staging runtime does not expose the current POS queue/sync diagnostics API");
}
if (!core.includes("createOfflinePosIntegration") || !core.includes("VendifyOfflineIntegrationV232")) {
  fail("staging app does not contain the typed IndexedDB POS integration");
}
if (!pendingUi.includes("Ventas pendientes") || !pendingUi.includes("Reintentar sincronización")) {
  fail("staging pending sales UI does not contain required controls");
}
pass("staging bundles contain current IndexedDB runtime, typed POS integration and pending-sales UI");

const config = readFileSync(resolve(target, "supabase-config.js"), "utf8");
if (!config.includes("puhkmblnptntorwptvld.supabase.co")) {
  fail("staging release points to unexpected Supabase project");
}
if (/vebqlbcfjxnpryjdgfvq/.test(config)) fail("obsolete Supabase project detected");
if (/SUPABASE_SERVICE_ROLE_KEY\s*=|serviceRoleKey\s*=/.test(runtime + core + stagedApp + pendingUi + config)) {
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
      "supabase-config.js",
      "manifest.json",
      "vercel.json",
      "icons"
    ],
    { cwd: root, stdio: "pipe" }
  );
  pass("backend configuration, manifest and icons still match the frozen baseline");
} catch {
  fail("protected backend configuration, manifest or icons changed");
}

console.log("PASS: Vendify v2.31.2 staging release verified");
