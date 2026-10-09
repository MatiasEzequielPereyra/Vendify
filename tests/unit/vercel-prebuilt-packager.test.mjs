import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getSourceTreeStatus,
  packageModularPreview,
  validateBuildOutputConfig
} from "../../scripts/package-vercel-prebuilt-preview.mjs";
import {
  PRODUCTION_SUPABASE_PROJECT_REF,
  renderStagingSupabaseConfig,
  renderStagingVercelConfig
} from "../../scripts/staging-supabase-config.mjs";

const STAGING_REF = "clqxfwiutwnhbejezakw";
const STAGING_CONNECT_TOKENS = `'self' https://${STAGING_REF}.supabase.co wss://${STAGING_REF}.supabase.co https://world.openfoodfacts.org`;
const BASE_SHA = "7d77b7fbcb9eb9b0dc782976078f34d702eb88c1";
const ANON_KEY = `e30.${Buffer.from(JSON.stringify({ role: "anon", ref: STAGING_REF })).toString("base64url")}.synthetic`;
const STAGING = {
  mode: "real",
  url: `https://${STAGING_REF}.supabase.co`,
  anonKey: ANON_KEY,
  projectRef: STAGING_REF
};

const REQUIRED_HEADERS = [
  "Content-Security-Policy",
  "Cache-Control",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Strict-Transport-Security"
];

function rootVercelConfig() {
  return JSON.stringify({
    headers: [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co wss://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co https://world.openfoodfacts.org; worker-src 'self' blob:; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }
        ]
      },
      { source: "/supabase-config.js", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
      { source: "/index.html", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
      { source: "/app.js", headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }] }
    ]
  });
}

