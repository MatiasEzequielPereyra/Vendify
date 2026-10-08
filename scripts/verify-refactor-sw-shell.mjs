import {
  existsSync,
  readFileSync,
  readdirSync
} from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "dist-refactor-modular");
const swPath = resolve(root, "sw.js");

if (!existsSync(swPath)) {
  throw new Error("Modular Service Worker is missing");
}

const source = readFileSync(swPath, "utf8");
const shellMatch = source.match(
  /const\s+SHELL\s*=\s*\[([\s\S]*?)\];/u
);
if (!shellMatch) {
  throw new Error("Could not locate modular Service Worker SHELL");
}

const shell = [...shellMatch[1].matchAll(/["'](\.\/[^"']+)["']/gu)]
  .map((match) => match[1]);

if (shell.length === 0) {
  throw new Error("Modular Service Worker SHELL is empty");
}

const missing = shell.filter((entry) => {
  const relative = entry.replace(/^\.\//u, "");
  return !existsSync(resolve(root, relative));
});
if (missing.length > 0) {
  throw new Error(
    `Modular Service Worker references missing shell assets: ${missing.join(", ")}`
  );
}

if (shell.includes("./app.js")) {
  throw new Error("Modular Service Worker still precaches app.js");
}

const files = readdirSync(root);
const typedApps = files.filter(
  (file) => /^vendify-app-v232-[0-9a-f]{12}\.js$/u.test(file)
);
if (typedApps.length !== 1) {
  throw new Error(
    `Expected exactly one typed application bundle, found ${typedApps.length}`
  );
}
if (!shell.includes(`./${typedApps[0]}`)) {
  throw new Error("Typed application bundle is not part of the offline shell");
}

for (const pattern of [
  /^vendify-offline-v2312-[0-9a-f]{12}\.js$/u,
  /^vendify-core-v232-[0-9a-f]{12}\.js$/u,
  /^vendify-offline-v2312-pending-ui-[0-9a-f]{12}\.js$/u
]) {
  const file = files.find((candidate) => pattern.test(candidate));
  if (!file || !shell.includes(`./${file}`)) {
    throw new Error(
      `Required modular runtime asset missing from Service Worker shell: ${String(pattern)}`
    );
  }
}

console.log(
  `PASS: modular Service Worker shell contains ${String(shell.length)} existing assets and the typed application runtime`
);
