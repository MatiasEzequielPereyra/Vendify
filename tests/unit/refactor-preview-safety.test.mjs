import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  renderStagingSupabaseConfig,
  resolveStagingSupabaseConfig
} from "../../scripts/staging-supabase-config.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(currentDirectory, "../..");
const previewRoot = path.join(root, "dist-refactor-modular");
const serverScript = path.join(root, "scripts", "serve-refactor-modular.mjs");

function anonJwt(projectRef) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ iss: "supabase", ref: projectRef, role: "anon" }),
    "test-signature"
  ].join(".");
}

function preparePreview(config) {
  rmSync(previewRoot, { recursive: true, force: true });
  mkdirSync(previewRoot, { recursive: true });
  writeFileSync(path.join(previewRoot, "index.html"), "<!doctype html><title>Vendify preview test</title>\n");
  writeFileSync(
    path.join(previewRoot, "supabase-config.js"),
    renderStagingSupabaseConfig(config),
    "utf8"
  );
}

function runPreviewToExit() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverScript], {
      cwd: root,
      env: { ...process.env, VENDIFY_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function startPreview() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverScript], {
      cwd: root,
      env: { ...process.env, VENDIFY_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("modular refactor preview did not start"));
    }, 5000);

    const finish = () => {
      if (settled || !stdout.includes("Vendify modular refactor preview:")) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ child, stdout, stderr });
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      finish();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(
        new Error(
          `modular refactor preview exited before listening: code=${code} signal=${signal} stderr=${stderr}`
        )
      );
    });
  });
}

test("modular refactor preview rejects static-validation-only configuration", async () => {
  try {
    preparePreview(resolveStagingSupabaseConfig({}));
    const result = await runPreviewToExit();

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Real staging backend is not configured/);
  } finally {
    rmSync(previewRoot, { recursive: true, force: true });
  }
});

test("modular refactor preview can start with valid real staging configuration", async () => {
  const projectRef = "vendifypreviewtest12345";
  try {
    preparePreview(
      resolveStagingSupabaseConfig({
        VENDIFY_STAGING_SUPABASE_URL: `https://${projectRef}.supabase.co`,
        VENDIFY_STAGING_SUPABASE_ANON_KEY: anonJwt(projectRef)
      })
    );

    const started = await startPreview();
    try {
      assert.match(started.stdout, /Vendify modular refactor preview:/);
      assert.match(started.stdout, /\?offlineEngine=v2312/);
      assert.doesNotMatch(started.stdout, /allowProdOfflineSync=1/);
    } finally {
      started.child.kill();
    }
  } finally {
    rmSync(previewRoot, { recursive: true, force: true });
  }
});

test("modular refactor preview source never recommends the production offline-sync override", () => {
  const source = readFileSync(serverScript, "utf8");

  assert.doesNotMatch(source, /allowProdOfflineSync=1/);
  assert.match(source, /\?offlineEngine=v2312/);
  assert.match(source, /inspectRenderedStagingSupabaseConfig/);
  assert.match(source, /stagingConfig\.mode !== "real"/);
});