async function makeFixture(t, mutate = () => {}) {
  const root = await mkdtemp(join(tmpdir(), "ven008-packager-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifactDir = join(root, "dist-refactor-modular");
  const outputDir = join(root, "ven008-synthetic-output");
  await mkdir(artifactDir, { recursive: true });
  const index = `<!doctype html><script src="vendify-offline-v2312-0123456789ab.js"></script><script src="vendify-core-v232-0123456789ab.js"></script><script src="vendify-app-v232-0123456789ab.js"></script><script src="vendify-offline-v2312-pending-ui-0123456789ab.js"></script>`;
  const files = new Map([
    ["index.html", index],
    ["sw.js", 'const SHELL = ["./vendify-offline-v2312-0123456789ab.js", "./vendify-core-v232-0123456789ab.js", "./vendify-app-v232-0123456789ab.js", "./vendify-offline-v2312-pending-ui-0123456789ab.js"];'],
    ["supabase-config.js", renderStagingSupabaseConfig(STAGING)],
    ["vendify-offline-v2312-0123456789ab.js", "offline"],
    ["vendify-core-v232-0123456789ab.js", "VendifyCoreV232 VendifyAuthV232 VendifyProductsV232 VendifyRealtimeV232 VendifyOfflineCompatV232 VendifyPwaV232"],
    ["vendify-app-v232-0123456789ab.js", "VendifyApplicationV232 typed application entry loaded"],
    ["vendify-offline-v2312-pending-ui-0123456789ab.js", "pending"],
    ["vercel.json", renderStagingVercelConfig(rootVercelConfig(), STAGING)]
  ]);
  for (const [path, content] of files) await writeFile(join(artifactDir, path), content);
  await mutate({ artifactDir, files, outputDir });
  return { artifactDir, outputDir, root };
}

async function packageFixture(t, mutate) {
  const fixture = await makeFixture(t, mutate);
  await packageModularPreview({
    artifactDir: fixture.artifactDir,
    outputDir: fixture.outputDir,
    sourceSha: BASE_SHA,
    sourceTreeStatus: "modified",
    buildCommand: "npm run build:refactor:modular -- --require-backend",
    packageCommand: "node scripts/package-vercel-prebuilt-preview.mjs --backend-source synthetic",
    backendSource: "synthetic"
  });
  return fixture;
}

test("packages byte-identical modular static assets with v3 routes and safe provenance", async (t) => {
  const fixture = await packageFixture(t);
  const repeated = await packageModularPreview({
    artifactDir: fixture.artifactDir,
    outputDir: fixture.outputDir,
    sourceSha: BASE_SHA,
    sourceTreeStatus: "modified",
    buildCommand: "npm run build:refactor:modular -- --require-backend",
    packageCommand: "node scripts/package-vercel-prebuilt-preview.mjs --backend-source synthetic",
    backendSource: "synthetic"
  });
  assert.equal(repeated.reused, true);
  const config = JSON.parse(await readFile(join(fixture.outputDir, "config.json"), "utf8"));
  assert.equal(config.version, 3);
  assert.ok(Array.isArray(config.routes));
  const sourceConfig = JSON.parse(await readFile(join(fixture.artifactDir, "vercel.json"), "utf8"));
  const expectedSources = new Map([
    ["/(.*)", "^(?:/(.*))$"],
    ["/supabase-config.js", "^/supabase-config\\.js$"],
    ["/sw.js", "^/sw\\.js$"],
    ["/index.html", "^/index\\.html$"],
    ["/app.js", "^/app\\.js$"]
  ]);
  assert.deepEqual(config.routes, sourceConfig.headers.map((rule) => ({
    src: expectedSources.get(rule.source),
    headers: Object.fromEntries(rule.headers.map(({ key, value }) => [key, value])),
    continue: true
  })));
  assert.ok(config.routes.some((route) => Object.keys(route.headers ?? {}).some((name) => name.toLowerCase() === "content-security-policy")));
  assert.ok(config.routes.every((route) => route.continue === true || route.handle));
  for (const name of REQUIRED_HEADERS) {
    const lower = name.toLowerCase();
    assert.ok(config.routes.some((route) => Object.keys(route.headers ?? {}).some((key) => key.toLowerCase() === lower)), `${name} route missing`);
  }
  const manifest = JSON.parse(await readFile(join(fixture.outputDir, "ven008-provenance.json"), "utf8"));
  assert.equal(manifest.sourceSha, BASE_SHA);
  assert.equal(manifest.sourceTreeStatus, "modified");
  assert.equal(manifest.backendProjectRef, STAGING_REF);
  assert.equal(manifest.backendSource, "synthetic");
  assert.equal(manifest.deployable, false);
  assert.equal(manifest.backendVerification, "synthetic-local-only");
  assert.ok(manifest.assets.some((asset) => asset.path === "vendify-app-v232-0123456789ab.js" && /^[a-f0-9]{64}$/u.test(asset.sha256)));
  assert.equal(JSON.stringify(manifest).includes(ANON_KEY), false);
  assert.equal(JSON.stringify(config).includes(PRODUCTION_SUPABASE_PROJECT_REF), false);
  assert.equal(await readFile(join(fixture.artifactDir, "vendify-app-v232-0123456789ab.js"), "utf8"), await readFile(join(fixture.outputDir, "static", "vendify-app-v232-0123456789ab.js"), "utf8"));
  assert.equal(await readFile(join(fixture.outputDir, "static", "vercel.json")).catch(() => null), null);
});

test("keeps synthetic packages out of .vercel/output", async (t) => {
  const fixture = await makeFixture(t);
  for (const deployableDir of [join(fixture.root, ".vercel", "output"), join(fixture.root, ".VERCEL", "OUTPUT")]) {
    await assert.rejects(packageModularPreview({
      artifactDir: fixture.artifactDir,
      outputDir: deployableDir,
      sourceSha: BASE_SHA,
      sourceTreeStatus: "modified",
      buildCommand: "fixture",
      packageCommand: "fixture",
      backendSource: "synthetic"
    }), /synthetic.*local|deployable.*output/iu);
    assert.equal(await readFile(join(deployableDir, "config.json")).catch(() => null), null);
  }
});

test("rejects a staging gateway HTTP 401 response without creating deployable output", async (t) => {
  const fixture = await makeFixture(t);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("unauthorized", { status: 401 });
  t.after(() => { globalThis.fetch = oldFetch; });
  await assert.rejects(packageModularPreview({
    artifactDir: fixture.artifactDir,
    outputDir: join(fixture.root, ".vercel", "output"),
    sourceSha: BASE_SHA,
    sourceTreeStatus: "clean",
    buildCommand: "fixture",
    packageCommand: "fixture",
    backendSource: "provided-environment"
  }), /HTTP 401/iu);
  assert.equal(await readFile(join(fixture.root, ".vercel", "output", "config.json")).catch(() => null), null);
});

test("rejects a staging gateway network error without creating deployable output", async (t) => {
  const fixture = await makeFixture(t);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("network unavailable"); };
  t.after(() => { globalThis.fetch = oldFetch; });
  await assert.rejects(packageModularPreview({
    artifactDir: fixture.artifactDir,
    outputDir: join(fixture.root, ".vercel", "output"),
    sourceSha: BASE_SHA,
    sourceTreeStatus: "clean",
    buildCommand: "fixture",
    packageCommand: "fixture",
    backendSource: "provided-environment"
  }), /authorization could not be verified/iu);
  assert.equal(await readFile(join(fixture.root, ".vercel", "output", "config.json")).catch(() => null), null);
});

test("rejects a redirected staging gateway response", async (t) => {
  const fixture = await makeFixture(t);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const response = new Response("healthy", { status: 200 });
    Object.defineProperty(response, "redirected", { value: true });
    return response;
  };
  t.after(() => { globalThis.fetch = oldFetch; });
  await assert.rejects(packageModularPreview({
    artifactDir: fixture.artifactDir,
    outputDir: join(fixture.root, ".vercel", "output"),
    sourceSha: BASE_SHA,
    sourceTreeStatus: "clean",
    buildCommand: "fixture",
    packageCommand: "fixture",
    backendSource: "provided-environment"
  }), /redirected/iu);
  assert.equal(await readFile(join(fixture.root, ".vercel", "output", "config.json")).catch(() => null), null);
});

