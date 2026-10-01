import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  ensureProductionBaselineGitObjects,
  materializeProductionRelease,
  verifyProductionBaselineSource,
  verifyProductionReleaseArtifact
} from "../../scripts/production-release-baseline.mjs";

const PRODUCTION_REF = "puhkmblnptntorwptvld";
const ZERO_SHA = "0000000000000000000000000000000000000000";

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function write(root, relativePath, content) {
  const destination = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "vendify-release-baseline-"));

  git(root, ["init"]);
  write(root, "app.js", "console.log('baseline');\n");
  write(
    root,
    "index.html",
    [
      "<!doctype html>",
      '<link rel="stylesheet" href="styles.css">',
      '<link rel="manifest" href="manifest.json">',
      '<script src="supabase-config.js"></script>',
      '<script src="app.js"></script>',
      ""
    ].join("\n")
  );
  write(root, "manifest.json", '{"name":"Vendify","icons":[]}\n');
  write(root, "styles.css", "body { display: block; }\n");
  write(
    root,
    "supabase-config.js",
    'const SUPABASE_URL = "https://' +
      PRODUCTION_REF +
      '.supabase.co";\n'
  );
  write(root, "sw.js", "self.addEventListener('fetch', () => {});\n");
  write(root, "vercel.json", "{}\n");
  write(
    root,
    "icons/icon-192.png",
    Buffer.from([0, 1, 2, 3, 255])
  );

  git(root, ["add", "."]);
  git(root, [
    "-c",
    "user.name=Vendify Test",
    "-c",
    "user.email=vendify-test@example.invalid",
    "commit",
    "-m",
    "fixture baseline"
  ]);
  git(root, [
    "-c",
    "user.name=Vendify Test",
    "-c",
    "user.email=vendify-test@example.invalid",
    "tag",
    "-a",
    "fixture-production",
    "-m",
    "fixture production baseline"
  ]);

  const targetCommitSha = git(root, ["rev-parse", "HEAD"]);
  const tagObjectSha = git(root, [
    "rev-parse",
    "refs/tags/fixture-production"
  ]);
  const inventory = git(root, [
    "ls-tree",
    "-r",
    "--name-only",
    targetCommitSha
  ])
    .split(/\r?\n/u)
    .filter(Boolean)
    .sort();

  const contract = {
    schemaVersion: 1,
    artifactName: "production baseline release",
    tag: "fixture-production",
    tagObjectSha,
    targetCommitSha,
    productionSupabaseProjectRef: PRODUCTION_REF,
    files: inventory.map((relativePath) => ({
      path: relativePath,
      gitBlobSha: git(root, [
        "rev-parse",
        targetCommitSha + ":" + relativePath
      ])
    }))
  };

  return {
    root,
    out: path.join(root, "dist"),
    contract,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test(
  "production release is sourced from immutable baseline bytes and is reproducible",
  () => {
    const fx = fixture();
    try {
      const first = materializeProductionRelease({
        root: fx.root,
        out: fx.out,
        contract: fx.contract
      });
      const verified = verifyProductionReleaseArtifact({
        root: fx.root,
        target: fx.out,
        contract: fx.contract
      });

      assert.equal(first.digest, verified.digest);
      assert.equal(
        readFileSync(path.join(fx.out, "app.js"), "utf8"),
        "console.log('baseline');\n"
      );
      assert.match(
        readFileSync(
          path.join(fx.out, "supabase-config.js"),
          "utf8"
        ),
        new RegExp(PRODUCTION_REF + "\\.supabase\\.co")
      );

      writeFileSync(
        path.join(fx.root, "app.js"),
        "console.log('engineering mutation');\n"
      );

      const second = materializeProductionRelease({
        root: fx.root,
        out: fx.out,
        contract: fx.contract
      });
      assert.equal(second.digest, first.digest);
      assert.equal(
        readFileSync(path.join(fx.out, "app.js"), "utf8"),
        "console.log('baseline');\n"
      );
    } finally {
      fx.cleanup();
    }
  }
);

test("unexpected tag object or target commit fails closed", () => {
  const fx = fixture();
  try {
    assert.throws(
      () =>
        verifyProductionBaselineSource(fx.root, {
          ...fx.contract,
          tagObjectSha: ZERO_SHA
        }),
      /tag object SHA mismatch/u
    );
    assert.throws(
      () =>
        verifyProductionBaselineSource(fx.root, {
          ...fx.contract,
          targetCommitSha: ZERO_SHA
        }),
      /target commit mismatch/u
    );
  } finally {
    fx.cleanup();
  }
});

test("missing baseline inventory entry or wrong blob hash fails closed", () => {
  const fx = fixture();
  try {
    const missingFileContract = {
      ...fx.contract,
      files: [
        ...fx.contract.files,
        { path: "zz-missing.js", gitBlobSha: ZERO_SHA }
      ]
    };
    assert.throws(
      () => verifyProductionBaselineSource(fx.root, missingFileContract),
      /baseline source inventory differs/u
    );

    const badHashFiles = fx.contract.files.map((entry, index) =>
      index === 0 ? { ...entry, gitBlobSha: ZERO_SHA } : entry
    );
    assert.throws(
      () =>
        verifyProductionBaselineSource(fx.root, {
          ...fx.contract,
          files: badHashFiles
        }),
      /Git blob SHA mismatch/u
    );
  } finally {
    fx.cleanup();
  }
});

test("artifact mutation and engineering-only contamination fail closed", () => {
  const fx = fixture();
  try {
    materializeProductionRelease({
      root: fx.root,
      out: fx.out,
      contract: fx.contract
    });
    writeFileSync(path.join(fx.out, "app.js"), "tampered\n");
    assert.throws(
      () =>
        verifyProductionReleaseArtifact({
          root: fx.root,
          target: fx.out,
          contract: fx.contract
        }),
      /artifact content differs/u
    );

    materializeProductionRelease({
      root: fx.root,
      out: fx.out,
      contract: fx.contract
    });
    writeFileSync(
      path.join(fx.out, "html-loader.js"),
      "engineering-only\n"
    );
    assert.throws(
      () =>
        verifyProductionReleaseArtifact({
          root: fx.root,
          target: fx.out,
          contract: fx.contract
        }),
      /artifact inventory differs/u
    );
  } finally {
    fx.cleanup();
  }
});


test("Vercel-style no-tags checkout hydrates only the contracted baseline tag", () => {
  const fx = fixture();
  const remote = mkdtempSync(path.join(tmpdir(), "vendify-release-remote-"));
  const checkoutParent = mkdtempSync(
    path.join(tmpdir(), "vendify-release-checkout-parent-")
  );
  const checkout = path.join(checkoutParent, "checkout");

  try {
    git(remote, ["init", "--bare"]);
    const remoteUrl = pathToFileURL(remote).href;
    git(fx.root, ["remote", "add", "origin", remoteUrl]);
    git(fx.root, [
      "push",
      "origin",
      "HEAD:refs/heads/main",
      "refs/tags/fixture-production"
    ]);

    execFileSync(
      "git",
      [
        "clone",
        "--no-tags",
        "--depth=1",
        "--branch",
        "main",
        remoteUrl,
        checkout
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );

    assert.throws(
      () => verifyProductionBaselineSource(checkout, fx.contract),
      /git rev-parse --verify refs\/tags\/fixture-production failed/u
    );

    const hydrated = ensureProductionBaselineGitObjects(
      checkout,
      fx.contract
    );
    assert.equal(hydrated.tagObjectSha, fx.contract.tagObjectSha);
    assert.equal(hydrated.targetCommitSha, fx.contract.targetCommitSha);

    const out = path.join(checkout, "dist");
    const built = materializeProductionRelease({
      root: checkout,
      out,
      contract: fx.contract
    });
    assert.equal(
      readFileSync(path.join(out, "app.js"), "utf8"),
      "console.log('baseline');\n"
    );
    assert.equal(built.tagObjectSha, fx.contract.tagObjectSha);
  } finally {
    rmSync(remote, { recursive: true, force: true });
    rmSync(checkoutParent, { recursive: true, force: true });
    fx.cleanup();
  }
});

test("baseline hydration fails closed when the remote tag no longer matches the contract", () => {
  const fx = fixture();
  const remote = mkdtempSync(path.join(tmpdir(), "vendify-release-remote-"));
  const checkoutParent = mkdtempSync(
    path.join(tmpdir(), "vendify-release-checkout-parent-")
  );
  const checkout = path.join(checkoutParent, "checkout");

  try {
    const originalTagObjectSha = fx.contract.tagObjectSha;

    writeFileSync(path.join(fx.root, "app.js"), "console.log('moved');\n");
    git(fx.root, ["add", "app.js"]);
    git(fx.root, [
      "-c",
      "user.name=Vendify Test",
      "-c",
      "user.email=vendify-test@example.invalid",
      "commit",
      "-m",
      "move fixture baseline"
    ]);
    git(fx.root, ["tag", "-d", "fixture-production"]);
    git(fx.root, [
      "-c",
      "user.name=Vendify Test",
      "-c",
      "user.email=vendify-test@example.invalid",
      "tag",
      "-a",
      "fixture-production",
      "-m",
      "moved fixture production baseline"
    ]);

    git(remote, ["init", "--bare"]);
    const remoteUrl = pathToFileURL(remote).href;
    git(fx.root, ["remote", "add", "origin", remoteUrl]);
    git(fx.root, [
      "push",
      "origin",
      "HEAD:refs/heads/main",
      "refs/tags/fixture-production"
    ]);

    execFileSync(
      "git",
      [
        "clone",
        "--no-tags",
        "--depth=1",
        "--branch",
        "main",
        remoteUrl,
        checkout
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );

    assert.equal(fx.contract.tagObjectSha, originalTagObjectSha);
    assert.throws(
      () => ensureProductionBaselineGitObjects(checkout, fx.contract),
      /tag object SHA mismatch/u
    );
  } finally {
    rmSync(remote, { recursive: true, force: true });
    rmSync(checkoutParent, { recursive: true, force: true });
    fx.cleanup();
  }
});
