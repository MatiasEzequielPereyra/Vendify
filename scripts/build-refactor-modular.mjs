import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";
import {
  resolveStagingSupabaseConfig,
  stagingExpectedProjectRef
} from "./staging-supabase-config.mjs";

const root = resolve(import.meta.dirname, "..");
const stagingOut = resolve(root, "dist-staging-v2312");
const out = resolve(root, "dist-refactor-modular");
const typedBuildDir = resolve(root, ".vendify-build/refactor-app");
const typedBuildFile = resolve(typedBuildDir, "vendify-app-v232.js");
const requireBackend = process.argv.includes("--require-backend");
const stagingConfig = resolveStagingSupabaseConfig(
  process.env,
  { requireBackend }
);
const expectedProjectRef = stagingExpectedProjectRef(stagingConfig);

function fingerprint(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function stripSourceMapReference(content) {
  return content.replace(
    /\n?\/\/# sourceMappingURL=.*(?:\r?\n)?$/u,
    "\n"
  );
}

const stagingArgs = [
  resolve(root, "scripts/build-staging-v2312.mjs")
];
if (requireBackend) stagingArgs.push("--require-backend");

execFileSync(process.execPath, stagingArgs, {
  cwd: root,
  stdio: "inherit"
});

await build({
  configFile: resolve(root, "vite.refactor-app.config.ts"),
  define: {
    __VENDIFY_EXPECTED_SUPABASE_REF__: JSON.stringify(
      expectedProjectRef
    )
  }
});

if (!existsSync(typedBuildFile)) {
  throw new Error(
    `Typed application bundle was not generated: ${typedBuildFile}`
  );
}

rmSync(out, { recursive: true, force: true });
cpSync(stagingOut, out, { recursive: true });

const indexPath = resolve(out, "index.html");
let index = readFileSync(indexPath, "utf8");
const stagedAppReferences = [
  ...index.matchAll(
    /Object\.freeze\(\{ src: "(app-staging-v2312-[0-9a-f]{12}\.js)" \}\)/gu
  )
];
const coreReferences = [
  ...index.matchAll(
    /Object\.freeze\(\{ src: "(vendify-core-v232-[0-9a-f]{12}\.js)" \}\)/gu
  )
];
const offlineReferences = [
  ...index.matchAll(
    /Object\.freeze\(\{ src: "(vendify-offline-v2312-[0-9a-f]{12}\.js)" \}\)/gu
  )
];
const pendingUiReferences = [
  ...index.matchAll(
    /Object\.freeze\(\{ src: "(vendify-offline-v2312-pending-ui-[0-9a-f]{12}\.js)" \}\)/gu
  )
];

if (stagedAppReferences.length !== 1) {
  throw new Error(
    `Expected one staging application marker, found ${stagedAppReferences.length}`
  );
}
if (coreReferences.length !== 1) {
  throw new Error(
    `Expected one referenced modular core, found ${coreReferences.length}`
  );
}
if (offlineReferences.length !== 1) {
  throw new Error(
    `Expected one referenced offline runtime, found ${offlineReferences.length}`
  );
}
if (pendingUiReferences.length !== 1) {
  throw new Error(
    `Expected one referenced pending offline UI, found ${pendingUiReferences.length}`
  );
}

const stagedAppName = stagedAppReferences[0]?.[1];
const coreName = coreReferences[0]?.[1];
const offlineName = offlineReferences[0]?.[1];
const pendingUiName = pendingUiReferences[0]?.[1];

for (const name of [stagedAppName, coreName, offlineName, pendingUiName]) {
  if (!name || !existsSync(resolve(out, name))) {
    throw new Error(`Referenced staging asset is missing: ${name ?? "unknown"}`);
  }
}

const typedSource = stripSourceMapReference(
  readFileSync(typedBuildFile, "utf8")
);
const typedName =
  `vendify-app-v232-${fingerprint(typedSource)}.js`;
writeFileSync(resolve(out, typedName), typedSource, "utf8");

const stagedEntry =
  `Object.freeze({ src: "${stagedAppName}" })`;
if (!index.includes(stagedEntry)) {
  throw new Error(
    "Could not find staging application marker in modular index"
  );
}
index = index.replace(
  stagedEntry,
  `Object.freeze({ src: "${typedName}" })`
);
writeFileSync(indexPath, index, "utf8");

unlinkSync(resolve(out, stagedAppName));
const copiedAppPath = resolve(out, "app.js");
if (existsSync(copiedAppPath)) unlinkSync(copiedAppPath);

for (const file of readdirSync(out)) {
  if (/^app-staging-v2312-[0-9a-f]{12}\.js$/u.test(file)) {
    unlinkSync(resolve(out, file));
  }
}

const swPath = resolve(out, "sw.js");
let serviceWorker = readFileSync(swPath, "utf8");
const legacyShellEntry = '  "./app.js",';
if (!serviceWorker.includes(legacyShellEntry)) {
  throw new Error(
    "Cannot render modular Service Worker: app.js shell marker missing"
  );
}

const modularShellEntries = [
  offlineName,
  coreName,
  typedName,
  pendingUiName
].map((name) => `  "./${name}",`).join("\n");

serviceWorker = serviceWorker.replace(
  legacyShellEntry,
  modularShellEntries
);
writeFileSync(swPath, serviceWorker, "utf8");

console.log(
  "Vendify modular refactor preview created in dist-refactor-modular/"
);
console.log(
  `Typed application entry: ${typedName}`
);
console.log(
  `Expected Supabase project ref: ${expectedProjectRef}`
);
console.log(
  "Runtime order: Offline -> modular core -> typed application -> pending offline UI."
);
console.log(
  "Compatibility app.js is not copied, referenced, or required by the modular candidate."
);
