import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const stagingOut = resolve(root, "dist-staging-v2312");
const out = resolve(root, "dist-refactor-modular");
const coreBuildDir = resolve(root, ".vendify-build/modular-core");
const coreFile = resolve(coreBuildDir, "vendify-core-v232.js");

function fingerprint(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

execFileSync(process.execPath, [resolve(root, "scripts/build-staging-v2312.mjs")], {
  cwd: root,
  stdio: "inherit"
});

await build({ configFile: resolve(root, "vite.modular-core.config.ts") });
if (!existsSync(coreFile)) throw new Error("Modular runtime bridge bundle was not generated");

rmSync(out, { recursive: true, force: true });
cpSync(stagingOut, out, { recursive: true });

const files = readdirSync(out);
const indexPath = resolve(out, "index.html");
let index = readFileSync(indexPath, "utf8");
const stagedAppReferences = [
  ...index.matchAll(/Object\.freeze\(\{ src: "(app-staging-v2312-[0-9a-f]{12}\.js)" \}\)/g)
];
if (stagedAppReferences.length !== 1) {
  throw new Error(`Expected one referenced v2.31.2 staged app, found ${stagedAppReferences.length}`);
}

const oldAppName = stagedAppReferences[0][1];
const oldAppPath = resolve(out, oldAppName);
if (!existsSync(oldAppPath)) throw new Error(`Referenced staged app is missing: ${oldAppName}`);
const app = readFileSync(oldAppPath, "utf8");

const coreContent = readFileSync(coreFile, "utf8");
const coreName = `vendify-core-v232-${fingerprint(coreContent)}.js`;
const appName = `app-refactor-v232-${fingerprint(app)}.js`;

for (const file of files) {
  if (/^(?:app-refactor-v232|vendify-core-v232)-[0-9a-f]{12}\.js$/.test(file)) {
    unlinkSync(resolve(out, file));
  }
}

writeFileSync(resolve(out, coreName), coreContent, "utf8");
writeFileSync(resolve(out, appName), app, "utf8");
unlinkSync(oldAppPath);

const oldEntry = `Object.freeze({ src: "${oldAppName}" })`;
if (!index.includes(oldEntry)) {
  throw new Error("Could not find staged app entry in refactor index");
}
index = index.replace(
  oldEntry,
  `Object.freeze({ src: "${coreName}" }),\n        Object.freeze({ src: "${appName}" })`
);
writeFileSync(indexPath, index, "utf8");

console.log("Vendify modular refactor preview created in dist-refactor-modular/");
console.log("Core, Auth, Team, Dashboard, Purchases, Inventory, Products, Cash, Sales/POS, and Offline compatibility modules load from TypeScript before the compatibility app runtime.");
console.log("The root app compatibility layer is compacted only after browser-validated migrations.");
