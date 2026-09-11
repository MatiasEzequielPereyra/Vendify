import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(
  path.resolve(
    currentDirectory,
    "../../supabase/migrations/20260911_013_role_guard_execute_grant.sql"
  ),
  "utf8"
);

test("RLS role guard remains unavailable to anon and executable by authenticated", () => {
  assert.match(migration, /revoke all on function public\.tiene_rol_negocio\(uuid, text\[\]\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.tiene_rol_negocio\(uuid, text\[\]\) to authenticated, service_role/i);
  assert.match(migration, /has_function_privilege\('anon'.*'execute'\)/is);
  assert.match(migration, /has_function_privilege\('authenticated'.*'execute'\)/is);
});