test("rejects provided-environment output from a modified source tree before probing", async (t) => {
  const fixture = await makeFixture(t);
  const oldFetch = globalThis.fetch;
  let probed = false;
  globalThis.fetch = async () => { probed = true; return new Response("healthy", { status: 200 }); };
  t.after(() => { globalThis.fetch = oldFetch; });
  await assert.rejects(packageModularPreview({
    artifactDir: fixture.artifactDir,
    outputDir: join(fixture.root, ".vercel", "output"),
    sourceSha: BASE_SHA,
    sourceTreeStatus: "modified",
    buildCommand: "fixture",
    packageCommand: "fixture",
    backendSource: "provided-environment"
  }), /requires a clean source tree/iu);
  assert.equal(probed, false);
  assert.equal(await readFile(join(fixture.root, ".vercel", "output", "config.json")).catch(() => null), null);
});

test("marks clean provided-environment output deployable after gateway HTTP 200", async (t) => {
  const fixture = await makeFixture(t);
  const oldFetch = globalThis.fetch;
  let probedUrl;
  globalThis.fetch = async (url, options) => {
    probedUrl = String(url);
    assert.equal(options.method, "GET");
    assert.deepEqual(options.headers, { apikey: ANON_KEY });
    assert.equal(options.redirect, "error");
    return new Response("healthy", { status: 200 });
  };
  t.after(() => { globalThis.fetch = oldFetch; });
  const result = await packageModularPreview({
    artifactDir: fixture.artifactDir,
    outputDir: join(fixture.root, ".vercel", "output"),
    sourceSha: BASE_SHA,
    sourceTreeStatus: "clean",
    buildCommand: "fixture",
    packageCommand: "fixture",
    backendSource: "provided-environment"
  });
  assert.equal(probedUrl, `${STAGING.url}/auth/v1/health`);
  assert.equal(result.provenance.deployable, true);
  assert.equal(result.provenance.sourceTreeStatus, "clean");
  assert.equal(result.provenance.backendVerification, "staging-auth-health-accepted");
});

test("reuses identical output and rejects changed source assets", async (t) => {
  const fixture = await packageFixture(t);
  await writeFile(join(fixture.artifactDir, "vendify-app-v232-0123456789ab.js"), "changed typed bundle");
  await assert.rejects(packageModularPreview({
    artifactDir: fixture.artifactDir,
    outputDir: fixture.outputDir,
    sourceSha: BASE_SHA,
    sourceTreeStatus: "modified",
    buildCommand: "npm run build:refactor:modular -- --require-backend",
    packageCommand: "node scripts/package-vercel-prebuilt-preview.mjs --backend-source=synthetic",
    backendSource: "synthetic"
  }), /differs from the deterministic package/iu);
});

test("excludes generated output from Git source-tree provenance", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ven008-git-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: root });
  execFileSync("git", ["-c", "user.name=VEN-008", "-c", "user.email=ven008@example.invalid", "commit", "--allow-empty", "-m", "fixture", "--quiet"], { cwd: root });
  const output = join(root, ".vercel", "output");
  assert.equal(getSourceTreeStatus(root, output), "clean");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "config.json"), "generated");
  const localGenerated = join(root, ".ven008");
  await mkdir(join(localGenerated, "synthetic-output-prior"), { recursive: true });
  await writeFile(join(localGenerated, "synthetic-output-prior", "config.json"), "synthetic output");
  assert.equal(getSourceTreeStatus(root, [output, localGenerated]), "clean");
  await writeFile(join(root, "source.txt"), "real source change");
  assert.equal(getSourceTreeStatus(root, [output, localGenerated]), "modified");
});

test("rejects permissive and unauthorized CSP connect-src values", async (t) => {
  for (const source of [
    `${STAGING_CONNECT_TOKENS} *`,
    `${STAGING_CONNECT_TOKENS} https://other-project.supabase.co`,
    "https: wss:"
  ]) {
    const fixture = await makeFixture(t, async ({ artifactDir }) => {
      const config = JSON.parse(await readFile(join(artifactDir, "vercel.json"), "utf8"));
      const csp = config.headers[0].headers.find((header) => header.key.toLowerCase() === "content-security-policy");
      csp.value = csp.value.replace(/connect-src\s+[^;]+/u, `connect-src ${source}`);
      await writeFile(join(artifactDir, "vercel.json"), JSON.stringify(config));
    });
    await assert.rejects(packageModularPreview({
      artifactDir: fixture.artifactDir,
      outputDir: fixture.outputDir,
      sourceSha: BASE_SHA,
      sourceTreeStatus: "clean",
      buildCommand: "fixture",
      packageCommand: "fixture",
      backendSource: "synthetic"
    }), /CSP|connect-src/iu);
  }
});

