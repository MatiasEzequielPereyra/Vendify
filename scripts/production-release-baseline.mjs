import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";

export const PRODUCTION_RELEASE_CONTRACT_PATH =
  "contracts/production-release-baseline.json";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const MAX_GIT_BUFFER = 32 * 1024 * 1024;

function fail(message) {
  throw new Error("Production release baseline verification failed: " + message);
}

function gitOutput(root, args, { binary = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: binary ? null : "utf8",
      maxBuffer: MAX_GIT_BUFFER,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const stderr = error?.stderr
      ? Buffer.isBuffer(error.stderr)
        ? error.stderr.toString("utf8")
        : String(error.stderr)
      : "";
    const detail = stderr.trim();
    fail(
      "git " +
        args.join(" ") +
        " failed" +
        (detail ? ": " + detail : "")
    );
  }
}

function gitText(root, args) {
  return String(gitOutput(root, args)).trim();
}

function tryGitText(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: MAX_GIT_BUFFER,
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch {
    return null;
  }
}

function safePath(root, relativePath) {
  return resolve(root, ...relativePath.split("/"));
}

function validateReleasePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    fail("invalid release path " + JSON.stringify(value));
  }
}

export function validateProductionReleaseContract(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    fail("contract must be an object");
  }
  if (contract.schemaVersion !== 1) {
    fail("unsupported contract schema");
  }
  if (contract.artifactName !== "production baseline release") {
    fail("unexpected artifact name");
  }
  if (typeof contract.tag !== "string" || !contract.tag.trim()) {
    fail("baseline tag is missing");
  }
  if (!SHA_PATTERN.test(contract.tagObjectSha ?? "")) {
    fail("tag object SHA is invalid");
  }
  if (!SHA_PATTERN.test(contract.targetCommitSha ?? "")) {
    fail("target commit SHA is invalid");
  }
  if (!PROJECT_REF_PATTERN.test(contract.productionSupabaseProjectRef ?? "")) {
    fail("production Supabase project ref is invalid");
  }
  if (!Array.isArray(contract.files) || contract.files.length === 0) {
    fail("release inventory is empty");
  }

  const paths = [];
  const seen = new Set();
  for (const entry of contract.files) {
    if (!entry || typeof entry !== "object") {
      fail("release inventory entry is invalid");
    }
    validateReleasePath(entry.path);
    if (seen.has(entry.path)) {
      fail("duplicate release inventory path " + entry.path);
    }
    seen.add(entry.path);
    paths.push(entry.path);
    if (!SHA_PATTERN.test(entry.gitBlobSha ?? "")) {
      fail("invalid Git blob SHA for " + entry.path);
    }
  }

  const sorted = [...paths].sort();
  if (JSON.stringify(paths) !== JSON.stringify(sorted)) {
    fail("release inventory must be sorted deterministically");
  }

  return contract;
}

export function loadProductionReleaseContract(root) {
  const path = resolve(root, PRODUCTION_RELEASE_CONTRACT_PATH);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(
      "cannot read contract " +
        PRODUCTION_RELEASE_CONTRACT_PATH +
        ": " +
        (error instanceof Error ? error.message : String(error))
    );
  }
  return validateProductionReleaseContract(parsed);
}

function sourceInventory(root, commitSha) {
  const output = gitText(root, ["ls-tree", "-r", "--name-only", commitSha]);
  if (!output) return [];
  return output.split(/\r?\n/u).filter(Boolean).sort();
}

export function ensureProductionBaselineGitObjects(
  root,
  contract = loadProductionReleaseContract(root),
  { remote = "origin" } = {}
) {
  validateProductionReleaseContract(contract);

  // A real Git repository is mandatory. There is intentionally no filesystem
  // or working-tree fallback when provenance cannot be established.
  gitText(root, ["rev-parse", "--git-dir"]);

  const tagRef = "refs/tags/" + contract.tag;
  const localTagObjectSha = tryGitText(root, [
    "rev-parse",
    "--verify",
    tagRef
  ]);

  if (localTagObjectSha !== null) {
    // An unexpected local tag must fail closed; never replace it silently.
    return verifyProductionBaselineSource(root, contract);
  }

  if (typeof remote !== "string" || !remote.trim()) {
    fail("Git remote for baseline hydration is missing");
  }

  gitOutput(root, [
    "fetch",
    "--no-tags",
    "--depth=1",
    remote,
    tagRef + ":" + tagRef
  ]);

  // The fetched tag, target commit, tree inventory and every blob are still
  // checked against the immutable contract before any artifact is created.
  return verifyProductionBaselineSource(root, contract);
}

