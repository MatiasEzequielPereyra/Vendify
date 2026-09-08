import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const diagnostic = fs.readFileSync(
  path.resolve(currentDirectory, "../../supabase/diagnostics/security_definer_audit.sql"),
  "utf8"
);

test("SECURITY DEFINER diagnostic is read-only and reports API exposure", () => {
  assert.match(diagnostic, /p\.prosecdef/);
  assert.match(diagnostic, /has_function_privilege\('anon', p\.oid, 'execute'\)/);
  assert.match(diagnostic, /has_function_privilege\('authenticated', p\.oid, 'execute'\)/);
  assert.match(diagnostic, /without_fixed_search_path/);
  assert.match(diagnostic, /search_path_fixed/);
  assert.doesNotMatch(diagnostic, /\b(insert|update|delete|alter|create|drop|grant|revoke)\b/i);
});
