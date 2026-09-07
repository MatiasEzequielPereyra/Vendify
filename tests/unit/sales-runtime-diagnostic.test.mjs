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

test("sales runtime diagnostic is read-only and exposes the deployed v4 definition", () => {
  assert.match(diagnostic, /^select\s+jsonb_build_object/im);
  assert.match(diagnostic, /pg_get_functiondef\(p\.oid\)/);
  assert.match(diagnostic, /has_function_privilege\('authenticated', p\.oid, 'execute'\)/);
  assert.match(diagnostic, /has_function_privilege\('anon', p\.oid, 'execute'\)/);
  assert.doesNotMatch(diagnostic, /\b(insert|update|delete|alter|create|drop|grant|revoke)\b/i);
});
