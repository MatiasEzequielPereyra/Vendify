import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeLineEndings } from "./text-normalization.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const target = process.argv[2] ? resolve(projectRoot, process.argv[2]) : projectRoot;
const modules = [
  "styles/01-foundation.css",
  "styles/02-auth-team.css",
  "styles/03-products-scanner.css",
  "styles/04-navigation-settings.css",
  "styles/05-sales-cash.css",
  "styles/06-brand-realtime.css",
  "styles/07-pos-inventory.css",
  "styles/08-purchases-stock.css",
  "styles/09-stability-forms.css",
  "styles/10-commercial-offline.css"
];
const validatedMonolithSha256 = "b7556eaa88d0c9be098a1961fd2cf2899580297433deaf14021c5423f65a53c3";

function fail(message) {
  throw new Error(`Modular CSS verification failed: ${message}`);
}

for (const file of ["index.html", "styles.css", "sw.js", ...modules]) {
  if (!existsSync(resolve(target, file))) fail(`missing ${file}`);
}

const entry = readFileSync(resolve(target, "styles.css"), "utf8");
const imports = [...entry.matchAll(/@import\s+url\(["']\.\/(styles\/[^"']+)["']\);/g)]
  .map((match) => match[1]);
if (JSON.stringify(imports) !== JSON.stringify(modules)) {
  fail("styles.css compatibility imports changed order");
}
if (Buffer.byteLength(entry) > 2000) fail("styles.css became a monolith again");

const html = readFileSync(resolve(target, "index.html"), "utf8");
if (/href=["']styles\.css(?:[?"'])/.test(html)) {
  fail("index.html loads the compatibility entrypoint instead of parallel modules");
}
const linkedModules = [...html.matchAll(/<link\s+rel=["']stylesheet["']\s+href=["'](styles\/[^?"']+)/g)]
  .map((match) => match[1]);
if (JSON.stringify(linkedModules) !== JSON.stringify(modules)) {
  fail("index.html modular styles are missing or out of cascade order");
}

const combined = modules
  .map((file) => readFileSync(resolve(target, file), "utf8"))
  .join("");
// Git may check text files out as CRLF on Windows. The cascade is unchanged,
// so verify normalized text instead of platform-specific line-ending bytes.
const normalizedCombined = normalizeLineEndings(combined);
const combinedSha = createHash("sha256").update(normalizedCombined).digest("hex");
if (combinedSha !== validatedMonolithSha256) {
  fail(`cascade content changed (${combinedSha})`);
}
if (!normalizedCombined.includes("producto-row-v223")) fail("active product row styles are missing");

const serviceWorker = readFileSync(resolve(target, "sw.js"), "utf8");
if (!serviceWorker.includes('vendify-shell-v232-html')) fail("service worker shell cache was not bumped");
for (const file of modules) {
  if (!serviceWorker.includes(`./${file}`)) fail(`service worker does not cache ${file}`);
}

console.log("PASS: modular CSS preserves the exact validated cascade and loads in parallel");
