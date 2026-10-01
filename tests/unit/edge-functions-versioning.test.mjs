import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const crear = readFileSync(resolve(root, "supabase/functions/crear-empleado/index.ts"), "utf8");
const gestionar = readFileSync(resolve(root, "supabase/functions/gestionar-empleado/index.ts"), "utf8");
const client = readFileSync(resolve(root, "src/team/team-edge-service.ts"), "utf8");
const config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");

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
  assert.match(crear, /\.in\("rol", \["owner", "admin"\]\)/);
  assert.match(crear, /No tenés permiso para crear empleados/);
  assert.match(crear, /password\.length < 8/);
  assert.match(crear, /\["admin", "manager", "cashier"\]\.includes\(rol\)/);
  assert.match(crear, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.doesNotMatch(crear, /SUPABASE_SERVICE_ROLE_KEY\s*=/);
});

test("crear-empleado preserves create flow and cleanup after a database failure", () => {
  appearsInOrder(crear, [
    "admin.auth.admin.createUser",
    '.from("negocio_miembros")',
    ".insert({",
    '.from("empleados")',
    ".insert({",
    'await admin.from("audit_log").insert'
  ]);
  assert.match(crear, /catch \(dbError\) \{[\s\S]*?admin\.auth\.admin\.deleteUser\(created\.user\.id\)/);
  assert.match(crear, /JSON\.stringify\(\{[\s\S]*?ok: true,[\s\S]*?codigo_acceso:/);
  assert.match(crear, /status: 400/);
});

test("gestionar-empleado preserves caller permission and same-business target isolation", () => {
  assert.match(gestionar, /req\.headers\.get\("Authorization"\)/);
  assert.match(gestionar, /userClient\.auth\.getUser\(\)/);
  assert.match(gestionar, /\.in\("rol", \["owner", "admin"\]\)/);
  assert.match(gestionar, /\.eq\("negocio_id", callerMembership\.negocio_id\)/);
  assert.match(gestionar, /El propietario no puede modificarse desde Equipo/);
  assert.match(gestionar, /No podés modificar tu propia cuenta desde Equipo/);
});

test("gestionar-empleado preserves update, delete and password reset rules", () => {
  assert.match(gestionar, /action === "delete"/);
  assert.match(gestionar, /callerMembership\.rol !== "owner"/);
  assert.match(gestionar, /admin\.auth\.admin\.deleteUser\(targetMembership\.user_id\)/);
  assert.match(gestionar, /action === "update"/);
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
