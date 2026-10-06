import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const crear = readFileSync(resolve(root, "supabase/functions/crear-empleado/index.ts"), "utf8");
const gestionar = readFileSync(resolve(root, "supabase/functions/gestionar-empleado/index.ts"), "utf8");
const client = readFileSync(resolve(root, "src/team/team-edge-service.ts"), "utf8");
const config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");
const productionProvenance = JSON.parse(
  readFileSync(resolve(root, "docs/supabase/edge-functions-provenance.json"), "utf8")
);
const stagingValidation = JSON.parse(
  readFileSync(resolve(root, "docs/supabase/edge-functions-staging-validation.json"), "utf8")
);
const verifier = readFileSync(resolve(root, "scripts/verify-edge-functions-versioning.mjs"), "utf8");

function appearsInOrder(source, markers) {
  let cursor = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1);
    assert.notEqual(next, -1, "missing marker: " + marker);
    assert.ok(next > cursor, "marker out of order: " + marker);
    cursor = next;
  }
}

test("Edge Function config keeps JWT verification enabled for both deployed functions", () => {
  assert.match(config, /\[functions\.crear-empleado\][\s\S]*?verify_jwt\s*=\s*true/);
  assert.match(config, /\[functions\.gestionar-empleado\][\s\S]*?verify_jwt\s*=\s*true/);
});

