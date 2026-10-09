import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getTransformedRoutes } from "@vercel/routing-utils";
import {
  inspectRenderedStagingSupabaseConfig,
  PRODUCTION_SUPABASE_PROJECT_REF
} from "./staging-supabase-config.mjs";
import { assertNoModularLegacyRuntime } from "./refactor-verifier-contracts.mjs";

export const EXPECTED_STAGING_SUPABASE_PROJECT_REF = "clqxfwiutwnhbejezakw";
export const REQUIRED_SECURITY_HEADERS = Object.freeze([
  "content-security-policy",
  "cache-control",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
  "strict-transport-security"
]);

const REQUIRED_CSP_DIRECTIVES = Object.freeze([
  "default-src",
  "script-src",
  "style-src",
  "font-src",
  "img-src",
  "connect-src",
  "worker-src",
  "media-src",
  "frame-src",
  "object-src",
  "base-uri",
  "form-action",
  "frame-ancestors"
]);
const ALLOWED_CONNECT_SOURCES = Object.freeze([
  "'self'",
  `https://${EXPECTED_STAGING_SUPABASE_PROJECT_REF}.supabase.co`,
  `wss://${EXPECTED_STAGING_SUPABASE_PROJECT_REF}.supabase.co`,
  "https://world.openfoodfacts.org"
]);
const EXPECTED_CSP_SOURCES = Object.freeze({
  "default-src": ["'self'"],
  "script-src": ["'self'", "https://cdn.jsdelivr.net"],
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
  "img-src": ["'self'", "data:", "blob:"],
  "connect-src": ALLOWED_CONNECT_SOURCES,
  "worker-src": ["'self'", "blob:"],
  "media-src": ["'self'", "blob:"],
  "frame-src": ["'none'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"]
});
const OUTPUT_API_CONFIG_FILENAME = "config.json";
const PROVENANCE_FILENAME = "ven008-provenance.json";
const APP_BUNDLE_PATTERN = /^vendify-app-v232-[0-9a-f]{12}\.js$/u;

function fail(message) {
  throw new Error(message);
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
}