export function verifyProductionBaselineSource(
  root,
  contract = loadProductionReleaseContract(root)
) {
  validateProductionReleaseContract(contract);

  const tagRef = "refs/tags/" + contract.tag;
  const tagObjectSha = gitText(root, ["rev-parse", "--verify", tagRef]);
  if (tagObjectSha !== contract.tagObjectSha) {
    fail(
      "tag object SHA mismatch: expected " +
        contract.tagObjectSha +
        ", got " +
        tagObjectSha
    );
  }

  const tagType = gitText(root, ["cat-file", "-t", tagRef]);
  if (tagType !== "tag") {
    fail("baseline tag must remain annotated; got object type " + tagType);
  }

  const targetCommitSha = gitText(root, [
    "rev-parse",
    tagRef + "^{commit}"
  ]);
  if (targetCommitSha !== contract.targetCommitSha) {
    fail(
      "target commit mismatch: expected " +
        contract.targetCommitSha +
        ", got " +
        targetCommitSha
    );
  }

  const expectedInventory = contract.files.map((entry) => entry.path);
  const actualInventory = sourceInventory(root, targetCommitSha);
  if (JSON.stringify(actualInventory) !== JSON.stringify(expectedInventory)) {
    fail(
      "baseline source inventory differs from contract; expected " +
        JSON.stringify(expectedInventory) +
        ", got " +
        JSON.stringify(actualInventory)
    );
  }

  for (const entry of contract.files) {
    const actualBlobSha = gitText(root, [
      "rev-parse",
      targetCommitSha + ":" + entry.path
    ]);
    if (actualBlobSha !== entry.gitBlobSha) {
      fail(
        "Git blob SHA mismatch for " +
          entry.path +
          ": expected " +
          entry.gitBlobSha +
          ", got " +
          actualBlobSha
      );
    }
  }

  return Object.freeze({
    contract,
    tagObjectSha,
    targetCommitSha,
    inventory: expectedInventory
  });
}

function readBaselineFile(root, commitSha, relativePath) {
  return gitOutput(
    root,
    ["show", commitSha + ":" + relativePath],
    { binary: true }
  );
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function releaseDigest(entries) {
  const digest = createHash("sha256");
  for (const entry of entries) {
    digest.update(entry.path, "utf8");
    digest.update("\0", "utf8");
    digest.update(sha256(entry.content), "utf8");
    digest.update("\n", "utf8");
  }
  return digest.digest("hex");
}

function artifactInventory(target) {
  const files = [];

  function visit(directory, prefix) {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const entry of entries) {
      const relativePath = prefix ? prefix + "/" + entry.name : entry.name;
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      } else {
        fail("unsupported filesystem entry in release: " + relativePath);
      }
    }
  }

  visit(target, "");
  return files.sort();
}

function verifyLocalReferences(target) {
  const html = readFileSync(resolve(target, "index.html"), "utf8");
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gu)) {
    const ref = match[1];
    if (/^(?:https?:|data:|blob:|mailto:|#)/u.test(ref)) continue;
    const cleaned = ref
      .split(/[?#]/u, 1)[0]
      .replace(/^\.\//u, "")
      .replace(/^\/+/, "");
    if (!cleaned) continue;
    if (!existsSync(safePath(target, cleaned))) {
      fail("unresolved local release reference " + cleaned);
    }
  }
}

export function materializeProductionRelease({
  root,
  out = resolve(root, "dist"),
  contract = loadProductionReleaseContract(root)
}) {
  const verified = verifyProductionBaselineSource(root, contract);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const entries = [];
  for (const entry of contract.files) {
    const content = readBaselineFile(root, verified.targetCommitSha, entry.path);
    const destination = safePath(out, entry.path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
    entries.push({ path: entry.path, content });
  }

  return Object.freeze({
    ...verified,
    digest: releaseDigest(entries)
  });
}

export function verifyProductionReleaseArtifact({
  root,
  target = resolve(root, "dist"),
  contract = loadProductionReleaseContract(root)
}) {
  const verified = verifyProductionBaselineSource(root, contract);

  if (!existsSync(target)) {
    fail("release artifact does not exist: " + target);
  }

  const expectedInventory = contract.files.map((entry) => entry.path);
  const actualInventory = artifactInventory(target);
  if (JSON.stringify(actualInventory) !== JSON.stringify(expectedInventory)) {
    fail(
      "artifact inventory differs from contract; expected " +
        JSON.stringify(expectedInventory) +
        ", got " +
        JSON.stringify(actualInventory)
    );
  }

  const entries = [];
  for (const entry of contract.files) {
    const source = readBaselineFile(
      root,
      verified.targetCommitSha,
      entry.path
    );
    const artifact = readFileSync(safePath(target, entry.path));
    if (!artifact.equals(source)) {
      fail(
        "artifact content differs from approved baseline for " +
          entry.path +
          " (source sha256=" +
          sha256(source) +
          ", artifact sha256=" +
          sha256(artifact) +
          ")"
      );
    }
    entries.push({ path: entry.path, content: artifact });
  }

  const config = readFileSync(resolve(target, "supabase-config.js"), "utf8");
  const productionHost =
    contract.productionSupabaseProjectRef + ".supabase.co";
  if (!config.includes(productionHost)) {
    fail("release points to unexpected Supabase project");
  }
  if (/vebqlbcfjxnpryjdgfvq/u.test(config)) {
    fail("obsolete Supabase project detected");
  }

  verifyLocalReferences(target);

  return Object.freeze({
    ...verified,
    digest: releaseDigest(entries)
  });
}
