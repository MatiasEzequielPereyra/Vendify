import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_SUPABASE_HTTP_ORIGIN,
  PRODUCTION_SUPABASE_PROJECT_REF,
  PRODUCTION_SUPABASE_WS_ORIGIN,
  REAL_STAGING_CONFIG_MODE,
  STATIC_STAGING_CONFIG_MODE,
  STATIC_STAGING_SUPABASE_URL,
  inspectRenderedStagingSupabaseConfig,
  renderStagingApplicationSource,
  renderStagingSupabaseConfig,
  renderStagingVercelConfig,
  resolveStagingSupabaseConfig,
  validateRealStagingSupabaseConfig
} from "../../scripts/staging-supabase-config.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(currentDirectory, "../..");

function anonJwt(projectRef, role = "anon") {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ iss: "supabase", ref: projectRef, role }),
    "test-signature"
  ].join(".");
}

test("valid non-production staging config is rendered and verified", () => {
  const projectRef = "vendifystaging12345";
  const resolved = resolveStagingSupabaseConfig({
    VENDIFY_STAGING_SUPABASE_URL: "https://" + projectRef + ".supabase.co",
    VENDIFY_STAGING_SUPABASE_ANON_KEY: anonJwt(projectRef)
  });

  assert.equal(resolved.mode, REAL_STAGING_CONFIG_MODE);
  assert.equal(resolved.projectRef, projectRef);

  const rendered = renderStagingSupabaseConfig(resolved);
  assert.deepEqual(inspectRenderedStagingSupabaseConfig(rendered), resolved);

  const productionVercel =
    '{"csp":"' + PRODUCTION_SUPABASE_HTTP_ORIGIN + " " +
    PRODUCTION_SUPABASE_WS_ORIGIN + '"}';
  const stagingVercel = renderStagingVercelConfig(productionVercel, resolved);
  assert.doesNotMatch(stagingVercel, new RegExp(PRODUCTION_SUPABASE_PROJECT_REF));
  assert.match(stagingVercel, new RegExp(projectRef));

  const stagedApp = renderStagingApplicationSource(
    'const VENDIFY_EXPECTED_SUPABASE_REF = "' +
      PRODUCTION_SUPABASE_PROJECT_REF +
      '";',
    resolved
  );
  assert.match(stagedApp, new RegExp(projectRef));
  assert.doesNotMatch(stagedApp, new RegExp(PRODUCTION_SUPABASE_PROJECT_REF));
});

test("production Supabase is rejected by the staging contract", () => {
  assert.throws(
    () =>
      validateRealStagingSupabaseConfig({
        url: PRODUCTION_SUPABASE_HTTP_ORIGIN,
        anonKey: anonJwt(PRODUCTION_SUPABASE_PROJECT_REF)
      }),
    /production Supabase project ref is forbidden/
  );

  assert.throws(
    () =>
      validateRealStagingSupabaseConfig({
        url: "https://vendifystaging12345.supabase.co",
        anonKey: anonJwt(PRODUCTION_SUPABASE_PROJECT_REF)
      }),
    /production Supabase anon key is forbidden/
  );
});

test("missing config is safe for static validation and fails when real backend is required", () => {
  const staticConfig = resolveStagingSupabaseConfig({});
  assert.equal(staticConfig.mode, STATIC_STAGING_CONFIG_MODE);
  assert.equal(staticConfig.url, STATIC_STAGING_SUPABASE_URL);
  assert.doesNotMatch(renderStagingSupabaseConfig(staticConfig), new RegExp(PRODUCTION_SUPABASE_PROJECT_REF));
  const staticApp = renderStagingApplicationSource(
    'const VENDIFY_EXPECTED_SUPABASE_REF = "' +
      PRODUCTION_SUPABASE_PROJECT_REF +
      '";',
    staticConfig
  );
  assert.match(staticApp, /VENDIFY_EXPECTED_SUPABASE_REF = "vendify-staging-unconfigured"/);
  assert.doesNotMatch(staticApp, new RegExp(PRODUCTION_SUPABASE_PROJECT_REF));

  assert.throws(
    () => resolveStagingSupabaseConfig({}, { requireBackend: true }),
    /STAGING CONFIG MISSING/
  );
  assert.throws(
    () =>
      resolveStagingSupabaseConfig({
        VENDIFY_STAGING_SUPABASE_URL: "https://vendifystaging12345.supabase.co"
      }),
    /STAGING CONFIG INCOMPLETE/
  );
});

test("service_role and cross-project anon keys are rejected", () => {
  assert.throws(
    () =>
      validateRealStagingSupabaseConfig({
        url: "https://vendifystaging12345.supabase.co",
        anonKey: anonJwt("vendifystaging12345", "service_role")
      }),
    /service_role keys are forbidden/
  );

  assert.throws(
    () =>
      validateRealStagingSupabaseConfig({
        url: "https://vendifystaging12345.supabase.co",
        anonKey: anonJwt("anotherstaging12345")
      }),
    /anon key ref does not match staging URL/
  );
});

test("production release remains explicitly bound to the production config", () => {
  const productionConfig = fs.readFileSync(path.join(root, "supabase-config.js"), "utf8");
  const productionBuild = fs.readFileSync(path.join(root, "scripts/build-release.mjs"), "utf8");
  const productionContract = JSON.parse(
    fs.readFileSync(
      path.join(root, "contracts/production-release-baseline.json"),
      "utf8"
    )
  );

  assert.match(
    productionConfig,
    new RegExp(PRODUCTION_SUPABASE_PROJECT_REF + "\\.supabase\\.co")
  );
  assert.equal(
    productionContract.productionSupabaseProjectRef,
    PRODUCTION_SUPABASE_PROJECT_REF
  );
  assert.ok(
    productionContract.files.some(
      (entry) => entry.path === "supabase-config.js"
    )
  );
  assert.match(productionBuild, /materializeProductionRelease/);
});
