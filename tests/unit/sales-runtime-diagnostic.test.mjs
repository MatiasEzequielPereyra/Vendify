import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const diagnostic = fs.readFileSync(
  path.resolve(currentDirectory, "../../supabase/diagnostics/registrar_venta_v4_audit.sql"),
  "utf8"
);
const v3Diagnostic = fs.readFileSync(
  path.resolve(currentDirectory, "../../supabase/diagnostics/registrar_venta_v3_audit.sql"),
  "utf8"
);

test("sales runtime diagnostic is read-only and exposes the deployed v4 definition", () => {
  assert.match(diagnostic, /^select\s+jsonb_build_object/im);
  assert.match(diagnostic, /pg_get_functiondef\(p\.oid\)/);
  assert.match(diagnostic, /has_function_privilege\('authenticated', p\.oid, 'execute'\)/);
  assert.match(diagnostic, /has_function_privilege\('anon', p\.oid, 'execute'\)/);
  assert.doesNotMatch(diagnostic, /\b(insert|update|delete|alter|create|drop|grant|revoke)\b/i);
});

test("sales v3 diagnostic targets the exact delegated RPC without mutating data", () => {
  assert.match(v3Diagnostic, /registrar_venta_v3\(jsonb,jsonb,text,numeric,text,uuid,uuid\)/);
  assert.match(v3Diagnostic, /pg_get_functiondef\(p\.oid\)/);
  assert.match(v3Diagnostic, /has_function_privilege\('anon', p\.oid, 'execute'\)/);
  assert.doesNotMatch(v3Diagnostic, /\b(insert|update|delete|alter|create|drop|grant|revoke)\b/i);
});
