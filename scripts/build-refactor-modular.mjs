import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";
import { patchTeamRefactor } from "./patch-refactor-team.mjs";

const root = resolve(import.meta.dirname, "..");
const stagingOut = resolve(root, "dist-staging-v2312");
const out = resolve(root, "dist-refactor-modular");
const coreBuildDir = resolve(root, ".vendify-build/modular-core");
const coreFile = resolve(coreBuildDir, "vendify-core-v232.js");

function fingerprint(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function replaceExactlyOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Refactor patch ${label} expected 1 match, found ${matches.length}`);
  }

  // Use a replacer callback so replacement text is inserted literally.
  // This is required for helpers such as `$$`: in a normal replacement string,
  // JavaScript interprets `$$` as a single literal `$`.
  return source.replace(pattern, () => replacement);
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
const stagedApps = files.filter((file) => /^app-staging-v2312-[0-9a-f]{12}\.js$/.test(file));
if (stagedApps.length !== 1) {
  throw new Error(`Expected one v2.31.2 staged app, found ${stagedApps.length}`);
}

const oldAppName = stagedApps[0];
const oldAppPath = resolve(out, oldAppName);
let app = readFileSync(oldAppPath, "utf8");

app = patchTeamRefactor(app, replaceExactlyOnce);

const coreContent = readFileSync(coreFile, "utf8");
const coreName = `vendify-core-v232-${fingerprint(coreContent)}.js`;
const appName = `app-refactor-v232-${fingerprint(app)}.js`;

writeFileSync(resolve(out, coreName), coreContent, "utf8");
writeFileSync(resolve(out, appName), app, "utf8");
unlinkSync(oldAppPath);

const indexPath = resolve(out, "index.html");
let index = readFileSync(indexPath, "utf8");
const oldScript = `<script src="${oldAppName}"></script>`;
if (!index.includes(oldScript)) {
  throw new Error("Could not find staged app script in refactor index");
}
index = index.replace(
  oldScript,
  `<script src="${coreName}"></script>\n  <script src="${appName}"></script>`
);
writeFileSync(indexPath, index, "utf8");

console.log("Vendify modular refactor preview created in dist-refactor-modular/");
console.log("Core, Auth, and first Team services are loaded from TypeScript before the compatibility app runtime.");
console.log("The root app compatibility layer is compacted only after browser-validated migrations.");