test("requires CSP coverage for document, service worker, config and bundles", async (t) => {
  const fixture = await makeFixture(t, async ({ artifactDir }) => {
    const config = JSON.parse(await readFile(join(artifactDir, "vercel.json"), "utf8"));
    config.headers[0].source = "/private-only";
    await writeFile(join(artifactDir, "vercel.json"), JSON.stringify(config));
  });
  await assert.rejects(packageModularPreview({
    artifactDir: fixture.artifactDir,
    outputDir: fixture.outputDir,
    sourceSha: BASE_SHA,
    sourceTreeStatus: "clean",
    buildCommand: "fixture",
    packageCommand: "fixture",
    backendSource: "synthetic"
  }), /CSP.*cover|coverage/iu);
});

test("rejects a production Supabase backend", async (t) => {
  await assert.rejects(makeFixture(t, async ({ artifactDir }) => {
    const production = { ...STAGING, url: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`, projectRef: PRODUCTION_SUPABASE_PROJECT_REF };
    await writeFile(join(artifactDir, "supabase-config.js"), renderStagingSupabaseConfig(production));
  }).then(({ artifactDir, outputDir }) => packageModularPreview({ artifactDir, outputDir, sourceSha: BASE_SHA, sourceTreeStatus: "clean", buildCommand: "fixture", packageCommand: "fixture", backendSource: "synthetic" })), /production Supabase/iu);
});

test("rejects an incorrect or production-connected CSP", async (t) => {
  const fixture = await makeFixture(t, async ({ artifactDir }) => {
    const config = JSON.parse(await readFile(join(artifactDir, "vercel.json"), "utf8"));
    config.headers[0].headers[0].value = "default-src 'unsafe-inline'";
    await writeFile(join(artifactDir, "vercel.json"), JSON.stringify(config));
  });
  await assert.rejects(packageModularPreview({ artifactDir: fixture.artifactDir, outputDir: fixture.outputDir, sourceSha: BASE_SHA, sourceTreeStatus: "clean", buildCommand: "fixture", packageCommand: "fixture", backendSource: "synthetic" }), /CSP/iu);
});

test("rejects an unnecessarily permissive CSP directive", async (t) => {
  const fixture = await makeFixture(t, async ({ artifactDir }) => {
    const config = JSON.parse(await readFile(join(artifactDir, "vercel.json"), "utf8"));
    const csp = config.headers[0].headers.find((header) => header.key.toLowerCase() === "content-security-policy");
    csp.value = csp.value.replace("object-src 'none'", "object-src 'self'");
    await writeFile(join(artifactDir, "vercel.json"), JSON.stringify(config));
  });
  await assert.rejects(packageModularPreview({ artifactDir: fixture.artifactDir, outputDir: fixture.outputDir, sourceSha: BASE_SHA, sourceTreeStatus: "clean", buildCommand: "fixture", packageCommand: "fixture", backendSource: "synthetic" }), /CSP object-src/iu);
});

test("rejects a legacy app.js runtime", async (t) => {
  const fixture = await makeFixture(t, async ({ artifactDir }) => writeFile(join(artifactDir, "app.js"), "legacy"));
  await assert.rejects(packageModularPreview({ artifactDir: fixture.artifactDir, outputDir: fixture.outputDir, sourceSha: BASE_SHA, sourceTreeStatus: "clean", buildCommand: "fixture", packageCommand: "fixture", backendSource: "synthetic" }), /legacy|app\.js/iu);
});

test("rejects required files missing from the modular artifact", async (t) => {
  const fixture = await makeFixture(t, async ({ artifactDir }) => rm(join(artifactDir, "sw.js")));
  await assert.rejects(packageModularPreview({ artifactDir: fixture.artifactDir, outputDir: fixture.outputDir, sourceSha: BASE_SHA, sourceTreeStatus: "clean", buildCommand: "fixture", packageCommand: "fixture", backendSource: "synthetic" }), /sw\.js/iu);
});

test("rejects invalid Build Output API config before writing output", async (t) => {
  assert.throws(() => validateBuildOutputConfig({ version: 2, routes: [] }), /Build Output API/iu);
  assert.throws(() => validateBuildOutputConfig({ version: 3, routes: [{ headers: { "bad header": "x" } }] }), /Build Output API/iu);
  assert.throws(() => validateBuildOutputConfig({ version: 3, routes: [{ src: "[", continue: true }] }), /Build Output API/iu);
});