test("crear-empleado preserves authentication, authorization and validation contract", () => {
  assert.match(crear, /req\.headers\.get\("Authorization"\)/);
  assert.match(crear, /userClient\.auth\.getUser\(\)/);
  assert.match(crear, /\.in\("rol", \["owner", "admin", "manager"\]\)/);
  assert.match(crear, /No tenés permiso para crear empleados/);
  assert.match(crear, /password\.length < 8/);
  assert.match(crear, /\["admin", "manager", "cashier"\]\.includes\(rol\)/);
  assert.match(crear, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.doesNotMatch(crear, /SUPABASE_SERVICE_ROLE_KEY\s*=/);
});

test("crear-empleado preserves create flow and fail-closed audit cleanup", () => {
  appearsInOrder(crear, [
    "admin.auth.admin.createUser",
    '.from("negocio_miembros")',
    ".insert({",
    '.from("empleados")',
    ".insert({",
    'admin.from("audit_log").insert'
  ]);
  assert.match(crear, /membership\.rol === "manager"[\s\S]*?\["manager", "cashier"\]\.includes\(rol\)/);
  assert.match(crear, /actor_role: membership\.rol/);
  assert.match(crear, /target_user_id: created\.user\.id/);
  assert.match(crear, /if \(auditError\) throw auditError/);
  assert.match(crear, /catch \(dbError\) \{[\s\S]*?admin\.auth\.admin\.deleteUser\(created\.user\.id\)/);
  assert.match(crear, /JSON\.stringify\(\{[\s\S]*?ok: true,[\s\S]*?codigo_acceso:/);
  assert.match(crear, /status: 400/);
});

test("gestionar-empleado preserves caller permission and same-business target isolation", () => {
  assert.match(gestionar, /req\.headers\.get\("Authorization"\)/);
  assert.match(gestionar, /userClient\.auth\.getUser\(\)/);
  assert.match(gestionar, /\.in\("rol", \["owner", "admin", "manager"\]\)/);
  assert.match(gestionar, /\.eq\("negocio_id", callerMembership\.negocio_id\)/);
  assert.match(gestionar, /if \(targetRole === "owner"\) return false/);
  assert.match(gestionar, /No podés modificar tu propia cuenta desde Equipo/);
});

test("gestionar-empleado preserves update, delete and password reset rules", () => {
  assert.match(gestionar, /action === "delete"/);
  assert.match(gestionar, /canDeleteTarget\(callerMembership\.rol, targetMembership\.rol\)/);
  assert.match(gestionar, /admin\.auth\.admin\.deleteUser\(targetMembership\.user_id\)/);
  assert.match(gestionar, /action === "update"/);
  assert.match(gestionar, /canAssignRole\(callerMembership\.rol, rol\)/);
  assert.match(gestionar, /admin\.auth\.admin\.updateUserById/);
  assert.match(gestionar, /\.update\(\{[\s\S]*?nombre,[\s\S]*?username,/);
  assert.match(gestionar, /\.update\(\{ rol \}\)/);
  assert.match(gestionar, /if \(empUpdateError\) throw empUpdateError/);
  assert.match(gestionar, /if \(roleError\) throw roleError/);
  assert.match(gestionar, /action === "reset_password"/);
  assert.match(gestionar, /password\.length < 8/);
  assert.match(gestionar, /\{ password \}/);
  assert.match(gestionar, /if \(flagError\) throw flagError/);
  assert.match(gestionar, /Acción inválida/);
});

test("gestionar-empleado enforces manager target hierarchy", () => {
  assert.match(gestionar, /actorRole === "manager"[\s\S]*?targetRole === "manager"[\s\S]*?targetRole === "cashier"/);
  assert.match(gestionar, /role === "manager"[\s\S]*?role === "cashier"/);
  assert.match(gestionar, /targetMembership\.user_id === user\.id/);
  assert.match(gestionar, /No tenés permiso para administrar ese usuario/);
});

test("gestionar-empleado verifies audit before privileged Auth mutations", () => {
  const deleteIndex = gestionar.indexOf('action === "delete"');
  const updateIndex = gestionar.indexOf('action === "update"');
  const resetIndex = gestionar.indexOf('action === "reset_password"');

  const deleteBlock = gestionar.slice(deleteIndex, updateIndex);
  assert.ok(deleteBlock.indexOf('admin.from("audit_log").insert') < deleteBlock.indexOf("admin.auth.admin.deleteUser"));
  assert.match(deleteBlock, /if \(auditError\) throw auditError/);
  assert.match(deleteBlock, /actor_role: callerMembership\.rol/);
  assert.match(deleteBlock, /target_user_id: targetMembership\.user_id/);

  const updateBlock = gestionar.slice(updateIndex, resetIndex);
  assert.ok(updateBlock.indexOf('admin.from("audit_log").insert') < updateBlock.indexOf("admin.auth.admin.updateUserById"));
  assert.match(updateBlock, /if \(auditError\) throw auditError/);

  const resetBlock = gestionar.slice(resetIndex);
  assert.ok(resetBlock.indexOf('admin.from("audit_log").insert') < resetBlock.indexOf("admin.auth.admin.updateUserById"));
  assert.match(resetBlock, /if \(auditError\) throw auditError/);
  assert.doesNotMatch(resetBlock.match(/detalle: \{[\s\S]*?\},/)?.[0] ?? "", /password|secret|hash/);
});

test("typed Team client payloads match the captured Edge Function parsers", () => {
  assert.match(client, /"crear-empleado",[\s\S]*?nombre: input\.nombre,[\s\S]*?username: input\.username,[\s\S]*?rol: input\.rol,[\s\S]*?password: input\.password/);
  assert.match(client, /"gestionar-empleado",[\s\S]*?action: "update",[\s\S]*?membership_id: input\.membershipId,[\s\S]*?nombre: input\.nombre,[\s\S]*?username: input\.username,[\s\S]*?rol: input\.rol/);
  assert.match(client, /action: "delete",[\s\S]*?membership_id: membershipId/);
  assert.match(client, /action: "reset_password",[\s\S]*?membership_id: membershipId,[\s\S]*?password/);
  assert.match(client, /for \(const key of \["error", "message"\]\)/);
});

test("captured sources do not contain secret values or server stack serialization", () => {
  for (const source of [crear, gestionar]) {
    assert.match(source, /Deno\.env\.get\("SUPABASE_URL"\)/);
    assert.match(source, /Deno\.env\.get\("SUPABASE_ANON_KEY"\)/);
    assert.match(source, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
    assert.doesNotMatch(source, /service_role\s*[:=]\s*["'][A-Za-z0-9._-]{20,}/i);
    assert.doesNotMatch(source, /error\.stack/);
  }
});


test("production Edge Function provenance remains the immutable VEN-004 capture", () => {
  assert.equal(productionProvenance.ticket, "VEN-004");
  assert.equal(productionProvenance.production_project_ref, "puhkmblnptntorwptvld");
  assert.equal(Object.hasOwn(productionProvenance, "validation_project_ref"), false);
  assert.deepEqual(
    productionProvenance.functions.map((entry) => ({
      function: entry.function,
      deployed_version: entry.deployed_version,
      verify_jwt: entry.verify_jwt,
      deployed_ezbr_sha256: entry.deployed_ezbr_sha256,
      source_sha256: entry.source_sha256
    })),
    [
      {
        function: "crear-empleado",
        deployed_version: 2,
        verify_jwt: true,
        deployed_ezbr_sha256: "e1c44b3e2b98b13a72be72790d77e14d6480e516b74543876ee07533046c3676",
        source_sha256: "df540898703d458e4533730db0a6727bef74cb1ce3c6dc5c8a6b2afbb79f1890"
      },
      {
        function: "gestionar-empleado",
        deployed_version: 2,
        verify_jwt: true,
        deployed_ezbr_sha256: "db6127e0f367ca74b371a731a7017b0f04dae17efc4d588099eeeb44f054ccb1",
        source_sha256: "6b9902122e94b097cf973812ec9700996cd5fa6c5d82ae19076798ac1f1d8255"
      }
    ]
  );
});

test("VEN-015 staging validation is separate from production provenance", () => {
  assert.equal(stagingValidation.ticket, "VEN-015");
  assert.equal(stagingValidation.validation_project_ref, "clqxfwiutwnhbejezakw");
  assert.notEqual(stagingValidation.validation_project_ref, productionProvenance.production_project_ref);
  assert.equal(stagingValidation.functions.length, 2);
  assert.ok(stagingValidation.functions.every((entry) => entry.verify_jwt === true));
});

test("edge-function verifier guards immutable production provenance and current staging parity", () => {
  assert.match(verifier, /EXPECTED_PRODUCTION/);
  assert.match(verifier, /production Edge Function provenance must remain VEN-004/);
  assert.match(verifier, /staging validation metadata must not replace production provenance/);
  assert.match(verifier, /staging source checksum drift/);
  assert.match(verifier, /verify_jwt=true is not declared/);
});
