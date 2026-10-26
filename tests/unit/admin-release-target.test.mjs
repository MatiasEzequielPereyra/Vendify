import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { validateAdminReleaseTarget, getAdminReleaseRoutes, verifyAdminReleaseOutput, AUTHORIZED_TEAM_ID, POS_PROJECT_ID, PRODUCTION_REF } from "../../scripts/package-admin-release.mjs";
import { inventory, verifyAdminEntry } from "../../scripts/verify-admin-entry.mjs";
const head = "a".repeat(40);
const digest = "b".repeat(64);
const contract = { version: 1, projectId: "prj_AdminIndependent", teamId: AUTHORIZED_TEAM_ID, stableHost: "vendify-platform-admin.vercel.app", supabaseProjectRef: PRODUCTION_REF, sourceHead: head, baselineDigest: digest };
const identity = { actualHead: head, baselineDigest: digest };

test("release target requires explicit independent project, team, stable host, backend, HEAD and baseline", () => {
  assert.equal(validateAdminReleaseTarget(contract, identity), contract);
  for (const [field, value, message] of [
    ["projectId", POS_PROJECT_ID, /independent project/], ["projectId", "other", /independent project/],
    ["teamId", "team_other", /team mismatch/], ["stableHost", "vendifyseller.vercel.app", /hostname/],
    ["stableHost", "vendifyseller-unique-team.vercel.app", /hostname/], ["stableHost", "*.vercel.app", /hostname/],
    ["supabaseProjectRef", "staging", /backend/], ["sourceHead", "c".repeat(40), /HEAD/], ["baselineDigest", "d".repeat(64), /digest/]
  ]) assert.throws(() => validateAdminReleaseTarget({ ...contract, [field]: value }, identity), message);
  assert.throws(() => validateAdminReleaseTarget({ ...contract, unknown: true }, identity), /shape/);
});

const baselineConfig = { headers: [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "default-src 'self'; worker-src 'self' blob:; frame-ancestors 'none';" }] }] };
const routes = getAdminReleaseRoutes(baselineConfig, contract.stableHost, ["admin/index.html", "admin/assets/main.js", "admin/public-config.js"]);
function route(path, host) {
  const headers = {};
  for (const rule of routes) {
    if (!new RegExp(rule.src).test(path)) continue;
    if (rule.has && !rule.has.every(condition => condition.value === host)) continue;
    Object.assign(headers, rule.headers);
    if (!rule.continue) return { ...rule, headers };
  }
  throw new Error("No terminal rule");
}

test("release serves only exact administrative paths at the stable administrative host", () => {
  assert.equal(route("/", contract.stableHost).status, 307);
  assert.equal(route("/admin/", contract.stableHost).dest, "/admin/index.html");
  assert.equal(route("/admin/assets/main.js", contract.stableHost).dest, "/admin/assets/main.js");
  for (const host of ["vendifyseller.vercel.app", "localhost", "unknown.vercel.app", contract.stableHost + ".evil.com"]) {
    for (const path of ["/", "/admin", "/admin/", "/admin/index.html", "/admin/public-config.js", "/admin/assets/main.js"]) assert.equal(route(path, host).status, 404);
  }
  for (const path of ["/sw.js", "/index.html", "/app.js", "/assets/pos.js", "/admin/sw.js", "/admin/../sw.js", "/%61dmin/", "/ADMIN/", "//admin/", "/admin%2Findex.html"]) assert.equal(route(path, contract.stableHost).status, 404);
  assert.ok(routes.every(rule => !rule.missing && !rule.handle));
});

test("release keeps baseline headers, disables workers and caching", () => {
  const headers = route("/admin/", contract.stableHost).headers;
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Content-Security-Policy"], "default-src 'self'; worker-src 'none'; frame-ancestors 'none';");
  assert.equal(headers["Cache-Control"], "no-store, max-age=0");
});

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), "vendify-admin-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const baseline = resolve(root, "baseline"), artifact = resolve(root, "artifact"), output = resolve(root, "output");
  mkdirSync(baseline);
  const key = "public." + Buffer.from(JSON.stringify({ role: "anon", ref: PRODUCTION_REF })).toString("base64url") + ".signature";
  const config = `const SUPABASE_URL = "https://${PRODUCTION_REF}.supabase.co";\nconst SUPABASE_ANON_KEY = "${key}";\n`;
  writeFileSync(resolve(baseline, "index.html"), "approved POS");
  writeFileSync(resolve(baseline, "supabase-config.js"), config);
  cpSync(baseline, artifact, { recursive: true });
  mkdirSync(resolve(artifact, "admin/assets"), { recursive: true });
  writeFileSync(resolve(artifact, "admin/index.html"), '<script src="./public-config.js"></script><script src="./assets/main.js"></script>');
  writeFileSync(resolve(artifact, "admin/public-config.js"), config);
  writeFileSync(resolve(artifact, "admin/assets/main.js"), 'const listRPC = "listar_negocios_plataforma_v2";');
  const seal = () => { const files = inventory(resolve(artifact, "admin")); delete files["artifact-manifest.json"]; writeFileSync(resolve(artifact, "admin/artifact-manifest.json"), JSON.stringify({ version: 1, baselineDigest: digest, files })); };
  seal();
  mkdirSync(resolve(output, "static"), { recursive: true });
  cpSync(resolve(artifact, "admin"), resolve(output, "static/admin"), { recursive: true });
  const configObject = { version: 3, routes };
  writeFileSync(resolve(output, "config.json"), JSON.stringify(configObject));
  return { root, baseline, artifact, output, config: configObject, seal };
}

test("admin-only output byte verification rejects POS additions, runtime tampering and route changes", t => {
  const f = fixture(t);
  verifyAdminEntry({ baseline: f.baseline, target: f.artifact });
  assert.equal(Object.keys(verifyAdminReleaseOutput(f).files).length, 4);
  writeFileSync(resolve(f.output, "static/sw.js"), "POS SW");
  assert.throws(() => verifyAdminReleaseOutput(f), /inventory/);
  rmSync(resolve(f.output, "static/sw.js"));
  writeFileSync(resolve(f.output, "static/admin/assets/main.js"), 'const listRPC="wrong_rpc";');
  assert.throws(() => verifyAdminReleaseOutput(f), /inventory/);
  cpSync(resolve(f.artifact, "admin/assets/main.js"), resolve(f.output, "static/admin/assets/main.js"));
  writeFileSync(resolve(f.output, "config.json"), JSON.stringify({ version: 3, routes: [] }));
  assert.throws(() => verifyAdminReleaseOutput(f), /routing/);
});

test("source artifact verification rejects classic changes and privileged config even after resealing", t => {
  const f = fixture(t);
  writeFileSync(resolve(f.artifact, "index.html"), "changed POS");
  assert.throws(() => verifyAdminEntry({ baseline: f.baseline, target: f.artifact }), /baseline file changed/);
  cpSync(resolve(f.baseline, "index.html"), resolve(f.artifact, "index.html"));
  const config = readFileSync(resolve(f.artifact, "admin/public-config.js"), "utf8");
  const key = "public." + Buffer.from(JSON.stringify({ role: "service_role", ref: PRODUCTION_REF })).toString("base64url") + ".signature";
  writeFileSync(resolve(f.artifact, "admin/public-config.js"), config.replace(/const SUPABASE_ANON_KEY = "[^"]+";/, `const SUPABASE_ANON_KEY = "${key}";`));
  f.seal();
  assert.throws(() => verifyAdminEntry({ baseline: f.baseline, target: f.artifact }), /backend binding/);
});
