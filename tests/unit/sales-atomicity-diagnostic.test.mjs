import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const diagnostic = fs.readFileSync(
  path.resolve(currentDirectory, "../../supabase/diagnostics/registrar_venta_atomicity_audit.sql"),
  "utf8"
);

test("sales atomicity diagnostic is read-only and checks deployed v3/v4 semantics", () => {
  assert.match(diagnostic, /^with functions as \(/im);
  assert.match(diagnostic, /pg_get_functiondef\(p\.oid\)/);
  assert.match(diagnostic, /registrar_venta_v3\(jsonb,jsonb,text,numeric,text,uuid,uuid\)/);
  assert.match(diagnostic, /registrar_venta_v4\(jsonb,jsonb,text,numeric,text,uuid,uuid,text\)/);
  assert.match(diagnostic, /v3_has_exception_handler/);
  assert.match(diagnostic, /v4_has_exception_handler/);
  assert.match(diagnostic, /v3_contains_sale_write_set/);
  assert.match(diagnostic, /v4_delegates_and_persists_idempotency/);
  assert.match(diagnostic, /atomicity_contract_ok/);
  assert.doesNotMatch(diagnostic, /^\s*(?:insert|update|delete|alter|drop|create)\b/im);
});