function assertSafeText(value, name) {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${name} must be a non-empty string without control characters`);
  }
}

export function validateBuildOutputConfig(config) {
  assertPlainObject(config, "Build Output API config");
  if (config.version !== 3) fail("Build Output API config must use version 3");
  if (!Array.isArray(config.routes)) fail("Build Output API config routes must be an array");

  for (const [index, route] of config.routes.entries()) {
    assertPlainObject(route, `Build Output API route ${index}`);
    if (typeof route.handle === "string") {
      if (!new Set(["rewrite", "filesystem", "resource", "miss", "hit", "error"]).has(route.handle)) {
        fail(`Build Output API route ${index} has an invalid handler`);
      }
      continue;
    }
    if (typeof route.src !== "string" || !route.src) {
      fail(`Build Output API route ${index} is missing src`);
    }
    try {
      new RegExp(route.src, "u");
    } catch {
      fail(`Build Output API route ${index} has an invalid src expression`);
    }
    if (route.continue !== true) {
      fail(`Build Output API route ${index} must continue so overlapping headers are preserved`);
    }
    if (route.headers !== undefined) {
      assertPlainObject(route.headers, `Build Output API route ${index} headers`);
      for (const [name, value] of Object.entries(route.headers)) {
        if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/iu.test(name) || typeof value !== "string" || /[\r\n]/u.test(value)) {
          fail(`Build Output API route ${index} contains an invalid response header`);
        }
      }
    }
  }
  return true;
}

export function getSourceTreeStatus(projectRoot, generatedOutputDir) {
  const root = resolve(projectRoot);
  const generatedPaths = Array.isArray(generatedOutputDir) ? generatedOutputDir : [generatedOutputDir];
  const exclusions = generatedPaths.flatMap((path) => {
    const generatedRelative = relative(root, resolve(path)).split(sep).join("/");
    if (!generatedRelative || generatedRelative.startsWith("..")) {
      fail("generated output directories must be inside the repository for source-state checks");
    }
    return [`:(exclude)${generatedRelative}`, `:(exclude)${generatedRelative}/**`];
  });
  const status = execFileSync("git", [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ".",
    ...exclusions
  ], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  return status ? "modified" : "clean";
}

function isVercelOutputDirectory(path) {
  return basename(resolve(path)).toLowerCase() === "output" &&
    basename(dirname(resolve(path))).toLowerCase() === ".vercel";
}

async function verifyStagingApiKey(supabaseConfig) {
  const endpoint = `${supabaseConfig.url}/auth/v1/health`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: { apikey: supabaseConfig.anonKey },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    fail("staging API key authorization could not be verified; no deployable output was created");
  }
  if (response.redirected || (response.url && new URL(response.url).origin !== new URL(supabaseConfig.url).origin)) {
    await response.body?.cancel().catch(() => {});
    fail("staging API key authorization probe redirected outside the staging project");
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    fail(`staging API key authorization was rejected (HTTP ${response.status}); no deployable output was created`);
  }
  await response.body?.cancel().catch(() => {});
}

async function listRegularFiles(root, current = root, collected = []) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(current, entry.name);
    const details = await lstat(path);
    if (details.isSymbolicLink()) fail(`modular artifact contains a symbolic link: ${relative(root, path)}`);
    if (details.isDirectory()) {
      await listRegularFiles(root, path, collected);
    } else if (details.isFile()) {
      collected.push(path);
    } else {
      fail(`modular artifact contains an unsupported filesystem entry: ${relative(root, path)}`);
    }
  }
  return collected.sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
}

function parseJson(source, name) {
  try {
    return JSON.parse(source);
  } catch {
    fail(`${name} is not valid JSON`);
  }
}

function parseCspDirectives(csp) {
  const directives = new Map();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/u).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens.shift().toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/u.test(name) || directives.has(name)) {
      fail(`CSP contains an invalid or duplicate ${name} directive`);
    }
    directives.set(name, tokens);
  }
  return directives;
}

function validateCsp(csp) {
  const directives = parseCspDirectives(csp);
  for (const directive of REQUIRED_CSP_DIRECTIVES) {
    if (!directives.has(directive)) fail(`CSP is missing ${directive}`);
  }
  for (const [name, values] of directives) {
    if (values.some((value) => value.includes("*") || value === "https:" || value === "wss:")) {
      fail(`CSP ${name} contains a wildcard or unrestricted network scheme`);
    }
    if (values.includes("'unsafe-eval'")) fail(`CSP ${name} is excessively permissive`);
  }
  const connectSources = directives.get("connect-src");
  if (!connectSources) fail("CSP is missing connect-src");
  for (const required of ALLOWED_CONNECT_SOURCES.slice(0, 3)) {
    if (!connectSources.includes(required)) fail(`CSP connect-src is missing required source ${required}`);
  }
  const supabaseSources = connectSources.filter((value) => /\.supabase\.co(?:\/|$)/iu.test(value));
  const expectedSupabase = ALLOWED_CONNECT_SOURCES.slice(1, 3);
  if (supabaseSources.length !== expectedSupabase.length ||
      expectedSupabase.some((source) => !supabaseSources.includes(source))) {
    fail("CSP connect-src contains unauthorized Supabase connections");
  }
  if (csp.includes(PRODUCTION_SUPABASE_PROJECT_REF)) {
    fail("CSP still references the production Supabase project");
  }
  for (const [name, expectedSources] of Object.entries(EXPECTED_CSP_SOURCES)) {
    const actual = directives.get(name) ?? [];
    if (actual.length !== expectedSources.length || expectedSources.some((source) => !actual.includes(source))) {
      fail(`CSP ${name} contains unauthorized or overly permissive sources`);
    }
  }
  return directives;
}

function validateGeneratedVercelConfig(config) {
  assertPlainObject(config, "generated staging vercel.json");
  if (!Array.isArray(config.headers) || config.headers.length === 0) {
    fail("generated staging vercel.json has no header rules");
  }
  const allHeaders = new Map();
  for (const [index, rule] of config.headers.entries()) {
    if (!rule || typeof rule !== "object" || typeof rule.source !== "string" || !Array.isArray(rule.headers)) {
      fail(`generated staging vercel.json header rule ${index} is invalid`);
    }
    for (const header of rule.headers) {
      if (!header || typeof header.key !== "string" || typeof header.value !== "string") {
        fail(`generated staging vercel.json header rule ${index} has an invalid header`);
      }
      allHeaders.set(header.key.toLowerCase(), header.value);
    }
  }
  for (const required of REQUIRED_SECURITY_HEADERS) {
    if (!allHeaders.has(required)) fail(`generated staging vercel.json is missing ${required}`);
  }

  validateCsp(allHeaders.get("content-security-policy"));
  return config;
}

function hasCspHeader(route) {
  return Object.keys(route.headers ?? {}).some((name) => name.toLowerCase() === "content-security-policy");
}

function validateCspRouteCoverage(config, bundlePaths) {
  const requiredPaths = ["/", "/index.html", "/sw.js", "/supabase-config.js", ...bundlePaths.map((path) => `/${path}`)];
  for (const path of requiredPaths) {
    const covered = config.routes.some((route) => {
      if (typeof route.src !== "string" || !hasCspHeader(route)) return false;
      return new RegExp(route.src, "u").test(path);
    });
    if (!covered) fail(`CSP route coverage does not include ${path}`);
  }
}

function transformHeaders(vercelConfig) {
  const transformed = getTransformedRoutes({ headers: vercelConfig.headers });
  if (transformed.error) fail(`Vercel route conversion failed: ${transformed.error}`);
  const config = { version: 3, routes: transformed.routes };
  validateBuildOutputConfig(config);
  const headerKeys = new Set(config.routes.flatMap((route) => Object.keys(route.headers ?? {}).map((name) => name.toLowerCase())));
  for (const required of REQUIRED_SECURITY_HEADERS) {
    if (!headerKeys.has(required)) fail(`Build Output API routes are missing ${required}`);
  }
  return config;
}

function assertModularArtifact(files, fileNames, root) {
  for (const required of ["index.html", "sw.js", "supabase-config.js", "vercel.json"]) {
    if (!fileNames.includes(required)) fail(`modular artifact is missing ${required}`);
  }
  const typedBundles = fileNames.filter((name) => APP_BUNDLE_PATTERN.test(name));
  if (typedBundles.length !== 1) fail(`modular artifact must contain one typed application bundle; found ${typedBundles.length}`);
  const legacyNames = fileNames.filter((name) => name === "app.js" || /^app-(?:refactor-v232|staging-v2312)-/u.test(name));
  const index = files.find((file) => relative(root, file) === "index.html");
  const sw = files.find((file) => relative(root, file) === "sw.js");
  const indexSource = readFileSync(index, "utf8");
  const serviceWorker = readFileSync(sw, "utf8");
  try {
    assertNoModularLegacyRuntime(indexSource, legacyNames, serviceWorker);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (!indexSource.includes(typedBundles[0])) fail("index.html does not reference the typed application bundle");
  if (!serviceWorker.includes(`./${typedBundles[0]}`)) fail("modular Service Worker does not precache the typed application bundle");
  const requiredRuntimePatterns = [
    /^vendify-offline-v2312-[0-9a-f]{12}\.js$/u,
    /^vendify-core-v232-[0-9a-f]{12}\.js$/u,
    /^vendify-offline-v2312-pending-ui-[0-9a-f]{12}\.js$/u
  ];
  for (const required of requiredRuntimePatterns) {
    if (fileNames.filter((name) => required.test(name)).length !== 1) {
      fail(`modular artifact is missing exactly one bundle matching ${required}`);
    }
  }
  const requiredBundles = [typedBundles[0], ...requiredRuntimePatterns.map((pattern) => fileNames.find((name) => pattern.test(name)))];
  for (const bundle of requiredBundles) {
    if (!serviceWorker.includes(`./${bundle}`)) {
      fail(`modular Service Worker does not precache required runtime bundle ${bundle}`);
    }
  }
}

function validateArguments(options) {
  assertPlainObject(options, "packager options");
  for (const key of ["artifactDir", "outputDir", "sourceSha", "sourceTreeStatus", "buildCommand", "packageCommand", "backendSource"]) {
    assertSafeText(options[key], key);
  }
  if (!/^[a-f0-9]{40}$/iu.test(options.sourceSha)) fail("sourceSha must be a full 40-character Git SHA");
  if (!["clean", "modified"].includes(options.sourceTreeStatus)) fail("sourceTreeStatus must be clean or modified");
  if (!["synthetic", "provided-environment"].includes(options.backendSource)) fail("backendSource must be synthetic or provided-environment");
  if (options.backendSource === "provided-environment" && options.sourceTreeStatus !== "clean") {
    fail("provided-environment requires a clean source tree; no deployable output was created");
  }
}

async function existingOutputMatches(outputDir, outputConfig, provenance) {
  try {
    const existingConfig = parseJson(await readFile(resolve(outputDir, OUTPUT_API_CONFIG_FILENAME), "utf8"), OUTPUT_API_CONFIG_FILENAME);
    const existingProvenance = parseJson(await readFile(resolve(outputDir, PROVENANCE_FILENAME), "utf8"), PROVENANCE_FILENAME);
    if (JSON.stringify(existingConfig) !== JSON.stringify(outputConfig) ||
        JSON.stringify(existingProvenance) !== JSON.stringify(provenance)) return false;
    const staticRoot = resolve(outputDir, "static");
    const existingAssets = new Set((await listRegularFiles(staticRoot)).map((path) => relative(staticRoot, path).split(sep).join("/")));
    const expectedAssets = provenance.assets.map((asset) => asset.path);
    if (existingAssets.size !== expectedAssets.length || expectedAssets.some((path) => !existingAssets.has(path))) return false;
    for (const asset of provenance.assets) {
      const bytes = await readFile(resolve(staticRoot, asset.path));
      if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function packageModularPreview(options) {
  validateArguments(options);
  const artifactDir = resolve(options.artifactDir);
  const outputDir = resolve(options.outputDir);
  const staticDir = resolve(outputDir, "static");
  if (options.backendSource === "synthetic" && isVercelOutputDirectory(outputDir)) {
    fail("synthetic backend output is local-only and cannot target .vercel/output");
  }
  if (options.backendSource === "provided-environment" && !isVercelOutputDirectory(outputDir)) {
    fail("provided-environment output must target .vercel/output after staging API authorization");
  }
  if (outputDir === artifactDir || outputDir.startsWith(`${artifactDir}${sep}`) || artifactDir.startsWith(`${outputDir}${sep}`)) {
    fail("artifactDir and outputDir must not overlap");
  }
  const files = await listRegularFiles(artifactDir);
  const relativeFiles = files.map((file) => relative(artifactDir, file).split(sep).join("/"));
  assertModularArtifact(files, relativeFiles, artifactDir);

  const supabaseConfigFile = files[relativeFiles.indexOf("supabase-config.js")];
  const supabaseConfig = inspectRenderedStagingSupabaseConfig(await readFile(supabaseConfigFile, "utf8"));
  if (supabaseConfig.mode !== "real" || supabaseConfig.projectRef !== EXPECTED_STAGING_SUPABASE_PROJECT_REF) {
    fail("Preview backend must be real-mode and reference the staging Supabase project");
  }
  if (supabaseConfig.projectRef === PRODUCTION_SUPABASE_PROJECT_REF) {
    fail("production Supabase backend is forbidden in Preview configuration");
  }
  if (options.backendSource === "provided-environment") {
    await verifyStagingApiKey(supabaseConfig);
  }

  const stagingVercelConfig = validateGeneratedVercelConfig(parseJson(
    await readFile(files[relativeFiles.indexOf("vercel.json")], "utf8"),
    "generated staging vercel.json"
  ));
  const outputConfig = transformHeaders(stagingVercelConfig);

  const copiedAssets = relativeFiles.filter((path) => path !== "vercel.json");
  const assetHashes = await Promise.all(copiedAssets.map(async (path) => ({
    path,
    sha256: createHash("sha256").update(await readFile(resolve(artifactDir, path))).digest("hex")
  })));
  validateCspRouteCoverage(outputConfig, copiedAssets);

  const provenance = {
    schemaVersion: 1,
    sourceSha: options.sourceSha.toLowerCase(),
    sourceTreeStatus: options.sourceTreeStatus,
    buildCommand: options.buildCommand,
    packageCommand: options.packageCommand,
    backendProjectRef: supabaseConfig.projectRef,
    backendSource: options.backendSource,
    backendVerification: options.backendSource === "synthetic" ? "synthetic-local-only" : "staging-auth-health-accepted",
    deployable: options.backendSource === "provided-environment",
    assets: assetHashes
  };
  if (existsSync(outputDir)) {
    if (await existingOutputMatches(outputDir, outputConfig, provenance)) {
      return Object.freeze({ outputDir, staticDir, config: outputConfig, provenance, reused: true });
    }
    fail("outputDir already exists and differs from the deterministic package; refusing to overwrite existing work");
  }
  let stagedOutputDir;
  try {
    await mkdir(dirname(outputDir), { recursive: true });
    stagedOutputDir = await mkdtemp(join(dirname(outputDir), ".ven008-output-"));
    await mkdir(resolve(stagedOutputDir, "static"), { recursive: true });
    for (const path of copiedAssets) {
      const source = resolve(artifactDir, path);
      const target = resolve(stagedOutputDir, "static", path);
      const rel = relative(resolve(stagedOutputDir, "static"), target);
      if (rel.startsWith(`..${sep}`) || rel === "..") fail(`asset path escapes output static directory: ${path}`);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      const sourceHash = createHash("sha256").update(await readFile(source)).digest("hex");
      const outputHash = createHash("sha256").update(await readFile(target)).digest("hex");
      if (sourceHash !== outputHash) fail(`copied asset bytes do not match source: ${path}`);
      if (sourceHash !== assetHashes.find((asset) => asset.path === path)?.sha256) {
        fail(`source asset changed during packaging: ${path}`);
      }
    }
    await writeFile(resolve(stagedOutputDir, OUTPUT_API_CONFIG_FILENAME), `${JSON.stringify(outputConfig, null, 2)}\n`);
    await writeFile(resolve(stagedOutputDir, PROVENANCE_FILENAME), `${JSON.stringify(provenance, null, 2)}\n`);
    await rename(stagedOutputDir, outputDir);
  } catch (error) {
    if (stagedOutputDir) await rm(stagedOutputDir, { recursive: true, force: true });
    throw error;
  }

  return Object.freeze({
    outputDir,
    staticDir,
    config: outputConfig,
    provenance,
    reused: false
  });
}

function readGitValue(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function parseCli(args) {
  const options = { backendSource: "provided-environment" };
  for (const arg of args) {
    const match = /^--backend-source=(synthetic|provided-environment)$/u.exec(arg);
    if (!match) fail("usage: node scripts/package-vercel-prebuilt-preview.mjs [--backend-source=synthetic|provided-environment]");
    options.backendSource = match[1];
  }
  return options;
}

async function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const cli = parseCli(process.argv.slice(2));
  const outputDir = cli.backendSource === "synthetic"
    ? resolve(projectRoot, ".ven008", "synthetic-output")
    : resolve(projectRoot, ".vercel", "output");
  const sourceTreeStatus = getSourceTreeStatus(projectRoot, [
    resolve(projectRoot, ".ven008"),
    resolve(projectRoot, ".vercel", "output")
  ]);
  const result = await packageModularPreview({
    artifactDir: resolve(projectRoot, "dist-refactor-modular"),
    outputDir,
    sourceSha: readGitValue(["rev-parse", "HEAD"], projectRoot),
    sourceTreeStatus,
    buildCommand: "npm run build:refactor:modular -- --require-backend",
    packageCommand: `node scripts/package-vercel-prebuilt-preview.mjs --backend-source=${cli.backendSource}`,
    backendSource: cli.backendSource
  });
  console.log(`Build Output API v3 ${result.reused ? "reused" : "packaged"} at ${result.outputDir}`);
  console.log(`Source ${result.provenance.sourceSha} (${result.provenance.sourceTreeStatus}); backend ${result.provenance.backendProjectRef}; deployable=${result.provenance.deployable}; ${result.provenance.assets.length} assets hashed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Preview packaging failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
